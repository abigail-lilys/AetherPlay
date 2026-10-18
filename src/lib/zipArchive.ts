import JSZip from "jszip";

function zipNameBytes(bytes: string[] | Uint8Array | Buffer): Uint8Array {
  if (bytes instanceof Uint8Array) return bytes;
  return Uint8Array.from(bytes.map((byte) => (typeof byte === "string" ? byte.charCodeAt(0) : byte)));
}

export function decodeZipFileName(bytes: string[] | Uint8Array | Buffer): string {
  const data = zipNameBytes(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return new TextDecoder("shift_jis", { fatal: true }).decode(data);
  }
}

export async function loadZipArchive(archive: Blob): Promise<JSZip> {
  const archiveData = typeof archive.arrayBuffer === "function" ? await archive.arrayBuffer() : archive;
  return JSZip.loadAsync(archiveData, { decodeFileName: decodeZipFileName });
}
