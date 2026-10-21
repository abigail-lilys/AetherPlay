import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { exportDiagnosticsTxt, diagnosticErrorText, flushRuntimeLog, installDiagnosticErrorHandlers, logDiagnostic, setRuntimeLogTarget } from "@/src/lib/diagnostics";
import { getAndroidFolderHandle, getWolfSaveBlobs, putWolfSaveBlob } from "@/src/lib/storage"; // AETHER_WOLF_SAVE_PERSISTENCE_V1
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

  const wolfSavePersistenceSuppressedRef = useRef<string | undefined>(undefined);
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
      // AETHER_WOLF_SAVE_PERSISTENCE_V1: restore user saves on every runtime launch.
      let savedFiles: Array<{ path: string; data: ArrayBuffer }> = [];
      try {
        const persistedSaves = await getWolfSaveBlobs(game.id);
        const skipRestoreKey = `aetherplay-debug-skip-wolf-save-restore-once:${game.id}`;
        const restoreModeKey = `aetherplay-debug-wolf-save-restore-mode-once:${game.id}`;
        let skipRestoreOnce = false;
        let restoreMode: "all" | "nested" | "root" = "all";
        try {
          skipRestoreOnce = window.localStorage.getItem(skipRestoreKey) === "1";
          if (skipRestoreOnce) window.localStorage.removeItem(skipRestoreKey);
          const requestedMode = window.localStorage.getItem(restoreModeKey);
          if (requestedMode === "nested" || requestedMode === "root") {
            restoreMode = requestedMode;
            window.localStorage.removeItem(restoreModeKey);
          }
        } catch {
          // Diagnostic flags are optional; never prevent game startup.
        }
        const selectedSaves = restoreMode === "nested"
          ? persistedSaves.filter((save) => /-Save\/Save\/SaveData\d+\.sav$/iu.test(save.path))
          : restoreMode === "root"
            ? persistedSaves.filter((save) => /-Save\/SaveData\d+\.sav$/iu.test(save.path))
            : persistedSaves;
        // Isolated restore tests must not replace the stored blobs with test-session writes.
        if (skipRestoreOnce || restoreMode !== "all") wolfSavePersistenceSuppressedRef.current = game.id;
        logDiagnostic(skipRestoreOnce || restoreMode !== "all" ? "warn" : "info", "wolf.save.restore.records-loaded", {
          gameId: game.id,
          storedCount: persistedSaves.length,
          restoreSkippedOnce: skipRestoreOnce,
          restoreMode,
          selectedCount: skipRestoreOnce ? 0 : selectedSaves.length,
          saves: persistedSaves.map(({ path, size }) => ({ path, size })),
          selectedSavePaths: skipRestoreOnce ? [] : selectedSaves.map(({ path, size }) => ({ path, size })),
        });
        if (!skipRestoreOnce) {
          savedFiles = await Promise.all(selectedSaves.map(async (save) => ({
            path: save.path,
            data: await save.blob.arrayBuffer(),
          })));
        }
      } catch (cause) {
        // Save storage failure must not prevent the original game from starting.
        logDiagnostic("error", "wolf.save.restore.read-failed", { gameId: game.id, error: diagnosticErrorText(cause) });
      }
      logDiagnostic("info", "wolf-assets.response.ready", {
        gameId: game.id, requestId: message.requestId, assetCount: value.assets.length,
        bytesInUrls: value.assets.reduce((sum, asset) => sum + asset.size, 0),
        savedFileCount: savedFiles.length,
        savedFilePaths: savedFiles.map((file) => file.path),
        elapsedMs: Date.now() - requestStartedAt,
      });
      (event.source as Window).postMessage(
        {
        type: "wolf-assets-response",
          requestId: message.requestId,
          assets: value.assets,
          savedFiles,
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
    if (!library.activeGame) wolfSavePersistenceSuppressedRef.current = undefined;
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
      // AETHER_WOLF_SAVE_PERSISTENCE_V1: store WOLF saves outside the volatile WASM FS.
      if (message.type === "wolf-save-written") {
        const activeGame = library.activeGame;
        if (!activeGame || message.gameId !== activeGame.id || event.source !== player.frameRef.current?.contentWindow) return;
        if (wolfSavePersistenceSuppressedRef.current === message.gameId) {
          logDiagnostic("warn", "wolf.save.persist.suppressed-for-test", {
            gameId: message.gameId, path: message.path, bytes: message.data?.byteLength,
          });
          return;
        }
        if (!(message.data instanceof ArrayBuffer) || message.data.byteLength > 16 * 1024 * 1024) {
          logDiagnostic("warn", "wolf.save.persist.rejected", { gameId: message.gameId, path: message.path, bytes: message.data?.byteLength });
          return;
        }
        void putWolfSaveBlob(message.gameId, message.path, new Blob([message.data], { type: "application/octet-stream" })).then(
          () => logDiagnostic("info", "wolf.save.persisted", { gameId: message.gameId, path: message.path, bytes: message.data.byteLength }),
          (cause) => logDiagnostic("error", "wolf.save.persist.failed", { gameId: message.gameId, path: message.path, error: diagnosticErrorText(cause) }),
        );
        return;
      }
      if (message.type === "export-diagnostics") {
        const exportingGame = library.activeGame;
        if (!exportingGame || event.source !== player.frameRef.current?.contentWindow) return;
        void exportDiagnosticsTxt().then(
          () => logDiagnostic("info", "diagnostics.export.completed", {
            gameId: exportingGame.id,
            gameTitle: exportingGame.title,
          }),
          (cause) => {
            const error = cause instanceof Error ? cause.message : String(cause);
            logDiagnostic("error", "diagnostics.export.failed", {
              gameId: exportingGame.id,
              error,
            });
            window.alert(`导出日志失败：${error}`);
          },
        );
        return;
      }
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
