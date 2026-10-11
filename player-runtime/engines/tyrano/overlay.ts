// @ts-nocheck

import { fontFamilyWithEmojiFallback } from "@/player-runtime/bridge/overlay/textStyle";

export function createTyranoOverlayAdapter({
  domSourceId,
  overlayIsActive,
  overlayState,
  removeEntry,
  scheduleFlush,
  upsertEntry,
}) {
  function install() {
    if (overlayState.tyranoHooksInstalled) return;

    const tryInstall = () => {
      if (overlayState.tyranoHooksInstalled) return true;
      const roots = tyranoRoots();
      if (!roots.length) return false;

      overlayState.tyranoHooksInstalled = true;
      overlayState.tyranoObserver = new MutationObserver(scheduleScan);
      for (const root of roots) {
        overlayState.tyranoObserver.observe(root, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: ["class", "hidden", "style"],
        });
      }
      if (document.fonts) {
        document.fonts.ready.then(scheduleScan);
        document.fonts.addEventListener?.("loadingdone", scheduleScan);
      }
      window.addEventListener("resize", scheduleScan);
      scheduleScan();
      return true;
    };

    if (tryInstall()) return;
    setTimeout(install, 250);
  }

  function scheduleScan() {
    if (!overlayState.tyranoHooksInstalled || overlayState.tyranoScanFrame) return;
    overlayState.tyranoScanFrame = requestAnimationFrame(() => {
      overlayState.tyranoScanFrame = 0;
      scanText();
    });
  }

  function scanText() {
    if (!overlayIsActive()) return;
    const roots = tyranoRoots();
    if (!roots.length) return;

    const sources = new Set();
    for (const root of roots) {
      for (const message of root.querySelectorAll(".message_inner")) {
        const paragraphs = message.querySelectorAll(":scope > p");
        if (!paragraphs.length) {
          sources.add(message);
          continue;
        }
        for (const paragraph of paragraphs) {
          const styledSpans = paragraph.querySelectorAll(":scope > span");
          if (styledSpans.length) {
            for (const span of styledSpans) sources.add(span);
          } else {
            sources.add(paragraph);
          }
        }
      }
      for (const source of root.querySelectorAll(
        ".chara_name_area, [data-event-tag='glink'], .vchat-text-inner",
      )) {
        sources.add(source);
      }
    }

    const activeKeys = new Set();
    for (const source of sources) {
      const text = tyranoSourceText(source);
      if (!text || !domSourceIsVisible(source)) continue;

      const key = `tyrano:${domSourceId(source)}`;
      const style = getComputedStyle(source);
      const scale = domVisualScale(source);
      activeKeys.add(key);
      upsertEntry(key, {
        domSource: source,
        text,
        fontSize: parseCssNumber(style.fontSize) || 24,
        fontFace: fontFamilyWithEmojiFallback(style.fontFamily || "sans-serif"),
        fontStyle: style.fontStyle,
        fontWeight: style.fontWeight,
        fontStretch: style.fontStretch,
        fontVariant: style.fontVariant,
        fontKerning: style.fontKerning,
        fontOpticalSizing: style.fontOpticalSizing,
        fontFeatureSettings: style.fontFeatureSettings,
        fontVariationSettings: style.fontVariationSettings,
        fontSynthesis: style.fontSynthesis,
        lineHeightCss: style.lineHeight || "normal",
        textAlign: style.textAlign || "left",
        textAlignLast: style.textAlignLast,
        direction: style.direction,
        letterSpacing: style.letterSpacing,
        wordSpacing: style.wordSpacing,
        wordBreak: style.wordBreak,
        overflowWrap: style.overflowWrap,
        whiteSpace: style.whiteSpace,
        writingMode: style.writingMode,
        textOrientation: style.textOrientation,
        textRendering: style.textRendering,
        textTransform: style.textTransform,
        textIndent: style.textIndent,
        textDecorationLine: style.textDecorationLine,
        textDecorationStyle: style.textDecorationStyle,
        textDecorationThickness: style.textDecorationThickness,
        paddingTop: style.paddingTop,
        paddingRight: style.paddingRight,
        paddingBottom: style.paddingBottom,
        paddingLeft: style.paddingLeft,
        borderTopWidth: style.borderTopWidth,
        borderRightWidth: style.borderRightWidth,
        borderBottomWidth: style.borderBottomWidth,
        borderLeftWidth: style.borderLeftWidth,
        visualScaleX: scale.x,
        visualScaleY: scale.y,
        updatedAt: performance.now(),
      });
    }

    for (const [key, entry] of overlayState.entries) {
      if (entry.domSource && !activeKeys.has(key)) removeEntry(key, entry);
    }
    scheduleFlush();
  }

  return { install, scheduleScan };
}

export function domSourceIsVisible(source) {
  if (!source?.isConnected) return false;
  const style = getComputedStyle(source);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    Number(style.opacity) === 0
  ) {
    return false;
  }
  const rect = source.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function scaledCssLength(value, scale) {
  const text = String(value || "");
  const match = text.match(/^(-?\d+(?:\.\d+)?)px$/);
  return match ? `${Number(match[1]) * scale}px` : text || "normal";
}

function tyranoRoots() {
  return Array.from(document.querySelectorAll("#tyrano_base, #vchat_base"));
}

function tyranoSourceText(source) {
  const text = typeof source.innerText === "string" ? source.innerText : source.textContent;
  return String(text || "").replace(/\u00a0/g, " ").trim();
}

function parseCssNumber(value) {
  const parsed = Number.parseFloat(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function domVisualScale(source) {
  const root = source.closest("#tyrano_base, #vchat_base");
  if (!root) return { x: 1, y: 1 };
  const rect = root.getBoundingClientRect();
  const style = getComputedStyle(root);
  const layoutWidth = parseCssNumber(style.width) || root.offsetWidth;
  const layoutHeight = parseCssNumber(style.height) || root.offsetHeight;
  return {
    x: positiveScale(rect.width, layoutWidth),
    y: positiveScale(rect.height, layoutHeight),
  };
}

function positiveScale(rendered, layout) {
  const scale = Number(rendered) / Number(layout);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}
