// @ts-nocheck

import {
  cocosCssRectFromScreenPoints,
  cocosCssFontFamily,
  cocosCssTransformFromScreenPoints,
  cocosFontMetrics,
  cocosRenderedText,
  cocosTextAlign,
  cocosVerticalAlignFactor,
  cocosWorldToScreen,
  plainCocosText,
  resolveCocosEngine,
} from "@/player-runtime/engines/cocos/text";
import { boundsIntersectRect } from "@/player-runtime/bridge/overlay/geometry";

export function createCocosOverlayAdapter({
  domSourceId,
  ensureOverlayDom,
  overlayIsActive,
  overlayState,
  removeEntry,
  scheduleFlush,
  upsertEntry,
}) {
  function install() {
    if (overlayState.cocosHooksInstalled) return;

    const tryInstall = () => {
      if (overlayState.cocosHooksInstalled) return true;
      ensureOverlayDom();
      const engine = resolveCocosEngine(window.System);
      if (!engine) return false;

      overlayState.cocosEngine = engine;
      overlayState.cocosHooksInstalled = true;
      if (document.fonts) {
        document.fonts.ready.then(scheduleFlush);
        document.fonts.addEventListener?.("loadingdone", scheduleFlush);
      }
      const scan = (now) => {
        overlayState.cocosScanFrame = 0;
        if (now - overlayState.cocosLastScanAt >= 50) {
          overlayState.cocosLastScanAt = now;
          scanText();
        }
        overlayState.cocosScanFrame = requestAnimationFrame(scan);
      };
      overlayState.cocosScanFrame = requestAnimationFrame(scan);
      return true;
    };

    if (tryInstall()) return;
    setTimeout(install, 250);
  }

  function scanText() {
    if (!overlayIsActive()) return;
    const engine = overlayState.cocosEngine;
    const scene = engine?.director?.getScene?.();
    const canvas = cocosCanvas(engine);
    if (!scene || !(canvas instanceof HTMLCanvasElement)) return;

    const seen = new Set();
    const visit = (node, insideRichText = false) => {
      if (!node || node.activeInHierarchy === false || node.active === false) return;
      const components = Array.isArray(node._components) ? node._components : [];
      const richText = components.find((component) =>
        cocosComponentIs(component, engine.RichText),
      );

      if (richText && cocosSourceIsVisible(richText)) {
        captureSource(engine, richText, canvas, true, seen);
      }

      if (!insideRichText && !richText) {
        for (const component of components) {
          if (cocosComponentIs(component, engine.Label) && cocosSourceIsVisible(component)) {
            captureSource(engine, component, canvas, false, seen);
          }
        }
      }

      for (const child of node.children || []) {
        visit(child, insideRichText || Boolean(richText));
      }
    };

    visit(scene);
    for (const [key, entry] of overlayState.entries) {
      if (entry.cocosSource && !seen.has(key)) removeEntry(key, entry);
    }
    scheduleFlush();
  }

  function captureSource(engine, source, canvas, richText, seen) {
    const rawText = source.string ?? source._string;
    const text = richText
      ? plainCocosText(rawText)
      : String(rawText ?? "").replace(/\u00a0/gu, " ").trim();
    if (!text) return;
    const displayText = cocosRenderedText(source, text);

    const rect = cocosPageRect(engine, source, canvas, displayText);
    if (!rect) return;

    const key = `cocos:${domSourceId(source)}`;
    seen.add(key);
    upsertEntry(key, {
      cocosSource: source,
      cocosRect: rect,
      text,
      displayText,
      width: rect.width,
      height: rect.height,
      fontSize: rect.fontSize,
      fontFace: cocosCssFontFamily(source),
      fontStyle: source.isItalic || source._isItalic ? "italic" : "normal",
      fontWeight: source.isBold || source._isBold ? "700" : "400",
      textDecoration: source.isUnderline || source._isUnderline ? "underline" : "none",
      lineHeight: rect.lineHeight,
      paddingTop: rect.paddingTop,
      textAlign: cocosTextAlign(source.horizontalAlign ?? source._horizontalAlign),
      updatedAt: performance.now(),
    });
  }

  return { install };
}

export function cocosSourceIsVisible(source) {
  const node = source?.node;
  if (!node || node.isValid === false || node.activeInHierarchy === false) return false;
  if (source.enabled === false || source.enabledInHierarchy === false) return false;
  const colorAlpha = Number(source.color?.a ?? source._color?.a ?? 255);
  if (colorAlpha <= 0) return false;

  let current = node;
  let guard = 0;
  while (current && guard++ < 100) {
    if (current.active === false || current.activeInHierarchy === false) return false;
    current = current.parent;
  }
  return true;
}

function cocosComponentIs(component, Component) {
  if (!component || typeof Component !== "function") return false;
  try {
    return component instanceof Component;
  } catch {
    return false;
  }
}

function cocosCanvas(engine) {
  return engine?.game?.canvas || document.querySelector("#GameCanvas, canvas");
}

function cocosPageRect(engine, source, canvas, text) {
  const node = source.node;
  const transform = node?.getComponent?.(engine.UITransform);
  const camera = engine?.director?.root?.batcher2D?.getFirstRenderCamera?.(node);
  const Vec3 = engine?.Vec3;
  if (!transform || !camera || typeof Vec3 !== "function") return null;

  const contentSize = transform.contentSize || transform._contentSize;
  const anchor = transform.anchorPoint || transform._anchorPoint;
  const width = Number(contentSize?.width);
  const height = Number(contentSize?.height);
  const anchorX = Number(anchor?.x);
  const anchorY = Number(anchor?.y);
  if (!(width > 0) || !(height > 0)) return null;

  const normalizedAnchorX = Number.isFinite(anchorX) ? anchorX : 0.5;
  const normalizedAnchorY = Number.isFinite(anchorY) ? anchorY : 0.5;
  const localPoints = [
    [-width * normalizedAnchorX, -height * normalizedAnchorY],
    [width * (1 - normalizedAnchorX), -height * normalizedAnchorY],
    [width * (1 - normalizedAnchorX), height * (1 - normalizedAnchorY)],
    [-width * normalizedAnchorX, height * (1 - normalizedAnchorY)],
  ];

  const screenPoints = [];
  try {
    for (const [x, y] of localPoints) {
      const world = transform.convertToWorldSpaceAR(new Vec3(x, y, 0), new Vec3());
      const screen = cocosWorldToScreen(camera, Vec3, world);
      if (!screen) return null;
      screenPoints.push({ x: Number(screen.x), y: Number(screen.y) });
    }
  } catch {
    return null;
  }

  const canvasRect = canvas.getBoundingClientRect();
  const rect = cocosCssRectFromScreenPoints(
    screenPoints,
    canvasRect,
    canvas.width,
    canvas.height,
  );
  const geometry = cocosCssTransformFromScreenPoints(
    screenPoints,
    canvasRect,
    canvas.width,
    canvas.height,
    width,
    height,
  );
  if (!rect || !geometry || !boundsIntersectRect(geometry.bounds, canvasRect)) {
    return null;
  }

  const { fontSize, lineHeight } = cocosFontMetrics(
    source,
    engine?.view?.getScaleX?.() || 1,
  );
  const lineCount = Math.max(1, String(text).split("\n").length);
  const textHeight = Math.min(height, lineHeight * lineCount);
  const verticalFactor = cocosVerticalAlignFactor(
    source.verticalAlign ?? source._verticalAlign,
  );

  return {
    left: roundCocosCssNumber(geometry.left),
    top: roundCocosCssNumber(geometry.top),
    width: roundCocosCssNumber(geometry.width),
    height: roundCocosCssNumber(geometry.height),
    fontSize: roundCocosCssNumber(fontSize),
    lineHeight: roundCocosCssNumber(lineHeight),
    paddingTop: roundCocosCssNumber(Math.max(0, height - textHeight) * verticalFactor),
    transform: `matrix(${roundCocosCssNumber(geometry.matrix.a)}, ${roundCocosCssNumber(geometry.matrix.b)}, ${roundCocosCssNumber(geometry.matrix.c)}, ${roundCocosCssNumber(geometry.matrix.d)}, 0, 0)`,
  };
}

function roundCocosCssNumber(value) {
  return Math.round(value * 1000) / 1000;
}
