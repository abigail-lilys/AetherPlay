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
  registerGameSaveRoot(options: { gameId: string; treeUri: string }): Promise<{ registered: boolean }>;
  writeGameSave(options: { treeUri: string; relativePath: string; data: string }): Promise<{ relativePath: string; bytesWritten: number; sha256: string }>;
  registerGameAssets(options: { gameId: string; append: boolean; files: Array<{ path: string; uri: string; mime: string }> }): Promise<{ registeredCount: number }>;
  appendRuntimeLog(options: { treeUri: string; content: string }): Promise<{ uri: string; trimmed: boolean; bytesWritten: number }>;
  exportTextFile(options: { filename: string; content: string }): Promise<{ uri: string; bytesWritten: number; verifiedBytes: number }>;
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


/** Register the currently active game's SAF root for synchronous WebView save reads. */
export async function registerAndroidGameSaveRoot(gameId: string, treeUri: string): Promise<void> {
  await picker.registerGameSaveRoot({ gameId, treeUri });
}

/** Write an exact binary WOLF save to the selected Android game folder. */
export async function writeAndroidGameSave(
  treeUri: string,
  relativePath: string,
  data: string,
): Promise<{ relativePath: string; bytesWritten: number; sha256: string }> {
  return picker.writeGameSave({ treeUri, relativePath, data });
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
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("导出内容为空，已阻止创建 0B 文件。");
  }
  const result = await picker.exportTextFile({ filename, content });
  if (!result?.uri || !Number.isSafeInteger(result.bytesWritten) || result.bytesWritten <= 0 ||
      result.verifiedBytes !== result.bytesWritten) {
    throw new Error(`Android 文件导出未通过校验（写入 ${result?.bytesWritten ?? 0} B，读回 ${result?.verifiedBytes ?? 0} B）。`);
  }
  return result.uri;
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
