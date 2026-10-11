import { useEffect, useRef, useState } from "react";
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
    const game = library.activeGame;
    if (
      !game ||
      message.gameId !== game.id ||
      event.source !== player.frameRef.current?.contentWindow
    ) {
      return;
    }

    try {
      const value = await wolfAssetsForActiveGame();
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
