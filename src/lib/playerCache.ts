import { getSessionFolderFile } from "@/src/lib/sessionFiles";

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
    if (event.data?.type !== "session-file-request") return;

    const port = event.ports[0];
    if (!port) return;

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
