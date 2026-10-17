import { useEffect, useRef, useState } from "react";
import type { ParentToPlayerMessage } from "@/src/lib/types";
import { setAndroidImmersive } from "@/src/lib/androidImmersive";

export function usePlayerFrame(activeGameId?: string) {
  const [gameAspectRatio, setGameAspectRatio] = useState(16 / 9);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameWrapRef = useRef<HTMLDivElement>(null);
  const viewportNotifyFrameRef = useRef<number | null>(null);
  const lastViewportRef = useRef("");
  const immersiveRef = useRef(false);

  useEffect(() => {
    if (!activeGameId) return;
    const notify = () => schedulePlayerViewportNotify();
    const frameWrap = frameWrapRef.current;
    const observer = frameWrap ? new ResizeObserver(notify) : null;
    if (frameWrap) observer?.observe(frameWrap);

    notify();
    window.addEventListener("resize", notify);
    document.addEventListener("fullscreenchange", notify);
    return () => {
      if (viewportNotifyFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportNotifyFrameRef.current);
        viewportNotifyFrameRef.current = null;
      }
      observer?.disconnect();
      window.removeEventListener("resize", notify);
      document.removeEventListener("fullscreenchange", notify);
    };
  }, [activeGameId]);

  function postPlayerMessage(message: ParentToPlayerMessage) {
    frameRef.current?.contentWindow?.postMessage(message, window.location.origin);
  }

  function schedulePlayerViewportNotify() {
    if (viewportNotifyFrameRef.current !== null) return;
    viewportNotifyFrameRef.current = window.requestAnimationFrame(() => {
      viewportNotifyFrameRef.current = null;
      notifyPlayerViewport();
    });
  }

  function notifyPlayerViewport() {
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nextKey = `${Math.round(rect.width)}x${Math.round(rect.height)}@${window.devicePixelRatio || 1}`;
    if (nextKey === lastViewportRef.current) return;
    lastViewportRef.current = nextKey;
    postPlayerMessage({
      type: "player-viewport",
      width: rect.width,
      height: rect.height,
      devicePixelRatio: window.devicePixelRatio || 1,
    });
    try {
      frame.contentWindow?.dispatchEvent(new Event("resize"));
    } catch {
      // Same-origin today, but keep the player shell resilient.
    }
  }

  function scheduleFocusPlayer() {
    window.setTimeout(() => void focusPlayer(), 0);
  }

  async function focusPlayer() {
    const frame = frameRef.current;
    if (!frame) return;
    frame.tabIndex = -1;
    frame.focus();
    frame.contentWindow?.focus();
    postPlayerMessage({ type: "focus-game" });
    window.requestAnimationFrame(() => postPlayerMessage({ type: "focus-game" }));
    window.setTimeout(() => postPlayerMessage({ type: "focus-game" }), 0);
    window.setTimeout(() => postPlayerMessage({ type: "focus-game" }), 80);
  }

  async function setImmersiveMode(enabled: boolean) {
    const handledNatively = await setAndroidImmersive(enabled);
    if (!handledNatively) {
      if (enabled) {
        const target = frameWrapRef.current;
        if (target && document.fullscreenElement !== target) {
          await target.requestFullscreen({ navigationUI: "hide" });
        }
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    }
    immersiveRef.current = enabled;
    schedulePlayerViewportNotify();
    if (enabled) scheduleFocusPlayer();
  }

  async function requestFullscreen() {
    await setImmersiveMode(!immersiveRef.current);
  }

  function resetViewportCache() {
    lastViewportRef.current = "";
  }

  return {
    focusPlayer,
    frameRef,
    frameWrapRef,
    gameAspectRatio,
    postPlayerMessage,
    requestFullscreen,
    setImmersiveMode,
    resetViewportCache,
    scheduleFocusPlayer,
    schedulePlayerViewportNotify,
    setGameAspectRatio,
  };
}
