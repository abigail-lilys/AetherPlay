// @ts-nocheck
import { bytesToHex, imageMimeType } from "@/shared/binary";
import { createArrayBufferObjectUrl } from "@/shared/blob";

const RPG_MAKER_HEADER_HEX = "5250474d560000000003010000000000";
const ENCRYPTION_FALLBACK_INSTALL_INTERVAL_MS = 10;
const MAX_ENCRYPTION_FALLBACK_INSTALL_ATTEMPTS = 500;
const PNG_HEADER_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const OGG_HEADER_BYTES = new Uint8Array([0x4f, 0x67, 0x67, 0x53]);
const RIFF_HEADER_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
const WAVE_HEADER_BYTES = new Uint8Array([0x57, 0x41, 0x56, 0x45]);
const ID3_HEADER_BYTES = new Uint8Array([0x49, 0x44, 0x33]);
const MP4_FTYP_HEADER_BYTES = new Uint8Array([0x66, 0x74, 0x79, 0x70]);

function startsWithBytes(bytes, expected) {
  if (!bytes || bytes.byteLength < expected.byteLength) return false;
  for (let index = 0; index < expected.byteLength; index += 1) {
    if (bytes[index] !== expected[index]) return false;
  }
  return true;
}

function hasRpgMakerHeader(bytes) {
  if (!bytes || bytes.byteLength < 32) return false;
  return bytesToHex(bytes.slice(0, 16)) === RPG_MAKER_HEADER_HEX;
}

function isImageArrayBuffer(arrayBuffer) {
  return Boolean(imageMimeType(arrayBuffer));
}

function isAudioArrayBuffer(arrayBuffer) {
  if (!arrayBuffer) return false;
  const bytes = new Uint8Array(arrayBuffer);
  if (startsWithBytes(bytes, OGG_HEADER_BYTES)) return true;
  if (startsWithBytes(bytes, ID3_HEADER_BYTES)) return true;
  if (bytes.byteLength >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return true;
  if (
    bytes.byteLength >= 12 &&
    startsWithBytes(bytes, RIFF_HEADER_BYTES) &&
    startsWithBytes(bytes.slice(8, 12), WAVE_HEADER_BYTES)
  ) {
    return true;
  }
  return bytes.byteLength >= 12 && startsWithBytes(bytes.slice(4, 8), MP4_FTYP_HEADER_BYTES);
}

function isMediaArrayBuffer(arrayBuffer) {
  return isImageArrayBuffer(arrayBuffer) || isAudioArrayBuffer(arrayBuffer);
}

function repairRpgMakerEncryptedPng(arrayBuffer, defaultResult) {
  const encryptedBytes = new Uint8Array(arrayBuffer || new ArrayBuffer(0));
  if (!hasRpgMakerHeader(encryptedBytes)) {
    if (defaultResult) return defaultResult;
    throw new Error("Header is wrong");
  }

  const body = new Uint8Array(arrayBuffer.slice(16));
  for (let index = 0; index < PNG_HEADER_BYTES.byteLength; index += 1) {
    body[index] = PNG_HEADER_BYTES[index];
  }

  return body.buffer;
}

function createImageBlobUrl(arrayBuffer) {
  const mimeType = imageMimeType(arrayBuffer);
  return createArrayBufferObjectUrl(arrayBuffer, mimeType, () =>
    Decrypter.createBlobUrl(arrayBuffer),
  );
}

function decryptImageArrayBufferWithFallback(arrayBuffer, defaultDecrypt) {
  if (imageMimeType(arrayBuffer)) return arrayBuffer;

  let defaultResult;
  try {
    defaultResult = defaultDecrypt(arrayBuffer);
  } catch (error) {
    defaultResult = undefined;
  }

  if (imageMimeType(defaultResult)) return defaultResult;
  return repairRpgMakerEncryptedPng(arrayBuffer, defaultResult);
}

function decryptMediaArrayBufferWithFallback(arrayBuffer, defaultDecrypt) {
  if (isMediaArrayBuffer(arrayBuffer)) return arrayBuffer;

  let defaultResult;
  try {
    defaultResult = defaultDecrypt(arrayBuffer);
  } catch (error) {
    defaultResult = undefined;
  }

  if (isMediaArrayBuffer(defaultResult)) return defaultResult;
  return repairRpgMakerEncryptedPng(arrayBuffer, defaultResult);
}

function patchUtilsDecryptArrayBuffer() {
  const utils = window.Utils;
  if (
    !utils ||
    typeof utils.decryptArrayBuffer !== "function" ||
    utils.decryptArrayBuffer.__MzPlayerEncryptionFallback
  ) {
    return false;
  }

  const decryptArrayBuffer = utils.decryptArrayBuffer;
  utils.decryptArrayBuffer = function (arrayBuffer) {
    return decryptMediaArrayBufferWithFallback(arrayBuffer, (source) => {
      return decryptArrayBuffer.call(this, source);
    });
  };
  Object.defineProperty(utils.decryptArrayBuffer, "__MzPlayerEncryptionFallback", {
    value: true,
  });
  return true;
}

function patchDecrypterDecryptImg() {
  const decrypter = window.Decrypter;
  if (
    !decrypter ||
    typeof decrypter.decryptImg !== "function" ||
    typeof decrypter.decryptArrayBuffer !== "function" ||
    decrypter.decryptImg.__MzPlayerEncryptionFallback
  ) {
    return false;
  }

  decrypter.decryptImg = function (url, bitmap) {
    url = this.extToEncryptExt(url);

    const requestFile = new XMLHttpRequest();
    requestFile.open("GET", url);
    requestFile.responseType = "arraybuffer";
    requestFile.send();

    requestFile.onload = function () {
      if (this.status < Decrypter._xhrOk) {
        const arrayBuffer = decryptImageArrayBufferWithFallback(requestFile.response, (source) => {
          return Decrypter.decryptArrayBuffer(source);
        });
        bitmap._image.addEventListener("load", bitmap._loadListener = Bitmap.prototype._onLoad.bind(bitmap));
        bitmap._image.addEventListener(
          "error",
          bitmap._errorListener = bitmap._loader || Bitmap.prototype._onError.bind(bitmap),
        );
        bitmap._image.src = createImageBlobUrl(arrayBuffer);
      }
    };

    requestFile.onerror = function () {
      if (bitmap._loader) {
        bitmap._loader();
      } else {
        bitmap._onError();
      }
    };
  };
  Object.defineProperty(decrypter.decryptImg, "__MzPlayerEncryptionFallback", {
    value: true,
  });
  return true;
}

export function installRpgMakerEncryptionFallback() {
  const state = window.__mzPlayerEncryptionFallbackState || {
    attempts: 0,
    decrypter: false,
    timer: undefined,
    utils: false,
  };
  window.__mzPlayerEncryptionFallbackState = state;

  const install = () => {
    state.utils = patchUtilsDecryptArrayBuffer() || state.utils;
    state.decrypter = patchDecrypterDecryptImg() || state.decrypter;
    window.__mzPlayerEncryptionFallbackInstalled = state.utils || state.decrypter;
    return window.__mzPlayerEncryptionFallbackInstalled;
  };

  if (install() && state.utils && state.decrypter) return;
  if (state.timer) return;

  state.timer = setInterval(() => {
    const done = install();
    state.attempts += 1;
    if ((done && state.utils && state.decrypter) || state.attempts >= MAX_ENCRYPTION_FALLBACK_INSTALL_ATTEMPTS) {
      clearInterval(state.timer);
      state.timer = undefined;
    }
  }, ENCRYPTION_FALLBACK_INSTALL_INTERVAL_MS);
}
