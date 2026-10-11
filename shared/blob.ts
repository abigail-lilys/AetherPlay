export function createArrayBufferObjectUrl(
  arrayBuffer: ArrayBuffer,
  mimeType: string | undefined,
  fallback: () => string,
): string {
  if (
    mimeType &&
    typeof Blob !== "undefined" &&
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function"
  ) {
    return URL.createObjectURL(new Blob([arrayBuffer], { type: mimeType }));
  }
  return fallback();
}
