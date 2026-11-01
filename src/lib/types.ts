export type ReservedKeyAction = "toggleOverlay" | "toggleReader" | "focusPlayer" | "fullscreen";

export interface ReservedKey {
  code: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  action: ReservedKeyAction;
  label: string;
}

export interface KeyChord {
  code?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  label: string;
}

export interface DictionaryDismissGuard {
  enabled: boolean;
  triggers: KeyChord[];
}

export interface PlayerSettings {
  reservedKeys: ReservedKey[];
  dictionaryDismissGuard: DictionaryDismissGuard;
  overlayEnabled: boolean;
  readableOverlay: boolean;
  readerMode: boolean;
}

export type GameSourceKind = "stored" | "local-folder" | "session-folder" | "android-folder";

export interface GameRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  entryPath: string;
  fileCount: number;
  totalBytes: number;
  sourceKind?: GameSourceKind;
  settings: PlayerSettings;
}

export type StorageKind = "opfs" | "indexeddb" | "local-folder" | "session-file" | "android-folder" | "zip-archive";

export interface StoredGameFile {
  gameId: string;
  path: string;
  size: number;
  mime: string;
  storageRef: string;
  storageKind: StorageKind;
  archiveEntryPath?: string;
}

export interface ImportProgress {
  phase: "idle" | "reading" | "storing" | "done" | "error";
  label: string;
  completed: number;
  total: number;
}

export type PlayerToParentMessage =
  | { type: "reserved-key"; action: ReservedKeyAction; code: string }
  | { type: "overlay-availability"; gameId: string; available: boolean }
  | { type: "overlay-status"; overlayEnabled: boolean; readerMode: boolean }
  | { type: "game-viewport"; width: number; height: number }
  | { type: "return-focus" }
  | { type: "export-diagnostics" }
  | { type: "text-log"; gameId: string; text: string; at: number }
  | { type: "runtime-error"; message: string; stack?: string }
  | { type: "wolf-assets-request"; gameId: string; requestId: string }
  | { type: "wolf-save-written"; gameId: string; path: string; data: ArrayBuffer; fingerprint: string; generation: number }
  | { type: "wolf-save-writeback-event"; gameId: string; event: string; path: string; details: string; at: number };

export type ParentToPlayerMessage =
  | { type: "player-settings"; settings: PlayerSettings }
  | { type: "overlay-visible"; enabled: boolean }
  | { type: "reader-mode"; enabled: boolean }
  | { type: "focus-game" }
  | { type: "player-viewport"; width: number; height: number; devicePixelRatio: number }
  | {
      type: "wolf-assets-response";
      requestId: string;
      assets?: Array<{ path: string; url: string; size: number }>;
      externalSaveRootRegistered?: boolean;
      error?: string;
    }
  | { type: "wolf-save-writeback-ack"; gameId: string; path: string; fingerprint: string; generation: number; ok: boolean; error?: string };

export interface ZipArchiveFileEntry {
  /** Virtual path exposed to the game after wrapper-folder normalization. */
  path: string;
  /** Exact entry name inside the source ZIP. */
  archiveEntryPath: string;
  /** Uncompressed size reported by the ZIP central directory. */
  size: number;
  mime: string;
}
export interface ImportCandidate {
  title: string;
  files: Array<{ path: string; file: Blob }>;
  entryPath: string;
  totalBytes: number;
  /** Present only for ZIP imports; archive contents are extracted on demand. */
  zipArchive?: Blob;
  zipArchiveEntries?: ZipArchiveFileEntry[];
}
