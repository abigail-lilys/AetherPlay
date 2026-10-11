// @ts-nocheck

import { hashText, rectsIntersect } from "@/player-runtime/bridge/overlay/geometry";
import {
  canvasFontFace,
  canvasFontSize,
  canvasFontTraits,
  fontFamilyWithEmojiFallback,
} from "@/player-runtime/bridge/overlay/textStyle";

const OWNER_ID = "__mzPlayerTextOverlayOwnerId";

export function preferredRpgMakerDrawCall(calls, rawText) {
  const text = String(rawText ?? "");
  const matching = calls.filter((call) => call.text === text);
  const candidates = matching.length > 0 ? matching : calls;
  return candidates.findLast?.((call) => call.kind === "fill") ||
    [...candidates].reverse().find((call) => call.kind === "fill") ||
    candidates[candidates.length - 1] ||
    null;
}

export function renderedRpgMakerText(rawText, drawCall) {
  return String(drawCall?.text ?? rawText ?? "");
}

export function createRpgMakerOverlay({
  entryIsVisible,
  overlayIsActive,
  overlayState,
  ownerBelongsToScene,
  refreshRpgMakerFontMetrics,
  removeEntry,
  scheduleFlush,
  upsertEntry,
}) {
  function installRpgMakerOverlayHooks() {
    const install = () => {
      if (!window.Bitmap || !window.Window_Base || !window.Window || !window.Graphics) return false;

      if (overlayState.installedHooks) {
        hookRpgMakerTextMethods();
        return true;
      }

      overlayState.installedHooks = true;
      installSceneHooks();
      installCanvasTextHooks();
      hookRpgMakerTextMethods();
      scheduleRpgMakerTextRehook();
      if (document.fonts) {
        document.fonts.ready.then(refreshRpgMakerFontMetrics);
        document.fonts.addEventListener?.("loadingdone", refreshRpgMakerFontMetrics);
      }

      const bitmapClear = Bitmap.prototype.clear;
      Bitmap.prototype.clear = function () {
        forgetBitmap(this);
        return bitmapClear.apply(this, arguments);
      };

      const bitmapClearRect = Bitmap.prototype.clearRect;
      Bitmap.prototype.clearRect = function (x, y, width, height) {
        forgetBitmapRect(this, x, y, width, height);
        return bitmapClearRect.apply(this, arguments);
      };

      const createContents = Window_Base.prototype.createContents;
      Window_Base.prototype.createContents = function () {
        const previousContents = this.contents;
        const result = createContents.apply(this, arguments);
        if (previousContents && previousContents !== this.contents) {
          forgetBitmap(previousContents);
        }
        if (this.contents) trackBitmapOwner(this.contents, this);
        return result;
      };

      const windowMove = Window.prototype.move;
      Window.prototype.move = function () {
        const result = windowMove.apply(this, arguments);
        scheduleFlush();
        return result;
      };

      const windowUpdateTransform = Window.prototype.updateTransform;
      Window.prototype.updateTransform = function () {
        const result = windowUpdateTransform.apply(this, arguments);
        if (overlayIsActive()) scheduleFlush();
        return result;
      };

      const windowDestroy = Window.prototype.destroy;
      if (typeof windowDestroy === "function") {
        Window.prototype.destroy = function () {
          forgetOwner(this);
          const result = windowDestroy.apply(this, arguments);
          scheduleFlush();
          return result;
        };
      }

      return true;
    };

    if (install()) return;
    setTimeout(installRpgMakerOverlayHooks, 250);
  }

  function hookRpgMakerTextMethods() {
    const bitmapDrawText = window.Bitmap?.prototype?.drawText;
    if (typeof bitmapDrawText === "function" && !bitmapDrawText.__mzPlayerTextOverlayHook) {
      const hookedBitmapDrawText = function (text, x, y, maxWidth, lineHeight, align) {
        const previousCapture = overlayState.activeRpgMakerDrawCapture;
        const drawCapture = { bitmap: this, calls: [] };
        overlayState.activeRpgMakerDrawCapture = drawCapture;
        overlayState.canvasTextCaptureDepth++;
        try {
          const result = bitmapDrawText.apply(this, arguments);
          if (!drawCapture.innerCaptured) {
            captureBitmapText(
              this,
              text,
              x,
              y,
              maxWidth,
              lineHeight,
              align,
              preferredRpgMakerDrawCall(drawCapture.calls, text),
            );
          }
          return result;
        } finally {
          overlayState.canvasTextCaptureDepth--;
          overlayState.activeRpgMakerDrawCapture = previousCapture;
          if (previousCapture) {
            previousCapture.calls.push(...drawCapture.calls);
            previousCapture.innerCaptured = true;
          }
        }
      };
      Object.defineProperty(hookedBitmapDrawText, "__mzPlayerTextOverlayHook", { value: true });
      Bitmap.prototype.drawText = hookedBitmapDrawText;
    }

    const drawTextEx = window.Window_Base?.prototype?.drawTextEx;
    if (typeof drawTextEx === "function" && !drawTextEx.__mzPlayerTextOverlayHook) {
      const hookedDrawTextEx = function () {
        if (this.contents) trackBitmapOwner(this.contents, this);
        return drawTextEx.apply(this, arguments);
      };
      Object.defineProperty(hookedDrawTextEx, "__mzPlayerTextOverlayHook", { value: true });
      Window_Base.prototype.drawTextEx = hookedDrawTextEx;
    }
  }

  function scheduleRpgMakerTextRehook() {
    if (overlayState.rpgMakerRehookScheduled) return;
    overlayState.rpgMakerRehookScheduled = true;
    const rehook = () => {
      hookRpgMakerTextMethods();
      scheduleFlush();
    };
    window.addEventListener("load", rehook, { once: true });
    window.setTimeout(rehook, 750);
    window.setTimeout(rehook, 2500);
  }

  function installCanvasTextHooks() {
    const canvasContext = window.CanvasRenderingContext2D;
    const prototype = canvasContext && canvasContext.prototype;
    if (!prototype || prototype.__mzPlayerTextOverlayCanvasHooks) return;

    Object.defineProperty(prototype, "__mzPlayerTextOverlayCanvasHooks", {
      value: true,
      configurable: true,
    });

    const fillText = prototype.fillText;
    if (typeof fillText === "function") {
      prototype.fillText = function (text, x, y, maxWidth) {
        recordRpgMakerDrawCall(this, "fill", text, x, y, maxWidth);
        const result = fillText.apply(this, arguments);
        captureCanvasText(this, text, x, y, maxWidth);
        return result;
      };
    }

    const strokeText = prototype.strokeText;
    if (typeof strokeText === "function") {
      prototype.strokeText = function (text, x, y, maxWidth) {
        recordRpgMakerDrawCall(this, "stroke", text, x, y, maxWidth);
        const result = strokeText.apply(this, arguments);
        captureCanvasText(this, text, x, y, maxWidth);
        return result;
      };
    }
  }

  function recordRpgMakerDrawCall(context, kind, rawText, x, y, maxWidth) {
    const capture = overlayState.activeRpgMakerDrawCapture;
    const binding = overlayState.contextOwners.get(context);
    if (!capture || !binding || binding.bitmap !== capture.bitmap) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    let metrics;
    try {
      metrics = context.measureText(String(rawText ?? ""));
    } catch {
      metrics = null;
    }

    capture.calls.push({
      kind,
      text: String(rawText ?? ""),
      x: Number(x),
      y: Number(y),
      maxWidth: Number(maxWidth),
      font: String(context.font || ""),
      textAlign: String(context.textAlign || "left"),
      textBaseline: String(context.textBaseline || "alphabetic"),
      fontKerning: context.fontKerning,
      fontStretch: context.fontStretch,
      fontVariantCaps: context.fontVariantCaps,
      letterSpacing: context.letterSpacing,
      wordSpacing: context.wordSpacing,
      direction: context.direction,
      measuredWidth: Number(metrics?.width) || 0,
      actualBoundingBoxAscent: Number(metrics?.actualBoundingBoxAscent),
      actualBoundingBoxDescent: Number(metrics?.actualBoundingBoxDescent),
    });
  }

  function trackBitmapOwner(bitmap, owner) {
    if (!bitmap || !owner) return;
    overlayState.bitmapOwners.set(bitmap, owner);
    const context = bitmap._context;
    if (context) overlayState.contextOwners.set(context, { bitmap, owner });
  }

  function installSceneHooks() {
    installSceneManagerHooks();
    installSceneBaseHooks();
  }

  function installSceneManagerHooks() {
    if (overlayState.sceneHooksInstalled) return;

    const sceneManager = window.SceneManager;
    if (!sceneManager) {
      setTimeout(installSceneHooks, 250);
      return;
    }

    overlayState.sceneHooksInstalled = true;
    overlayState.lastScene = sceneManager._scene || null;

    const changeScene = sceneManager.changeScene;
    if (typeof changeScene === "function") {
      sceneManager.changeScene = function () {
        const result = changeScene.apply(this, arguments);
        handleSceneMaybeChanged(this._scene || null);
        return result;
      };
    }

    const updateScene = sceneManager.updateScene;
    if (typeof updateScene === "function") {
      sceneManager.updateScene = function () {
        const result = updateScene.apply(this, arguments);
        handleSceneMaybeChanged(this._scene || null);
        return result;
      };
    }
  }

  function installSceneBaseHooks() {
    if (overlayState.sceneBaseHooksInstalled) return;

    const sceneBase = window.Scene_Base;
    const terminate = sceneBase?.prototype?.terminate;
    if (typeof terminate !== "function") {
      setTimeout(installSceneBaseHooks, 250);
      return;
    }

    overlayState.sceneBaseHooksInstalled = true;
    sceneBase.prototype.terminate = function () {
      forgetScene(this);
      const result = terminate.apply(this, arguments);
      scheduleFlush();
      return result;
    };
  }

  function handleSceneMaybeChanged(scene) {
    if (scene === overlayState.lastScene) return;

    overlayState.lastScene = scene || null;
    pruneInvisibleEntries();
    scheduleFlush();
  }

  function pruneInvisibleEntries() {
    for (const [key, entry] of overlayState.entries) {
      if (!entryIsVisible(entry)) removeEntry(key, entry);
    }
  }

  function ownerId(owner) {
    if (!owner[OWNER_ID]) owner[OWNER_ID] = overlayState.nextOwnerId++;
    return owner[OWNER_ID];
  }

  function forgetBitmap(bitmap) {
    if (!overlayState.bitmapOwners.get(bitmap)) return;
    for (const [key, entry] of overlayState.entries) {
      if (entry.bitmap === bitmap) removeEntry(key, entry);
    }
    for (const [key, group] of overlayState.lineGroups) {
      if (group.bitmap === bitmap) overlayState.lineGroups.delete(key);
    }
  }

  function forgetBitmapRect(bitmap, x, y, width, height) {
    const owner = overlayState.bitmapOwners.get(bitmap);
    if (!owner) return;
    const clearRect = {
      x: Number(x) || 0,
      y: Number(y) || 0,
      width: Number(width) || 0,
      height: Number(height) || 0,
    };
    if (clearRect.width >= bitmap.width * 0.9 && clearRect.height >= bitmap.height * 0.9) {
      forgetBitmap(bitmap);
      return;
    }
    for (const [key, entry] of overlayState.entries) {
      if (entry.bitmap === bitmap && rectsIntersect(clearRect, entry)) removeEntry(key, entry);
    }
    for (const [key, group] of overlayState.lineGroups) {
      if (group.bitmap === bitmap && rectsIntersect(clearRect, group)) {
        const entry = overlayState.entries.get(group.entryKey);
        if (entry) removeEntry(group.entryKey, entry);
        overlayState.lineGroups.delete(key);
      }
    }
  }

  function forgetScene(scene) {
    for (const [key, entry] of overlayState.entries) {
      if (ownerBelongsToScene(entry.owner, scene)) removeEntry(key, entry);
    }

    for (const [key, group] of overlayState.lineGroups) {
      if (ownerBelongsToScene(group.owner, scene)) overlayState.lineGroups.delete(key);
    }
  }

  function forgetOwner(owner) {
    for (const [key, entry] of overlayState.entries) {
      if (entry.owner === owner) removeEntry(key, entry);
    }

    for (const [key, group] of overlayState.lineGroups) {
      if (group.owner === owner) overlayState.lineGroups.delete(key);
    }
  }

  function captureBitmapText(bitmap, rawText, x, y, maxWidth, lineHeight, align, drawCall) {
    const owner = overlayState.bitmapOwners.get(bitmap);
    if (!owner || rawText === undefined || rawText === null) return;
    trackBitmapOwner(bitmap, owner);
    const text = renderedRpgMakerText(rawText, drawCall);
    if (!text) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const height = Number(lineHeight) || owner.lineHeight?.() || bitmap.fontSize || 24;
    const widthLimit = Number(maxWidth) || 0xffffffff;
    if (y < -height || y >= bitmap.height || x > bitmap.width || x + widthLimit < 0) return;
    if (owner._checkWordWrapMode) return;

    const fontSize = canvasFontSize(drawCall, bitmap, owner);
    const fontTraits = canvasFontTraits(drawCall, bitmap);
    const measuredWidth = Math.max(1, drawCall?.measuredWidth || safeMeasure(bitmap, text));
    const adjustedX = adjustedTextLeft(x, widthLimit, measuredWidth, align);
    const normalizedY = Math.round(y);
    const alignmentBox = alignmentTextBox(x, widthLimit, measuredWidth, align);
    const baseline = rpgMakerCanvasBaseline(drawCall, normalizedY, height, fontSize);
    const choice = rpgMakerChoiceInfo(owner, bitmap, adjustedX, normalizedY, measuredWidth, height);

    if (text.length === 1) {
      captureLineCharacter(
        owner,
        bitmap,
        text,
        adjustedX,
        normalizedY,
        measuredWidth,
        height,
        baseline,
        fontSize,
        fontTraits,
        choice,
        drawCall,
      );
      return;
    }

    const key = [
      ownerId(owner),
      Math.round(alignmentBox.x),
      normalizedY,
      Math.round(alignmentBox.width),
      Math.round(height),
      alignmentBox.textAlign,
      choice?.index ?? "",
      hashText(text),
    ].join(":");

    upsertEntry(key, {
      owner,
      bitmap,
      text,
      x: alignmentBox.x,
      y: normalizedY,
      width: alignmentBox.width,
      height,
      baseline,
      fontSize,
      fontFace: fontFamilyWithEmojiFallback(
        canvasFontFace(drawCall) || bitmap.fontFace || owner.standardFontFace?.() || "sans-serif",
      ),
      ...fontTraits,
      textAlign: alignmentBox.textAlign,
      choiceIndex: choice?.index,
      choiceSprite: choice?.sprite,
      choiceLocalRect: choice?.rect,
      updatedAt: performance.now(),
    });
  }

  function captureCanvasText(context, rawText, x, y, maxWidth) {
    if (overlayState.canvasTextCaptureDepth > 0) return;
    const binding = overlayState.contextOwners.get(context);
    if (!binding?.owner || rawText === undefined || rawText === null) return;

    const text = String(rawText);
    if (!text) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const bitmap = binding.bitmap;
    const owner = binding.owner;
    const fontSize = canvasFontSize(context, bitmap, owner);
    const height = Math.max(1, owner.lineHeight?.() || Math.ceil(fontSize * 1.25));
    const measuredWidth = safeMeasureCanvas(context, bitmap, text);
    const width = Math.max(1, Math.min(measuredWidth, Number(maxWidth) || measuredWidth));
    const left = canvasTextLeft(x, width, context.textAlign);
    const top = canvasTextTop(y, fontSize, height, context.textBaseline);

    if (top < -height || top >= bitmap.height || left > bitmap.width || left + width < 0) return;
    if (owner._checkWordWrapMode) return;

    const key = [
      ownerId(owner),
      "canvas",
      Math.round(left),
      Math.round(top),
      Math.round(width),
      Math.round(height),
      hashText(text),
    ].join(":");

    const fontTraits = canvasFontTraits(context, bitmap);
    upsertEntry(key, {
      owner,
      bitmap,
      text,
      x: left,
      y: top,
      width,
      height,
      fontSize,
      fontFace: fontFamilyWithEmojiFallback(
        canvasFontFace(context) || bitmap.fontFace || owner.standardFontFace?.() || "sans-serif",
      ),
      ...fontTraits,
      textAlign: "left",
      updatedAt: performance.now(),
    });
  }

  function captureLineCharacter(
    owner,
    bitmap,
    text,
    x,
    y,
    measuredWidth,
    height,
    baseline,
    fontSize,
    fontTraits,
    choice,
    drawCall,
  ) {
    const ownerKey = ownerId(owner);
    const key = `${ownerKey}:line:${Math.round(y)}:${Math.round(height)}:${fontSize}:${drawCall?.font || bitmap.fontFace || ""}:${choice?.index ?? ""}`;
    const now = performance.now();
    let group = overlayState.lineGroups.get(key);

    if (!group || x < group.lastX - Math.max(8, height * 0.35) || now - group.updatedAt > 5000) {
      group = {
        owner,
        bitmap,
        text: "",
        characterSegments: [],
        x,
        y,
        width: 0,
        height,
        baseline,
        fontSize,
        fontFace: fontFamilyWithEmojiFallback(
          canvasFontFace(drawCall) || bitmap.fontFace || owner.standardFontFace?.() || "sans-serif",
        ),
        ...fontTraits,
        choiceIndex: choice?.index,
        choiceSprite: choice?.sprite,
        choiceLocalRect: choice?.rect,
        lastX: x,
        updatedAt: now,
        entryKey: key,
      };
      overlayState.lineGroups.set(key, group);
    }

    group.text += text;
    group.characterSegments.push({ text, x, width: measuredWidth });
    group.x = Math.min(group.x, x);
    group.width = Math.max(group.width, x + measuredWidth - group.x);
    group.lastX = x + measuredWidth;
    group.updatedAt = now;

    upsertEntry(group.entryKey, {
      owner: group.owner,
      bitmap: group.bitmap,
      text: group.text,
      x: group.x,
      y: group.y,
      width: Math.max(group.width, 1),
      height: group.height,
      baseline: group.baseline,
      fontSize: group.fontSize,
      fontFace: group.fontFace,
      fontStyle: group.fontStyle,
      fontWeight: group.fontWeight,
      fontKerning: group.fontKerning,
      fontStretch: group.fontStretch,
      fontVariantCaps: group.fontVariantCaps,
      letterSpacing: group.letterSpacing,
      wordSpacing: group.wordSpacing,
      direction: group.direction,
      characterSegments: group.characterSegments,
      choiceIndex: group.choiceIndex,
      choiceSprite: group.choiceSprite,
      choiceLocalRect: group.choiceLocalRect,
      updatedAt: group.updatedAt,
    });
  }

  function safeMeasure(bitmap, text) {
    try {
      return Math.max(1, bitmap.measureTextWidth(text));
    } catch {
      return Math.max(1, text.length * (bitmap.fontSize || 24) * 0.6);
    }
  }

  function safeMeasureCanvas(context, bitmap, text) {
    try {
      return Math.max(1, context.measureText(text).width);
    } catch {
      return Math.max(1, text.length * (canvasFontSize(context, bitmap, null) || 24) * 0.6);
    }
  }

  function rpgMakerCanvasBaseline(drawCall, y, lineHeight, fontSize) {
    if (!Number.isFinite(drawCall?.y)) {
      return y + lineHeight / 2 + fontSize * 0.35;
    }

    const baseline = String(drawCall.textBaseline || "alphabetic");
    if (baseline === "alphabetic") return drawCall.y;

    const ascent = Number.isFinite(drawCall.actualBoundingBoxAscent)
      ? drawCall.actualBoundingBoxAscent
      : fontSize * 0.8;
    const descent = Number.isFinite(drawCall.actualBoundingBoxDescent)
      ? drawCall.actualBoundingBoxDescent
      : fontSize * 0.2;
    if (baseline === "top" || baseline === "hanging") return drawCall.y + ascent;
    if (baseline === "middle") return drawCall.y + (ascent - descent) / 2;
    if (baseline === "bottom" || baseline === "ideographic") return drawCall.y - descent;
    return drawCall.y;
  }

  function rpgMakerChoiceInfo(owner, bitmap, x, y, width, height) {
    if (!owner || !rpgMakerChoiceWindow(owner)) return null;

    const spriteChoices = Array.isArray(owner._selectImgList) ? owner._selectImgList : [];
    const spriteIndex = spriteChoices.findIndex((sprite) => sprite?._textSprite?.bitmap === bitmap);
    if (spriteIndex >= 0) {
      return { index: spriteIndex, sprite: spriteChoices[spriteIndex] };
    }

    const maxItems = Math.min(1000, Math.max(0, Number(owner.maxItems?.()) || 0));
    let best = null;
    for (let index = 0; index < maxItems; index += 1) {
      let rect;
      try {
        rect = owner.itemRectForText?.(index) || owner.itemRect?.(index);
      } catch {
        continue;
      }
      if (!rect) continue;
      const candidate = {
        x: Number(rect.x) || 0,
        y: Number(rect.y) || 0,
        width: Math.max(1, Number(rect.width) || 0),
        height: Math.max(1, Number(rect.height) || height),
      };
      const overlapX = Math.max(0, Math.min(x + width, candidate.x + candidate.width) - Math.max(x, candidate.x));
      const overlapY = Math.max(0, Math.min(y + height, candidate.y + candidate.height) - Math.max(y, candidate.y));
      const score = overlapX * overlapY;
      if (score > 0 && (!best || score > best.score)) best = { index, rect: candidate, score };
    }
    return best ? { index: best.index, rect: best.rect } : null;
  }

  function rpgMakerChoiceWindow(owner) {
    const ChoiceList = window.Window_ChoiceList;
    if (typeof ChoiceList === "function") {
      try {
        if (owner instanceof ChoiceList) return true;
      } catch {
        // Constructor checks can fail across plugin realms; use the name fallback below.
      }
    }
    return /choice/iu.test(String(owner?.constructor?.name || ""));
  }

  function canvasTextLeft(x, width, align) {
    if (align === "center") return x - width / 2;
    if (align === "right" || align === "end") return x - width;
    return x;
  }

  function canvasTextTop(y, fontSize, height, baseline) {
    if (baseline === "top" || baseline === "hanging") return y;
    if (baseline === "middle") return y - height / 2;
    if (baseline === "bottom" || baseline === "ideographic") return y - height;
    return y - fontSize;
  }

  function adjustedTextLeft(x, maxWidth, measuredWidth, align) {
    if (align === "center") return x + Math.max(0, (maxWidth - measuredWidth) / 2);
    if (align === "right") return x + Math.max(0, maxWidth - measuredWidth);
    return x;
  }

  function alignmentTextBox(x, maxWidth, measuredWidth, align) {
    const widthLimit = Number(maxWidth) || 0;
    const canUseBox = (align === "center" || align === "right") && widthLimit > 0 && widthLimit < 0xffffffff;

    if (canUseBox) {
      return {
        x,
        width: Math.max(widthLimit, 1),
        textAlign: align,
      };
    }

    return {
      x: adjustedTextLeft(x, maxWidth, measuredWidth, align),
      width: Math.max(measuredWidth, 1),
      textAlign: "left",
    };
  }


  return { install: installRpgMakerOverlayHooks };
}
