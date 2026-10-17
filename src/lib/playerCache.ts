import { readAndroidFolderFile } from "@/src/lib/androidFolderPicker";
import { getSessionFolderFile } from "@/src/lib/sessionFiles";
import { diagnosticErrorText, logDiagnostic } from "@/src/lib/diagnostics";

let androidFolderReadRequestCount = 0;

export function clearServiceWorkerGameCache(gameId: string): void {
  navigator.serviceWorker.controller?.postMessage({
    type: "clear-game-cache",
    gameId,
  });
}

export function clearServiceWorkerPlayerCache(): Promise<void> {
  return new Promise((resolve) => {
    const controller = navigator.serviceWorker.controller;
    if (!controller || typeof MessageChannel === "undefined") {
      resolve();
      return;
    }

    const channel = new MessageChannel();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      channel.port1.close();
      resolve();
    };
    const timeoutId = window.setTimeout(finish, 1500);
    channel.port1.onmessage = finish;

    try {
      controller.postMessage({ type: "clear-player-cache" }, [channel.port2]);
    } catch {
      finish();
    }
  });
}

export function listenForSessionFileRequests(): () => void {
  function onServiceWorkerMessage(event: MessageEvent) {
    const messageType = event.data?.type;
    if (messageType !== "session-file-request" && messageType !== "android-folder-file-request") return;

    const port = event.ports[0];
    if (!port) return;

    if (messageType === "android-folder-file-request") {
      const uri = typeof event.data.uri === "string" ? event.data.uri : "";
      const mime = typeof event.data.mime === "string" ? event.data.mime : "application/octet-stream";
      if (!uri) {
        port.postMessage({ type: "android-folder-file-response", ok: false });
        return;
      }
      const requestStartedAt = Date.now();
      const requestedPath = typeof event.data.path === "string" ? event.data.path : "";
      androidFolderReadRequestCount += 1;
      const shouldLogRead = androidFolderReadRequestCount === 1 || androidFolderReadRequestCount % 25 === 0;
      if (shouldLogRead) {
        logDiagnostic("info", "android-folder.read.start", {
          requestNumber: androidFolderReadRequestCount, path: requestedPath, mime,
        });
      }
      void readAndroidFolderFile(uri, mime).then(
        (file) => {
          const elapsedMs = Date.now() - requestStartedAt;
          if (shouldLogRead || elapsedMs > 1500) {
            logDiagnostic("info", "android-folder.read.complete", {
              requestNumber: androidFolderReadRequestCount, path: requestedPath,
              size: file.size, elapsedMs,
            });
          }
          port.postMessage({ type: "android-folder-file-response", ok: true, file });
        },
        (cause) => {
          const error = diagnosticErrorText(cause);
          logDiagnostic("error", "android-folder.read.failed", {
            path: requestedPath, elapsedMs: Date.now() - requestStartedAt, error,
          });
          port.postMessage({ type: "android-folder-file-response", ok: false, error });
        },
      );
      return;
    }

    const gameId = typeof event.data.gameId === "string" ? event.data.gameId : "";
    const path = typeof event.data.path === "string" ? event.data.path : "";
    const file = getSessionFolderFile(gameId, path);

    port.postMessage({
      type: "session-file-response",
      ok: Boolean(file),
      file,
    });
  }

  navigator.serviceWorker?.addEventListener("message", onServiceWorkerMessage);
  return () =>
    navigator.serviceWorker?.removeEventListener(
      "message",
      onServiceWorkerMessage,
    );
}
