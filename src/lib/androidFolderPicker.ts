import { registerPlugin } from "@capacitor/core";

export interface AndroidFolderFile {
  relativePath: string;
  uri: string;
  mimeType: string;
  size: number;
}

export interface AndroidFolderChoice {
  treeUri: string;
  folderName: string;
  files: AndroidFolderFile[];
}

interface AndroidFolderPickerAPI {
  pickDirectory(): Promise<{ treeUri: string; folderName: string }>;
  listFiles(options: { treeUri: string }): Promise<{ files: AndroidFolderFile[] }>;
  readFile(options: { uri: string }): Promise<{ data: string }>;
  registerGameAssets(options: { gameId: string; append: boolean; files: Array<{ path: string; uri: string; mime: string }> }): Promise<{ registeredCount: number }>;
  appendRuntimeLog(options: { treeUri: string; content: string }): Promise<{ uri: string; trimmed: boolean; bytesWritten: number }>;
  exportTextFile(options: { filename: string; content: string }): Promise<{ uri: string }>;
  exportBinaryFile(options: { filename: string; data: string }): Promise<{ uri: string }>;
  importBinaryFile(): Promise<{ filename: string; size: number; data: string }>;
}

const picker = registerPlugin<AndroidFolderPickerAPI>("AndroidFolderPicker");

export async function chooseAndroidFolder(): Promise<AndroidFolderChoice> {
  const selected = await picker.pickDirectory();
  const result = await picker.listFiles({ treeUri: selected.treeUri });
  return { ...selected, files: result.files };
}

/** Read only the requested file. The game directory is never copied wholesale. */
export async function readAndroidFolderFile(
  uri: string,
  mime = "application/octet-stream",
): Promise<Blob> {
  const response = await picker.readFile({ uri });
  const binary = atob(response.data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime || "application/octet-stream" });
}


/** Append a bounded run log directly inside the previously selected Android game folder. */
export async function appendAndroidRuntimeLog(
  treeUri: string,
  content: string,
): Promise<{ uri: string; trimmed: boolean; bytesWritten: number }> {
  return picker.appendRuntimeLog({ treeUri, content });
}

/** Save a diagnostic text file through Android's system document picker. */
export async function saveAndroidTextFile(filename: string, content: string): Promise<string> {
  const result = await picker.exportTextFile({ filename, content });
  return result.uri;
}

// AETHER_WOLF_BINARY_EXPORT
/** Export exact binary bytes using Android's system Save As picker (base64 input). */
export async function saveAndroidBinaryFile(filename: string, data: string): Promise<string> {
  const result = await picker.exportBinaryFile({ filename, data });
  return result.uri;
}

// AETHER_WOLF_BINARY_IMPORT
/** Pick a local file via Android's document picker and retain its original bytes as base64. */
export async function pickAndroidBinaryFile(): Promise<{ filename: string; size: number; data: string }> {
  return picker.importBinaryFile();
}


/** Register only asset metadata in Android. File bytes are streamed by WebViewClient on demand. */
export async function registerAndroidGameAssets(
  gameId: string,
  files: Array<{ path: string; uri: string; mime: string }>,
): Promise<number> {
  const batchSize = 250;
  let registeredCount = 0;
  for (let start = 0; start < files.length; start += batchSize) {
    const result = await picker.registerGameAssets({
      gameId,
      append: start > 0,
      files: files.slice(start, start + batchSize),
    });
    registeredCount = result.registeredCount;
  }
  return registeredCount;
}
