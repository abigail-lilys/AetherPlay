// @ts-nocheck

import {
  cssTransformFromTopLeftCanvasQuad,
  fontFamilyWithEmojiFallback,
} from "@/player-runtime/bridge/overlay/textStyle";
import { boundsIntersectRect } from "@/player-runtime/bridge/overlay/geometry";

export function createConstruct2OverlayAdapter({
  domSourceId,
  overlayIsActive,
  overlayState,
  removeEntry,
  upsertEntry,
}) {
  function install() {
    if (overlayState.construct2HooksInstalled) return;
    overlayState.construct2HooksInstalled = true;

    const scan = () => {
      overlayState.construct2ScanFrame = 0;
      scanText();
      overlayState.construct2ScanFrame = requestAnimationFrame(scan);
    };

    overlayState.construct2ScanFrame = requestAnimationFrame(scan);
  }

  function scanText() {
    if (!overlayIsActive()) return;
    const runtime = construct2Runtime();
    if (!runtime || !Array.isArray(runtime.types_by_index)) return;

    const seen = new Set();
    for (const type of runtime.types_by_index) {
      if (!isConstruct2TextType(type) || !Array.isArray(type.instances)) continue;
      for (const source of type.instances) {
        if (!construct2SourceIsVisible(source)) continue;
        const text = construct2SourceText(source);
        if (!text) continue;
        const rect = construct2PageRect(runtime, source);
        if (!rect) continue;

        const key = `construct2:${domSourceId(source)}`;
        seen.add(key);
        upsertEntry(key, {
          constructSource: source,
          constructRect: rect,
          text,
          width: rect.width,
          height: rect.height,
          fontSize: rect.fontSize,
          fontFace: fontFamilyWithEmojiFallback(source.facename || "sans-serif"),
          fontStyle: /italic/iu.test(String(source.fontstyle || "")) ? "italic" : "normal",
          fontWeight: /bold/iu.test(String(source.fontstyle || "")) ? "700" : "400",
          lineHeight: rect.lineHeight,
          paddingTop: rect.paddingTop,
          textAlign: construct2TextAlign(source.halign),
          updatedAt: performance.now(),
        });
      }
    }

    for (const [key, entry] of overlayState.entries) {
      if (entry.constructSource && !seen.has(key)) removeEntry(key, entry);
    }
  }

  return { install };
}

export function construct2SourceIsVisible(source) {
  if (!source || source.visible === false || Number(source.opacity) === 0) return false;
  const layer = source.layer;
  if (!layer || layer.visible === false || Number(layer.opacity) === 0) return false;
  return true;
}

export function construct2TextSegments(text) {
  const value = String(text ?? "");
  try {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return [...segmenter.segment(value)].map((segment) => segment.segment);
  } catch {
    return Array.from(value);
  }
}

function construct2Runtime() {
  try {
    return window.cr_getC2Runtime?.() || window.c2runtime || null;
  } catch {
    return window.c2runtime || null;
  }
}

function isConstruct2TextType(type) {
  const plugins = window.cr?.plugins_;
  const plugin = type?.plugin;
  if (!plugins || !plugin) return false;
  return [plugins.Text, plugins.Spritefont2].some(
    (Plugin) => typeof Plugin === "function" && plugin instanceof Plugin,
  );
}

function construct2SourceText(source) {
  try {
    source.rebuildText?.();
  } catch {
    // A partially initialized text instance still exposes its raw text.
  }
  if (Array.isArray(source.lines) && source.lines.length > 0) {
    const lines = source.lines.map((line) => String(line?.text ?? ""));
    if (lines.some(Boolean)) return lines.join("\n");
  }
  return String(source.text ?? "");
}

function construct2PageRect(runtime, source) {
  const canvas = runtime.canvas || document.querySelector("#c2canvas");
  const layer = source.layer;
  if (!(canvas instanceof HTMLCanvasElement) || !layer) return null;

  try {
    source.update_bbox?.();
  } catch {
    return null;
  }
  const quad = source.bquad;
  if (!quad) return null;

  const points = [
    [quad.tlx, quad.tly],
    [quad.trx, quad.try_],
    [quad.brx, quad.bry],
    [quad.blx, quad.bly],
  ].map(([x, y]) => ({
    x: Number(layer.layerToCanvas?.(x, y, true, true)),
    y: Number(layer.layerToCanvas?.(x, y, false, true)),
  }));
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return null;
  }

  const canvasRect = canvas.getBoundingClientRect();
  if (canvasRect.width <= 0 || canvasRect.height <= 0) return null;
  const sourceWidth = Math.abs(Number(source.width));
  const sourceHeight = Math.abs(Number(source.height));
  const geometry = cssTransformFromTopLeftCanvasQuad(
    points,
    canvasRect,
    runtime.draw_width || canvas.width,
    runtime.draw_height || canvas.height,
    sourceWidth,
    sourceHeight,
  );
  if (!geometry || !boundsIntersectRect(geometry.bounds, canvasRect)) {
    return null;
  }

  const sourceFontSize =
    Number(source.characterHeight) * (Number(source.characterScale) || 1) ||
    Number(source.pxHeight) ||
    24;
  const lineHeight =
    sourceFontSize + (Number(source.lineHeight) || Number(source.line_height_offset) || 0);
  const textHeight = Math.max(
    lineHeight,
    Number(source.textHeight) || lineHeight * Math.max(1, source.lines?.length || 1),
  );
  return {
    left: roundCssNumber(geometry.left),
    top: roundCssNumber(geometry.top),
    width: roundCssNumber(geometry.width),
    height: roundCssNumber(geometry.height),
    fontSize: roundCssNumber(sourceFontSize),
    lineHeight: roundCssNumber(Math.max(1, lineHeight)),
    paddingTop: roundCssNumber(
      (Number(source.valign) || 0) * Math.max(0, sourceHeight - textHeight),
    ),
    transform: `matrix(${roundCssNumber(geometry.matrix.a)}, ${roundCssNumber(geometry.matrix.b)}, ${roundCssNumber(geometry.matrix.c)}, ${roundCssNumber(geometry.matrix.d)}, 0, 0)`,
  };
}

function construct2TextAlign(halign) {
  const value = Number(halign);
  if (value >= 0.75) return "right";
  if (value >= 0.25) return "center";
  return "left";
}

function roundCssNumber(value) {
  return Math.round(value * 1000) / 1000;
}
