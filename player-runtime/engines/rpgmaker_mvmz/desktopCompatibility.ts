// @ts-nocheck

import { imageMimeType } from "@/shared/binary";
import { createArrayBufferObjectUrl } from "@/shared/blob";

export function installRpgMakerBrowserCompatibility() {
  const fallbackColor = "#ffffff";

  if (!Object.prototype.hasOwnProperty.call(window, "追加")) {
    try {
      Object.defineProperty(window, "追加", {
        configurable: true,
        writable: true,
        value: undefined,
      });
    } catch {
      window.追加 = undefined;
    }
  }

  function finiteInteger(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.trunc(number);
  }

  function patchTextColor() {
    const windowBase = window.Window_Base;
    const prototype = windowBase && windowBase.prototype;
    if (!prototype || typeof prototype.textColor !== "function") return;
    if (prototype.textColor.__MzPlayerRpgMakerBrowserCompat) return;

    const textColor = prototype.textColor;
    const wrappedTextColor = function(n) {
      return textColor.call(this, finiteInteger(n, 0));
    };
    Object.defineProperty(wrappedTextColor, "__MzPlayerRpgMakerBrowserCompat", {
      value: true,
    });
    prototype.textColor = wrappedTextColor;
  }

  function patchBitmapGetPixel() {
    const bitmap = window.Bitmap;
    const prototype = bitmap && bitmap.prototype;
    if (!prototype || typeof prototype.getPixel !== "function") return;
    if (prototype.getPixel.__MzPlayerRpgMakerBrowserCompat) return;

    const getPixel = prototype.getPixel;
    const wrappedGetPixel = function(x, y) {
      const numberX = Number(x);
      const numberY = Number(y);
      if (!Number.isFinite(numberX) || !Number.isFinite(numberY)) return fallbackColor;

      try {
        return getPixel.call(this, Math.trunc(numberX), Math.trunc(numberY));
      } catch (error) {
        if (error instanceof TypeError && String(error.message || "").includes("long")) {
          return fallbackColor;
        }
        throw error;
      }
    };
    Object.defineProperty(wrappedGetPixel, "__MzPlayerRpgMakerBrowserCompat", {
      value: true,
    });
    prototype.getPixel = wrappedGetPixel;
  }

  let attempts = 0;
  const patch = () => {
    attempts += 1;
    patchTextColor();
    patchBitmapGetPixel();
    if (attempts > 600) window.clearInterval(timer);
  };
  const timer = window.setInterval(patch, 100);
  patch();
}

export function installRpgMakerEncryptedExtensionBypass(
  shouldBypassEncryptedExtensionRewrite,
) {
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    const decrypter = window.Decrypter;
    if (decrypter && !decrypter.__MzPlayerEncryptedExtensionBypass) {
      Object.defineProperty(decrypter, "__MzPlayerEncryptedExtensionBypass", {
        value: true,
      });
      if (typeof decrypter.extToEncryptExt === "function") {
        const extToEncryptExt = decrypter.extToEncryptExt;
        decrypter.extToEncryptExt = function(url) {
          if (shouldBypassEncryptedExtensionRewrite(url)) return url;
          return extToEncryptExt.apply(this, arguments);
        };
      }
      if (typeof decrypter.decryptArrayBuffer === "function") {
        const decryptArrayBuffer = decrypter.decryptArrayBuffer;
        decrypter.decryptArrayBuffer = function(arrayBuffer) {
          const originalMimeType = imageMimeType(arrayBuffer);
          try {
            const result = decryptArrayBuffer.apply(this, arguments);
            if (originalMimeType && !imageMimeType(result)) return arrayBuffer;
            return result;
          } catch (error) {
            if (originalMimeType) return arrayBuffer;
            throw error;
          }
        };
      }
      if (typeof decrypter.createBlobUrl === "function") {
        const createBlobUrl = decrypter.createBlobUrl;
        decrypter.createBlobUrl = function(arrayBuffer) {
          return createArrayBufferObjectUrl(arrayBuffer, imageMimeType(arrayBuffer), () =>
            createBlobUrl.apply(this, arguments),
          );
        };
      }
      window.clearInterval(timer);
    }
    if (attempts > 300) window.clearInterval(timer);
  }, 100);
}
