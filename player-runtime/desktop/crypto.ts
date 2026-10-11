// @ts-nocheck
import { bytesToHex } from "@/shared/binary";
import { scheduleMicrotask } from "@/shared/browser";

export function createCryptoRuntime(options) {
  const { browserCryptoModule, enhancedBytes } = options;
  const webCrypto = window.crypto;
  const MAX_RANDOM_FILL_BYTES = 65536;
  const MAX_RANDOM_INT = 281474976710656;

  function requireWebCrypto() {
    if (!webCrypto || typeof webCrypto.getRandomValues !== "function") {
      throw new Error(
        "MzPlayerDesktop.crypto requires secure browser randomness (window.crypto.getRandomValues).",
      );
    }
    return webCrypto;
  }

  function validateNonNegativeInteger(value, name) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(name + " must be a non-negative safe integer.");
    }
    return value;
  }

  function byteView(value, name) {
    if (!ArrayBuffer.isView(value)) {
      throw new TypeError(name + " must be an ArrayBuffer view.");
    }
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  function fillRandomBytes(bytes) {
    const crypto = requireWebCrypto();
    for (let offset = 0; offset < bytes.byteLength; offset += MAX_RANDOM_FILL_BYTES) {
      crypto.getRandomValues(
        bytes.subarray(offset, Math.min(offset + MAX_RANDOM_FILL_BYTES, bytes.byteLength)),
      );
    }
    return bytes;
  }

  function deferCallback(callback, error, value) {
    const run = () => callback(error, value);
    scheduleMicrotask(run);
  }

  function randomBytes(size, callback) {
    validateNonNegativeInteger(size, "size");
    try {
      const result = enhancedBytes(fillRandomBytes(new Uint8Array(size)));
      if (callback === undefined) return result;
      if (typeof callback !== "function") {
        throw new TypeError("callback must be a function.");
      }
      deferCallback(callback, null, result);
      return undefined;
    } catch (error) {
      if (typeof callback === "function") {
        deferCallback(callback, error);
        return undefined;
      }
      throw error;
    }
  }

  function randomFillSync(buffer, offset, size) {
    const bytes = byteView(buffer, "buffer");
    const start = validateNonNegativeInteger(offset ?? 0, "offset");
    const length = validateNonNegativeInteger(size ?? bytes.byteLength - start, "size");
    if (start > bytes.byteLength || length > bytes.byteLength - start) {
      throw new RangeError("offset and size exceed the supplied buffer.");
    }
    fillRandomBytes(bytes.subarray(start, start + length));
    return buffer;
  }

  function randomFill(buffer, offset, size, callback) {
    if (typeof offset === "function") {
      callback = offset;
      offset = 0;
      size = undefined;
    } else if (typeof size === "function") {
      callback = size;
      size = undefined;
    }
    if (typeof callback !== "function") {
      throw new TypeError("callback must be a function.");
    }
    try {
      randomFillSync(buffer, offset, size);
      deferCallback(callback, null, buffer);
    } catch (error) {
      deferCallback(callback, error);
    }
  }

  function secureRandomInt(minimum, maximum) {
    if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum)) {
      throw new RangeError("randomInt bounds must be safe integers.");
    }
    const range = maximum - minimum;
    if (range <= 0 || range > MAX_RANDOM_INT) {
      throw new RangeError(
        "randomInt requires max greater than min with a range no larger than 2^48.",
      );
    }

    const limit = Math.floor(MAX_RANDOM_INT / range) * range;
    const bytes = new Uint8Array(6);
    let value;
    do {
      fillRandomBytes(bytes);
      value = 0;
      for (const byte of bytes) value = value * 256 + byte;
    } while (value >= limit);
    return minimum + (value % range);
  }

  function randomInt(min, max, callback) {
    if (typeof max === "function") {
      callback = max;
      max = min;
      min = 0;
    } else if (max === undefined) {
      max = min;
      min = 0;
    }

    try {
      const result = secureRandomInt(min, max);
      if (callback === undefined) return result;
      if (typeof callback !== "function") {
        throw new TypeError("callback must be a function.");
      }
      deferCallback(callback, null, result);
      return undefined;
    } catch (error) {
      if (typeof callback === "function") {
        deferCallback(callback, error);
        return undefined;
      }
      throw error;
    }
  }

  function randomUUID() {
    const crypto = requireWebCrypto();
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    const bytes = fillRandomBytes(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = bytesToHex(bytes);
    return (
      hex.slice(0, 8) +
      "-" +
      hex.slice(8, 12) +
      "-" +
      hex.slice(12, 16) +
      "-" +
      hex.slice(16, 20) +
      "-" +
      hex.slice(20)
    );
  }

  function timingSafeEqual(left, right) {
    const leftBytes = byteView(left, "left");
    const rightBytes = byteView(right, "right");
    if (leftBytes.byteLength !== rightBytes.byteLength) {
      throw new RangeError("Input buffers must have the same byte length.");
    }
    let difference = 0;
    for (let index = 0; index < leftBytes.byteLength; index += 1) {
      difference |= leftBytes[index] ^ rightBytes[index];
    }
    return difference === 0;
  }

  const cryptoModule = Object.freeze(Object.assign({}, browserCryptoModule, {
    randomBytes,
    randomFill,
    randomFillSync,
    randomInt,
    randomUUID,
    timingSafeEqual,
    webcrypto: webCrypto,
    subtle: webCrypto?.subtle,
    getRandomValues: function getRandomValues(value) {
      return requireWebCrypto().getRandomValues(value);
    },
  }));


  return cryptoModule;
}
