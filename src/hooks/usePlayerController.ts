import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { diagnosticErrorText, flushRuntimeLog, installDiagnosticErrorHandlers, logDiagnostic, setRuntimeLogTarget } from "@/src/lib/diagnostics";
import { getAndroidFolderHandle } from "@/src/lib/storage";
import { clearZipArchiveCache } from "@/src/lib/playerCache";
import {
  createWolfAssetObjectUrls,
  type WolfAssetObjectUrlSet,
} from "@/src/lib/wolfAssets";
import type { PlayerToParentMessage } from "@/src/lib/types";
import { useGameControls } from "@/src/hooks/useGameControls";
import { useGameLibrary } from "@/src/hooks/useGameLibrary";
import { usePlayerFrame } from "@/src/hooks/usePlayerFrame";
import { useTextLog } from "@/src/hooks/useTextLog";

const textLogLimit = 100;
const serviceTitle = "Local Web Game Player";

export function usePlayerController() {
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [overlayAvailability, setOverlayAvailability] = useState<{
    gameId: string;
    available: boolean;
  } | null>(null);
  const wolfAssetsRef = useRef<{
    key: string;
    promise: Promise<WolfAssetObjectUrlSet>;
  } | undefined>(undefined);

  const library = useGameLibrary(() => setRuntimeError(null));
  const player = usePlayerFrame(library.activeGame?.id);
  const textLog = useTextLog(textLogLimit);
  const overlayAvailable = Boolean(
    library.activeGame &&
      overlayAvailability?.gameId === library.activeGame.id &&
      overlayAvailability.available,
  );
  const quotaPercent =
    library.storage?.quota && library.storage.usage
      ? Math.min(
          100,
          Math.round((library.storage.usage / library.storage.quota) * 100),
        )
      : 0;
  const controls = useGameControls({ library, overlayAvailable, player });

  function wolfAssetsForActiveGame(): Promise<WolfAssetObjectUrlSet> {
    const game = library.activeGame;
    if (!game) return Promise.reject(new Error("No WOLF game is active."));

    // Woditor can request a new asset long after startup. A settings update must
    // not revoke the active iframe's URLs while the game is still running.
    const current = wolfAssetsRef.current;
    if (current?.key === game.id) return current.promise;
    if (current) {
      void current.promise.then((value) => value.release(), () => undefined);
    }

    const promise = createWolfAssetObjectUrls(game.id);
    wolfAssetsRef.current = { key: game.id, promise };
    return promise;
  }

  async function respondWithWolfAssets(
    event: MessageEvent<PlayerToParentMessage>,
    message: Extract<PlayerToParentMessage, { type: "wolf-assets-request" }>,
  ) {
    const requestStartedAt = Date.now();
    const game = library.activeGame;
    if (
      !game ||
      message.gameId !== game.id ||
      event.source !== player.frameRef.current?.contentWindow
    ) {
      logDiagnostic("warn", "wolf-assets.request.ignored", {
        requestedGameId: message.gameId,
        activeGameId: game?.id,
        hasActiveGame: Boolean(game),
        frameSourceMatches: event.source === player.frameRef.current?.contentWindow,
      });
      return;
    }

    logDiagnostic("info", "wolf-assets.request.received", {
      gameId: game.id, requestId: message.requestId, entryPath: game.entryPath,
    });
    try {
      const value = await wolfAssetsForActiveGame();
      logDiagnostic("info", "wolf-assets.response.ready", {
        gameId: game.id, requestId: message.requestId, assetCount: value.assets.length,
        bytesInUrls: value.assets.reduce((sum, asset) => sum + asset.size, 0),
        elapsedMs: Date.now() - requestStartedAt,
      });
      (event.source as Window).postMessage(
        {
          type: "wolf-assets-response",
          requestId: message.requestId,
          assets: value.assets,
        },
        window.location.origin,
      );
    } catch (cause) {
      const error =
        cause instanceof Error
          ? cause.message
          : "Could not prepare WOLF assets.";
      logDiagnostic("error", "wolf-assets.response.failed", {
        gameId: message.gameId, requestId: message.requestId,
        elapsedMs: Date.now() - requestStartedAt, error: diagnosticErrorText(cause),
      });
      setRuntimeError(error);
      (event.source as Window).postMessage(
        {
          type: "wolf-assets-response",
          requestId: message.requestId,
          error,
        },
        window.location.origin,
      );
    }
  }

  useEffect(() => {
    installDiagnosticErrorHandlers();
    logDiagnostic("info", "app.player-controller-mounted", {});
  }, []);

  useEffect(() => {
    return () => clearZipArchiveCache();
  }, [library.activeGame?.id]);

  useEffect(() => {
    void player.setImmersiveMode(Boolean(library.activeGame)).catch((cause) => {
      logDiagnostic("warn", "android.immersive-mode.change.failed", {
        activeGameId: library.activeGame?.id,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    });
  }, [library.activeGame?.id]);

  useEffect(() => {
    setRuntimeLogTarget(null);
    const game = library.activeGame;
    if (!game || Capacitor.getPlatform() !== "android") return;
    let cancelled = false;

    void getAndroidFolderHandle(game.id).then((folder) => {
      if (cancelled) return;
      if (!folder?.treeUri) {
        logDiagnostic("warn", "runtime.log.target.unavailable", {
          gameId: game.id,
          gameTitle: game.title,
          entryPath: game.entryPath,
          reason: "No saved Android folder permission is associated with this game.",
        });
        return;
      }
      setRuntimeLogTarget({ gameId: game.id, treeUri: folder.treeUri, folderName: folder.folderName });
      logDiagnostic("info", "runtime.session.start", {
        gameId: game.id,
        gameTitle: game.title,
        entryPath: game.entryPath,
        gameFolder: folder.folderName,
        logFile: "runtime.log",
        maxLogBytes: 524288,
        singleLogFile: true,
      });
    }).catch((cause) => {
      if (cancelled) return;
      logDiagnostic("error", "runtime.log.target.lookup-failed", {
        gameId: game.id,
        error: diagnosticErrorText(cause),
      });
    });

    return () => {
      cancelled = true;
      void flushRuntimeLog();
    };
  }, [library.activeGame?.id]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<PlayerToParentMessage>) => {
      if (
        event.origin !== window.location.origin ||
        !event.data ||
        typeof event.data !== "object"
      ) {
        return;
      }

      const message = event.data;
      if (message.type === "wolf-assets-request") {
        void respondWithWolfAssets(event, message);
        return;
      }
      if (message.type === "overlay-availability") {
        setOverlayAvailability({
          gameId: message.gameId,
          available: message.available,
        });
      }
      if (message.type === "reserved-key") {
        void controls.handleReservedAction(message.action);
      }
      if (message.type === "return-focus") {
        void player.focusPlayer();
      }
      if (
        message.type === "text-log" &&
        message.gameId === library.activeGame?.id
      ) {
        textLog.append(message.text);
      }
      if (message.type === "runtime-error") {
        logDiagnostic("error", "player.runtime-error", { gameId: library.activeGame?.id, message: message.message });
        setRuntimeError(message.message);
      }
      if (
        message.type === "game-viewport" &&
        message.width > 0 &&
        message.height > 0
      ) {
        player.setGameAspectRatio(message.width / message.height);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  });

  useEffect(() => {
    textLog.reset();
  }, [library.activeGame?.id, textLog.reset]);

  useEffect(() => {
    document.title = library.activeGame
      ? `${library.activeGame.title} | ${serviceTitle}`
      : serviceTitle;
  }, [library.activeGame]);

  useEffect(() => {
    if (!library.activeGame) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [library.activeGame]);

  useEffect(
    () => () => {
      const current = wolfAssetsRef.current;
      if (current) {
        void current.promise.then((value) => value.release(), () => undefined);
      }
    },
    [],
  );

  return {
    ...controls,
    library,
    logsOpen: textLog.logsOpen,
    overlayAvailable,
    player,
    quotaPercent,
    resetRuntimeError: () => setRuntimeError(null),
    runtimeError,
    setLogsOpen: textLog.setLogsOpen,
    textLogLimit,
    textLogs: textLog.textLogs,
  };
}
