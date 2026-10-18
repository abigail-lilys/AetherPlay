import { Capacitor } from "@capacitor/core";
import { readAndroidFolderFile, registerAndroidGameAssets } from "@/src/lib/androidFolderPicker";
import { diagnosticErrorText, logDiagnostic } from "@/src/lib/diagnostics";
import { getSessionFolderFile } from "@/src/lib/sessionFiles";
import { getStoredFilesForGame } from "@/src/lib/storage";
import { normalizeStoredPath } from "@/src/lib/paths";

type WolfAssetObjectUrl = { path: string; url: string; size: number };
export type WolfAssetObjectUrlSet = { assets: WolfAssetObjectUrl[]; release(): void };
const FILE_READ_CONCURRENCY = 8;

function isLooseWolfAsset(path: string): boolean {
  return normalizeStoredPath(path).toLowerCase().startsWith("data/");
}
function encodedPath(path: string): string {
  return normalizeStoredPath(path).split("/").map(encodeURIComponent).join("/");
}
async function concurrentMap<T, R>(values: T[], worker: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function consume() {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await worker(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(FILE_READ_CONCURRENCY, values.length) }, consume));
  return results;
}

/**
 * Return lightweight URLs for WOLF's synchronous XHR loader.
 * Android-folder files are streamed directly from SAF by GameWebViewClient.
 * OPFS/IndexedDB/local-folder files are served one-at-a-time by player-sw.js.
 * Only session files retain Blob URLs because they have no persistent file route.
 */
export async function createWolfAssetObjectUrls(gameId: string): Promise<WolfAssetObjectUrlSet> {
  const startedAt = Date.now();
  logDiagnostic("info", "wolf-assets.prepare.start", { gameId });
  const allRecords = await getStoredFilesForGame(gameId);
  const records = allRecords.filter((record) => isLooseWolfAsset(record.path));
  const storageKinds = records.reduce<Record<string, number>>((counts, record) => {
    counts[record.storageKind] = (counts[record.storageKind] || 0) + 1;
    return counts;
  }, {});
  const totalAssetBytes = records.reduce((sum, record) => sum + record.size, 0);
  logDiagnostic("info", "wolf-assets.records.ready", {
    gameId,
    allFileCount: allRecords.length,
    looseAssetCount: records.length,
    looseAssetBytes: totalAssetBytes,
    storageKinds,
  });
  if (records.length === 0) {
    const error = new Error("This WOLF export has no loose Data files.");
    logDiagnostic("error", "wolf-assets.no-loose-data", { gameId, allFileCount: allRecords.length });
    throw error;
  }

  const isAndroid = Capacitor.getPlatform() === "android";
  const androidRecords = isAndroid ? records.filter((record) => record.storageKind === "android-folder") : [];
  if (androidRecords.length > 0) {
    const registeredCount = await registerAndroidGameAssets(gameId, androidRecords.map((record) => ({
      path: normalizeStoredPath(record.path),
      uri: record.storageRef,
      mime: record.mime || "application/octet-stream",
    })));
    if (registeredCount !== androidRecords.length) {
      throw new Error(`Android asset registration incomplete (${registeredCount}/${androidRecords.length}).`);
    }
  }

  const objectUrls: string[] = [];
  let materializedBytes = 0;
  const androidCount = androidRecords.length;
  logDiagnostic("info", "wolf-assets.strategy.lazy-routes", {
    gameId,
    assetCount: records.length,
    androidNativeStreamCount: androidCount,
    deferredAssetBytes: totalAssetBytes,
    routeReadOnDemand: true,
  });

  try {
    const assets = await concurrentMap(records, async (record) => {
      const path = normalizeStoredPath(record.path);
      const encoded = encodedPath(path);
      let url: string;
      if (isAndroid && record.storageKind === "android-folder") {
        url = `${window.location.origin}/__game__/${encodeURIComponent(gameId)}/${encoded}`;
      } else if (record.storageKind !== "session-file" && record.storageKind !== "android-folder") {
        url = `${window.location.origin}/play/${encodeURIComponent(gameId)}/${encoded}`;
      } else {
        // Session-only imports need a Blob because they cannot be reopened by a storage route.
        let blob: Blob | undefined;
        try {
          blob = record.storageKind === "session-file"
            ? await getSessionFolderFile(gameId, record.storageRef || record.path)
            : await readAndroidFolderFile(record.storageRef, record.mime);
        } catch (cause) {
          logDiagnostic("error", "wolf-assets.fallback-read.failed", {
            gameId, path, storageKind: record.storageKind, error: diagnosticErrorText(cause),
          });
          throw new Error(`Could not read WOLF asset ${path}: ${diagnosticErrorText(cause)}`);
        }
        if (!blob) throw new Error(`Could not read WOLF asset: ${path}`);
        materializedBytes += blob.size;
        url = URL.createObjectURL(blob);
        objectUrls.push(url);
      }
      return { path, url, size: record.size };
    });

    logDiagnostic("info", "wolf-assets.prepare.complete", {
      gameId,
      assetCount: assets.length,
      totalAssetBytes,
      materializedFallbackBytes: materializedBytes,
      deferredRead: true,
      elapsedMs: Date.now() - startedAt,
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
      gameId, elapsedMs: Date.now() - startedAt, error: diagnosticErrorText(error),
    });
    throw error;
  }
}
