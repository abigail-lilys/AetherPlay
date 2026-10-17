import { readAndroidFolderFile } from "@/src/lib/androidFolderPicker";
import { diagnosticErrorText, logDiagnostic } from "@/src/lib/diagnostics";
import { getSessionFolderFile } from "@/src/lib/sessionFiles";
import {
  getIndexedDbBlobs,
  getLocalFolderHandle,
  getOpfsBlob,
  getStoredFilesForGame,
  type BrowserFileSystemDirectoryHandle,
} from "@/src/lib/storage";
import { normalizeStoredPath } from "@/src/lib/paths";
import type { StoredGameFile } from "@/src/lib/types";

type WolfAssetObjectUrl = {
  path: string;
  url: string;
  size: number;
};

export type WolfAssetObjectUrlSet = {
  assets: WolfAssetObjectUrl[];
  release(): void;
};

const FILE_READ_CONCURRENCY = 32;

function isLooseWolfAsset(path: string): boolean {
  return normalizeStoredPath(path).toLowerCase().startsWith("data/");
}

async function concurrentMap<T, R>(
  values: T[],
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function consume() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(values[index]);
    }
  }

  const workers = Array.from(
    { length: Math.min(FILE_READ_CONCURRENCY, values.length) },
    consume,
  );
  await Promise.all(workers);
  return results;
}

function localFolderReader(root: BrowserFileSystemDirectoryHandle) {
  const directories = new Map<string, Promise<BrowserFileSystemDirectoryHandle>>([
    ["", Promise.resolve(root)],
  ]);

  function directory(parts: string[]): Promise<BrowserFileSystemDirectoryHandle> {
    const key = parts.join("/");
    const cached = directories.get(key);
    if (cached) return cached;
    const pending = directory(parts.slice(0, -1)).then((parent) =>
      parent.getDirectoryHandle(parts.at(-1) || ""),
    );
    directories.set(key, pending);
    return pending;
  }

  return async (path: string): Promise<Blob | undefined> => {
    try {
      const parts = normalizeStoredPath(path).split("/");
      const name = parts.pop();
      if (!name) return undefined;
      const parent = await directory(parts);
      return await (await parent.getFileHandle(name)).getFile();
    } catch {
      return undefined;
    }
  };
}

export async function createWolfAssetObjectUrls(gameId: string): Promise<WolfAssetObjectUrlSet> {
  const prepareStartedAt = Date.now();
  logDiagnostic("info", "wolf-assets.prepare.start", { gameId });
  const allRecords = await getStoredFilesForGame(gameId);
  const records = allRecords.filter((record) => isLooseWolfAsset(record.path));
  const storageKinds = records.reduce<Record<string, number>>((counts, record) => {
    counts[record.storageKind] = (counts[record.storageKind] || 0) + 1;
    return counts;
  }, {});
  logDiagnostic("info", "wolf-assets.records.ready", {
    gameId,
    allFileCount: allRecords.length,
    looseAssetCount: records.length,
    looseAssetBytes: records.reduce((sum, record) => sum + record.size, 0),
    storageKinds,
  });
  if (records.length === 0) {
    const error = new Error("This WOLF export has no loose Data files.");
    logDiagnostic("error", "wolf-assets.no-loose-data", { gameId, allFileCount: allRecords.length });
    throw error;
  }

  const indexedRecords = records.filter((record) => record.storageKind === "indexeddb");
  const indexedBlobs = await getIndexedDbBlobs(
    indexedRecords.map((record) => record.storageRef),
  );
  const localFolderHandle = records.some((record) => record.storageKind === "local-folder")
    ? await getLocalFolderHandle(gameId)
    : undefined;
  const readLocalFolder = localFolderHandle ? localFolderReader(localFolderHandle) : undefined;

  async function readBlob(record: StoredGameFile): Promise<Blob | undefined> {
    if (record.storageKind === "indexeddb") return indexedBlobs.get(record.storageRef);
    if (record.storageKind === "opfs") return getOpfsBlob(gameId, record.path);
    if (record.storageKind === "local-folder") {
      return readLocalFolder?.(record.storageRef || record.path);
    }
    if (record.storageKind === "session-file") {
      return getSessionFolderFile(gameId, record.storageRef || record.path);
    }
    if (record.storageKind === "android-folder") {
      return readAndroidFolderFile(record.storageRef, record.mime);
    }
    return undefined;
  }

  const objectUrls: string[] = [];
  let completedAssets = 0;
  let completedBytes = 0;
  try {
    logDiagnostic("info", "wolf-assets.read.start", {
      gameId, assetCount: records.length,
      androidAssetCount: records.filter((record) => record.storageKind === "android-folder").length,
      concurrency: FILE_READ_CONCURRENCY,
    });
    const assets = await concurrentMap(records, async (record) => {
      const readStartedAt = Date.now();
      let blob: Blob | undefined;
      try {
        blob = await readBlob(record);
      } catch (cause) {
        logDiagnostic("error", "wolf-assets.read.failed", {
          gameId, path: record.path, storageKind: record.storageKind,
          elapsedMs: Date.now() - readStartedAt, error: diagnosticErrorText(cause),
        });
        throw new Error(`Could not read WOLF asset ${record.path}: ${diagnosticErrorText(cause)}`);
      }
      if (!blob) {
        const error = new Error(`Could not read WOLF asset: ${record.path}`);
        logDiagnostic("error", "wolf-assets.read.empty", {
          gameId, path: record.path, storageKind: record.storageKind,
          elapsedMs: Date.now() - readStartedAt,
        });
        throw error;
      }
      completedAssets += 1;
      completedBytes += blob.size;
      const elapsedMs = Date.now() - readStartedAt;
      if (completedAssets % 100 === 0) {
        logDiagnostic("info", "wolf-assets.read.progress", {
          gameId, completedAssets, assetCount: records.length, completedBytes,
          lastPath: record.path, lastStorageKind: record.storageKind, lastReadMs: elapsedMs,
          elapsedTotalMs: Date.now() - prepareStartedAt,
        });
      }
      const url = URL.createObjectURL(blob);
      objectUrls.push(url);
      return { path: normalizeStoredPath(record.path), url, size: blob.size };
    });
    logDiagnostic("info", "wolf-assets.prepare.complete", {
      gameId, assetCount: assets.length, bytesRead: completedBytes,
      elapsedMs: Date.now() - prepareStartedAt,
    });
    return {
      assets,
      release() {
        for (const url of objectUrls) URL.revokeObjectURL(url);
        objectUrls.length = 0;
      },
    };
  } catch (error) {
    for (const url of objectUrls) URL.revokeObjectURL(url);
    logDiagnostic("error", "wolf-assets.prepare.failed", {
      gameId, elapsedMs: Date.now() - prepareStartedAt,
      completedAssets, assetCount: records.length, completedBytes,
      error: diagnosticErrorText(error),
    });
    throw error;
  }
}
