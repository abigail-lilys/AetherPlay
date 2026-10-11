import {
  getLocalFolderHandle,
  type BrowserFileSystemDirectoryHandle,
} from "@/src/lib/storage";

type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: "read" | "readwrite";
  }) => Promise<BrowserFileSystemDirectoryHandle>;
};

export type DirectoryInputElement = HTMLInputElement & {
  webkitEntries?: Array<{ isDirectory?: boolean; name?: string }>;
};

export interface ChosenWebkitFolder {
  files: File[];
  folderName: string;
}

function directoryPicker() {
  if (typeof window === "undefined") return undefined;
  return (window as WindowWithDirectoryPicker).showDirectoryPicker;
}

export function supportsLocalFolderAccess(): boolean {
  return typeof directoryPicker() === "function";
}

export function localFolderAccessError(): string | undefined {
  if (typeof window === "undefined") {
    return "Folder access is not available in this browser.";
  }
  if (!window.isSecureContext) {
    return "Folder access requires HTTPS, localhost, or 127.0.0.1. Import a ZIP instead.";
  }
  if (!supportsLocalFolderAccess()) {
    return "Folder access is not available. Import a ZIP instead.";
  }
  return undefined;
}

export function selectedFolderName(
  input: DirectoryInputElement,
  files: File[],
): string {
  const directoryEntry = input.webkitEntries?.find(
    (entry) => entry.isDirectory && entry.name?.trim(),
  );
  if (directoryEntry?.name) return directoryEntry.name.trim();

  for (const file of files) {
    const path = (file as File & { webkitRelativePath?: string })
      .webkitRelativePath ?? "";
    const folderName = path.split("/").find(Boolean);
    if (folderName) return folderName;
  }

  return "";
}

export function chooseWebkitFolder(): Promise<ChosenWebkitFolder> {
  return new Promise((resolve) => {
    const input = document.createElement("input") as DirectoryInputElement;
    input.type = "file";
    input.multiple = true;
    input.className = "hidden-input";
    input.setAttribute("webkitdirectory", "");

    function finish(files: File[]) {
      const folderName = selectedFolderName(input, files);
      input.remove();
      resolve({ files, folderName });
    }

    input.addEventListener(
      "change",
      () => finish(Array.from(input.files ?? [])),
      { once: true },
    );
    input.addEventListener("cancel", () => finish([]), { once: true });

    document.body.append(input);
    input.click();
  });
}

export async function pickLocalFolder(): Promise<BrowserFileSystemDirectoryHandle> {
  const picker = directoryPicker();
  if (!picker) throw new Error("This browser cannot read folders directly.");
  return picker.call(window, { id: "game-folder", mode: "read" });
}

export async function requestLocalFolderPermission(
  gameId: string,
): Promise<boolean> {
  const handle = await getLocalFolderHandle(gameId);
  if (!handle) return false;

  const current = handle.queryPermission
    ? await handle.queryPermission({ mode: "read" })
    : "granted";
  if (current === "granted") return true;
  if (current === "denied" || !handle.requestPermission) return false;

  return (await handle.requestPermission({ mode: "read" })) === "granted";
}
