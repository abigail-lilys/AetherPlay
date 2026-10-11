// @ts-nocheck

import { frameElementRect } from "@/shared/browser";
import { positiveFiniteNumber } from "@/player-runtime/bridge/keyEvents";

function detectNativeGameSize({ graphics, tyranoConfig, canvas }) {
  function size(width, height) {
    const normalizedWidth = positiveFiniteNumber(width);
    const normalizedHeight = positiveFiniteNumber(height);
    return normalizedWidth && normalizedHeight
      ? { width: normalizedWidth, height: normalizedHeight }
      : null;
  }

  return (
    size(graphics?.width || graphics?._width || graphics?.boxWidth, graphics?.height || graphics?._height || graphics?.boxHeight) ||
    size(tyranoConfig?.scWidth, tyranoConfig?.scHeight) ||
    size(canvas?.width, canvas?.height)
  );
}

export function createViewportBridge({ postParentMessage, scheduleFlush }) {
  let latestPlayerViewport = null;
  let lastAppliedViewport = "";
  let viewportFitFrame = 0;

  function nativeGameSize() {
    return detectNativeGameSize({
      graphics: window.Graphics,
      tyranoConfig: window.TYRANO?.kag?.config || window.config,
      canvas: document.querySelector("canvas"),
    });
  }

  function installViewportBridge() {
    const notify = () => {
      const detected = nativeGameSize();
      if (!detected) return false;
      postParentMessage({ type: "game-viewport", ...detected });
      return true;
    };

    notify();
    window.addEventListener("resize", notify);
    const timer = window.setInterval(() => {
      if (notify()) window.clearInterval(timer);
    }, 250);
    window.addEventListener("resize", scheduleViewportFit);
    scheduleViewportFit();
  }

  function updatePlayerViewport(message) {
    const width = positiveFiniteNumber(message.width);
    const height = positiveFiniteNumber(message.height);
    if (!width || !height) return;
    latestPlayerViewport = { width, height };
    scheduleViewportFit();
  }

  function playerViewport() {
    const rect = frameElementRect();
    return {
      width: rect?.width || latestPlayerViewport?.width || window.innerWidth || document.documentElement.clientWidth,
      height: rect?.height || latestPlayerViewport?.height || window.innerHeight || document.documentElement.clientHeight,
    };
  }

  function notifyRpgMakerViewport(width, height) {
    const graphics = window.Graphics;
    if (!graphics || typeof graphics !== "object") return;

    const nativeWidth = Number(graphics.width || graphics._width || 0);
    const nativeHeight = Number(graphics.height || graphics._height || 0);
    const viewportKey = `${width}x${height}@${nativeWidth}x${nativeHeight}`;
    if (viewportKey === lastAppliedViewport) return;
    lastAppliedViewport = viewportKey;

    try {
      if (typeof graphics._onWindowResize === "function") {
        graphics._onWindowResize();
      } else if (typeof graphics._updateAllElements === "function") {
        graphics._updateAllElements();
      }
    } catch (error) {
      lastAppliedViewport = "";
      console.warn("[Local Web Game Player viewport] Could not notify RPG Maker resize.", error);
    }
  }

  function rpgMakerNativeSize() {
    const graphics = window.Graphics;
    if (!graphics || typeof graphics !== "object") return null;
    const width = Number(graphics.width || graphics._width || graphics.boxWidth || 0);
    const height = Number(graphics.height || graphics._height || graphics.boxHeight || 0);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height };
  }

  function containedRect(viewportWidth, viewportHeight, nativeWidth, nativeHeight) {
    const scale = Math.min(viewportWidth / nativeWidth, viewportHeight / nativeHeight);
    const width = Math.max(1, Math.floor(nativeWidth * scale));
    const height = Math.max(1, Math.floor(nativeHeight * scale));
    return {
      left: Math.floor((viewportWidth - width) / 2),
      top: Math.floor((viewportHeight - height) / 2),
      width,
      height,
    };
  }

  function applyDocumentViewport(width, height) {
    document.documentElement.style.background = "#000";
    document.documentElement.style.width = `${width}px`;
    document.documentElement.style.height = `${height}px`;
    document.documentElement.style.overflow = "hidden";
    document.body.style.background = "#000";
    document.body.style.margin = "0";
    document.body.style.width = `${width}px`;
    document.body.style.height = `${height}px`;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.inset = "0";
  }

  function playerLayers() {
    return Array.from(document.querySelectorAll("canvas, video"));
  }

  function layerNativeSize(layer) {
    const width = Number(layer.videoWidth || layer.width || 0);
    const height = Number(layer.videoHeight || layer.height || 0);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height };
  }

  function applyLayerRect(layer, rect) {
    layer.style.position = "absolute";
    layer.style.left = `${rect.left}px`;
    layer.style.top = `${rect.top}px`;
    layer.style.right = "auto";
    layer.style.bottom = "auto";
    layer.style.width = `${rect.width}px`;
    layer.style.height = `${rect.height}px`;
    layer.style.maxWidth = "none";
    layer.style.maxHeight = "none";
    layer.style.transform = "";
    layer.style.transformOrigin = "";
    layer.style.objectFit = "";
  }

  function applyGenericContainedFit(viewportWidth, viewportHeight) {
    for (const layer of playerLayers()) {
      const nativeSize = layerNativeSize(layer);
      if (!nativeSize) continue;
      applyLayerRect(layer, containedRect(viewportWidth, viewportHeight, nativeSize.width, nativeSize.height));
    }
  }

  function applyRpgMakerFit(viewportWidth, viewportHeight) {
    const nativeSize = rpgMakerNativeSize();
    notifyRpgMakerViewport(viewportWidth, viewportHeight);
    if (!nativeSize) {
      applyGenericContainedFit(viewportWidth, viewportHeight);
      return;
    }

    const rect = containedRect(viewportWidth, viewportHeight, nativeSize.width, nativeSize.height);
    for (const layer of playerLayers()) {
      applyLayerRect(layer, rect);
    }
  }

  function applyViewportFit() {
    const { width, height } = playerViewport();
    if (!width || !height) return;

    applyDocumentViewport(width, height);
    if (window.Graphics && typeof window.Graphics === "object") {
      applyRpgMakerFit(width, height);
      scheduleFlush();
      return;
    }
    applyGenericContainedFit(width, height);
  }

  function scheduleViewportFit() {
    if (viewportFitFrame) return;
    viewportFitFrame = window.requestAnimationFrame(() => {
      viewportFitFrame = 0;
      try {
        applyViewportFit();
      } catch (error) {
        console.warn("[Local Web Game Player viewport] Could not fit player viewport.", error);
      }
    });
  }

  return {
    installViewportBridge,
    updatePlayerViewport,
  };
}
