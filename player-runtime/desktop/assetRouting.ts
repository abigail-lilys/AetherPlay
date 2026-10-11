// @ts-nocheck

export function createAssetRouter(config, pathRuntime) {
  const {
    assetReferenceVariants,
    encodedFileRouteUrl,
    fileRouteReference,
    manifestReferenceAliases,
    rpgMakerAssetReferenceAliases,
  } = pathRuntime;
  const manifestUrlByRawReference = new Map();

  function addRawAssetReference(reference, url, priority = 1) {
    if (!reference) return;
    const existing = manifestUrlByRawReference.get(reference);
    if (existing && existing.priority <= priority) return;
    manifestUrlByRawReference.set(reference, { priority, url });
  }

  function addAssetReferenceVariants(reference, url, priority = 1) {
    for (const variant of assetReferenceVariants(reference)) {
      addRawAssetReference(variant, url, priority);
    }
  }

  function addFileRouteReference(reference, url, priority = 1) {
    addRawAssetReference(fileRouteReference(reference), url, priority);
  }

  for (const file of config.files) {
    const { aliases, rawPath } = manifestReferenceAliases(file.path);
    for (const alias of aliases) {
      addAssetReferenceVariants(alias, file.url, 0);
      addFileRouteReference(alias, file.url, 0);
    }
    addRawAssetReference(fileRouteReference(rawPath), file.url, 0);
  }

  for (const file of config.files) {
    const { aliases } = manifestReferenceAliases(file.path);
    for (const alias of aliases) {
      for (const assetAlias of rpgMakerAssetReferenceAliases(alias)) {
        const assetAliasUrl = encodedFileRouteUrl(assetAlias);
        addAssetReferenceVariants(assetAlias, assetAliasUrl, 1);
        addFileRouteReference(assetAlias, assetAliasUrl, 1);
      }
    }
  }

  function canonicalManifestAssetUrl(value) {
    if (typeof value !== "string") return value;

    const origin = window.location.origin;
    const isSameOriginAbsolute = value.startsWith(origin + "/");
    const reference = isSameOriginAbsolute ? value.slice(origin.length) : value;
    const canonical = manifestUrlByRawReference.get(reference)?.url;
    if (!canonical) return value;
    return isSameOriginAbsolute ? origin + canonical : canonical;
  }

  function exactManifestAssetEntry(value) {
    if (typeof value !== "string") return null;
    const origin = window.location.origin;
    const reference = value.startsWith(origin + "/")
      ? value.slice(origin.length)
      : value;
    const baseReference = reference.split("?")[0].split("#")[0];
    return (
      [reference, baseReference]
        .map((candidate) => manifestUrlByRawReference.get(candidate))
        .find((entry) => entry?.priority === 0) ?? null
    );
  }

  function shouldBypassEncryptedExtensionRewrite(value) {
    if (typeof value !== "string") return false;
    const path = value.split("?")[0].split("#")[0].toLowerCase();
    if (!path.endsWith(".png") && !path.endsWith(".ogg") && !path.endsWith(".m4a")) {
      return false;
    }
    return exactManifestAssetEntry(value) !== null;
  }

  function sanitizePlayerUrl(value) {
    if (typeof value !== "string") return value;
    return canonicalManifestAssetUrl(value).replace(/%(?![0-9A-Fa-f]{2})/g, "%25");
  }

  function sanitizeRequestInput(input) {
    if (typeof input === "string") return sanitizePlayerUrl(input);
    if (typeof URL !== "undefined" && input instanceof URL) {
      const sanitized = sanitizePlayerUrl(input.href);
      return sanitized === input.href ? input : new URL(sanitized, input.href);
    }
    if (typeof Request !== "undefined" && input instanceof Request) {
      const sanitized = sanitizePlayerUrl(input.url);
      if (sanitized === input.url || input.bodyUsed) return input;
      try {
        return new Request(sanitized, input);
      } catch {
        return input;
      }
    }
    return input;
  }

  function installUrlPatch() {
    if (window.__mzPlayerUrlPatch) return;
    Object.defineProperty(window, "__mzPlayerUrlPatch", {
      value: true,
      configurable: false,
    });

    if (typeof XMLHttpRequest !== "undefined") {
      const open = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url) {
        return open.apply(
          this,
          [method, sanitizeRequestInput(url)].concat(
            Array.prototype.slice.call(arguments, 2),
          ),
        );
      };
    }

    if (typeof window.fetch === "function") {
      const fetch = window.fetch.bind(window);
      window.fetch = function(input, init) {
        return fetch(sanitizeRequestInput(input), init);
      };
    }

    function patchSrcSetter(prototype) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "src");
      if (!descriptor || typeof descriptor.set !== "function") return;
      Object.defineProperty(prototype, "src", {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set(value) {
          descriptor.set.call(this, sanitizePlayerUrl(String(value)));
        },
      });
    }

    if (typeof HTMLImageElement !== "undefined") patchSrcSetter(HTMLImageElement.prototype);
    if (typeof HTMLMediaElement !== "undefined") patchSrcSetter(HTMLMediaElement.prototype);
    if (typeof Element !== "undefined") {
      const setAttribute = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function(name, value) {
        if (
          typeof name === "string" &&
          name.toLowerCase() === "src" &&
          ((typeof HTMLImageElement !== "undefined" && this instanceof HTMLImageElement) ||
            (typeof HTMLMediaElement !== "undefined" && this instanceof HTMLMediaElement) ||
            (typeof HTMLSourceElement !== "undefined" && this instanceof HTMLSourceElement))
        ) {
          return setAttribute.call(this, name, sanitizePlayerUrl(String(value)));
        }
        return setAttribute.apply(this, arguments);
      };
    }
  }

  return { installUrlPatch, shouldBypassEncryptedExtensionRewrite };
}
