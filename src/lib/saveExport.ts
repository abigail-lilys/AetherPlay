import JSZip from "jszip";
import {
  VFS_BINARY_PREFIX,
  VFS_DIR_PREFIX,
  VFS_FILE_PREFIX,
} from "@/shared/virtualFileSystem";
import { unnamespaceStorageKey } from "@/src/lib/keys";
import { normalizeStoredPath } from "@/src/lib/paths";
import type { GameRecord } from "@/src/lib/types";

interface SaveExportEntry {
  path: string;
  data: string | Uint8Array;
}

type StorageReader = Pick<Storage, "getItem" | "key" | "length">;

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeVirtualFileValue(value: string): string | Uint8Array {
  if (!value.startsWith(VFS_BINARY_PREFIX)) return value;
  return bytesFromBase64(value.slice(VFS_BINARY_PREFIX.length));
}

function savePathForRpgKey(key: string): string | undefined {
  if (key === "RPG Config") return "save/config.rpgsave";
  if (key === "RPG Global") return "save/global.rpgsave";
  if (key === "RPG Shared") return "save/shared.rmmzsave";

  const slot = /^RPG File(\d+)(bak)?$/u.exec(key);
  if (slot) {
    return `save/file${slot[1]}.rpgsave${slot[2] ? ".bak" : ""}`;
  }

  const customSave = /^RPG Save (.+)$/u.exec(key);
  if (customSave) {
    const customPath = normalizeStoredPath(customSave[1]);
    if (customPath) return `save/${customPath}`;
  }

  return undefined;
}

function localStorageExportPath(key: string): string {
  return `localStorage/${encodeURIComponent(key)}.txt`;
}

function exportPathForStorageKey(key: string): string | undefined {
  if (key.startsWith(VFS_DIR_PREFIX)) return undefined;
  if (key.startsWith(VFS_FILE_PREFIX)) return normalizeStoredPath(key.slice(VFS_FILE_PREFIX.length));
  return savePathForRpgKey(key) ?? localStorageExportPath(key);
}

function exportDataForStorageValue(key: string, value: string): string | Uint8Array {
  return key.startsWith(VFS_FILE_PREFIX) ? decodeVirtualFileValue(value) : value;
}

function collectSaveExportEntries(gameId: string, storage: StorageReader = window.localStorage): SaveExportEntry[] {
  const entries = new Map<string, SaveExportEntry>();

  for (let index = 0; index < storage.length; index += 1) {
    const rawKey = storage.key(index);
    if (!rawKey) continue;

    const key = unnamespaceStorageKey(gameId, rawKey);
    if (key === rawKey) continue;

    const path = exportPathForStorageKey(key);
    if (!path) continue;

    const value = storage.getItem(rawKey);
    if (value === null) continue;
    entries.set(path, {
      path,
      data: exportDataForStorageValue(key, value),
    });
  }

  return Array.from(entries.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function downloadFileName(title: string): string {
  const safeTitle = title.trim().replace(/[\\/:*?"<>|]+/gu, "-").replace(/\s+/gu, " ") || "game";
  return `${safeTitle}-saves.zip`;
}

export async function downloadSaveZip(game: GameRecord): Promise<void> {
  const entries = collectSaveExportEntries(game.id);
  if (entries.length === 0) throw new Error("No saves found for this game.");

  const zip = new JSZip();
  for (const entry of entries) {
    zip.file(entry.path, entry.data);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = downloadFileName(game.title);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
