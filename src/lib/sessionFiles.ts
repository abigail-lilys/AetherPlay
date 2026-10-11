import { normalizeStoredPath } from "@/src/lib/paths";

type SessionFileEntry = {
  path: string;
  file: File;
};

const sessionFolders = new Map<string, Map<string, File>>();

export function registerSessionFolder(
  gameId: string,
  files: SessionFileEntry[],
): void {
  const entries = new Map<string, File>();
  for (const entry of files) {
    const path = normalizeStoredPath(entry.path);
    if (path) entries.set(path, entry.file);
  }
  sessionFolders.set(gameId, entries);
}

export function clearSessionFolder(gameId: string): void {
  sessionFolders.delete(gameId);
}

export function clearAllSessionFolders(): void {
  sessionFolders.clear();
}

export function hasSessionFolder(gameId: string): boolean {
  return sessionFolders.has(gameId);
}

export function getSessionFolderFile(
  gameId: string,
  path: string,
): File | undefined {
  return sessionFolders.get(gameId)?.get(normalizeStoredPath(path));
}
