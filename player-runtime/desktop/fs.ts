// @ts-nocheck

import { bytesToHex } from "@/shared/binary";
import {
  VFS_BINARY_PREFIX,
  VFS_DIR_PREFIX,
  VFS_FILE_PREFIX,
  VFS_META_PREFIX,
} from "@/shared/virtualFileSystem";
import { createRpgMakerSaveRuntime } from "@/player-runtime/engines/rpgmaker_mvmz/save";
import { createFsFacade } from "@/player-runtime/desktop/fsFacade";

export function createFsRuntime(options) {
  const {
    BrowserBuffer,
    bytesToBase64,
    config,
    enhancedBytes,
    pathRuntime,
  } = options;
  const {
    dirname,
    lookupManifestFile,
    manifestAliases,
    manifestDirExists,
    manifestKey,
    normalizePath,
    trimTrailingSlash,
  } = pathRuntime;

  const {
    browserRpgSaveFileNameForKey,
    browserRpgSaveKeyForPath,
    dispatchSaveChanged,
    isBrowserRpgSaveDirectory,
    saveChangedEvent: SAVE_CHANGED_EVENT,
  } = createRpgMakerSaveRuntime({ fileKey, vfsPathAliases });
  const manifestTextCache = new Map();
  const manifestBytesCache = new Map();
  const openFiles = new Map();
  let nextFileDescriptor = 100;

  function fileKey(path) {
    return VFS_FILE_PREFIX + normalizePath(path);
  }

  function dirKey(path) {
    return VFS_DIR_PREFIX + normalizePath(path);
  }

  function metaKey(path) {
    return VFS_META_PREFIX + normalizePath(path);
  }

  function vfsPathAliases(path) {
    const normalized = normalizePath(path);
    const aliases = new Set([normalized]);
    const withoutLeadingSlash = normalized.replace(/^\/+/, "");

    if (withoutLeadingSlash && withoutLeadingSlash !== ".") {
      aliases.add(withoutLeadingSlash);
      aliases.add("/" + withoutLeadingSlash);

      if (withoutLeadingSlash.toLowerCase().startsWith("www/")) {
        const withoutWebRoot = withoutLeadingSlash.slice(4);
        if (withoutWebRoot) {
          aliases.add(withoutWebRoot);
          aliases.add("/" + withoutWebRoot);
        }
      } else {
        aliases.add("www/" + withoutLeadingSlash);
        aliases.add("/www/" + withoutLeadingSlash);
      }
    }

    return Array.from(aliases);
  }

  function vfsFileKeys(path) {
    return vfsPathAliases(path).map(fileKey);
  }

  function vfsDirKeys(path) {
    return vfsPathAliases(path).map(dirKey);
  }

  function vfsMetaKeys(path) {
    return vfsPathAliases(path).map(metaKey);
  }

  function readVirtualMetadata(path) {
    for (const key of vfsMetaKeys(path)) {
      const value = window.localStorage.getItem(key);
      if (!value) continue;
      try { return JSON.parse(value); } catch { return null; }
    }
    return null;
  }

  function touchVirtualMetadata(path, isDirectory = false) {
    const existing = readVirtualMetadata(path);
    const now = Date.now();
    window.localStorage.setItem(metaKey(path), JSON.stringify({
      birthtimeMs: existing?.birthtimeMs ?? now,
      isDirectory,
      mtimeMs: now,
    }));
  }

  function fsError(code, syscall, path, dest) {
    const error = new Error(
      code +
        ": " +
        syscall +
        (path === undefined ? "" : " '" + path + "'") +
        (dest === undefined ? "" : " -> '" + dest + "'"),
    );
    error.code = code;
    error.syscall = syscall;
    if (path !== undefined) error.path = String(path);
    if (dest !== undefined) error.dest = String(dest);
    return error;
  }

  function isVirtualBinaryValue(value) {
    return String(value).startsWith(VFS_BINARY_PREFIX);
  }

  function virtualBinaryBytes(value) {
    return enhancedBytes(
      BrowserBuffer.from(String(value).slice(VFS_BINARY_PREFIX.length), "base64"),
    );
  }

  function serializeVirtualFileData(data, options) {
    if (ArrayBuffer.isView(data)) {
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      return VFS_BINARY_PREFIX + bytesToBase64(bytes);
    }
    if (data instanceof ArrayBuffer) {
      return VFS_BINARY_PREFIX + bytesToBase64(new Uint8Array(data));
    }
    const encoding = normalizeReadEncoding(options);
    if (encoding && encoding !== "utf8") {
      return VFS_BINARY_PREFIX + bytesToBase64(BrowserBuffer.from(String(data ?? ""), encoding));
    }
    return String(data ?? "");
  }

  function decodeVirtualFileValue(value, options) {
    if (isVirtualBinaryValue(value)) {
      return decodeFileBytes(virtualBinaryBytes(value), normalizeReadEncoding(options));
    }
    const encoding = normalizeReadEncoding(options);
    if (!encoding || encoding === "utf8") return value;
    return decodeFileBytes(new TextEncoder().encode(value), encoding);
  }

  function fileValueBytes(value) {
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return new TextEncoder().encode(String(value ?? ""));
  }

  function virtualFileSize(value) {
    return isVirtualBinaryValue(value)
      ? virtualBinaryBytes(value).byteLength
      : String(value ?? "").length;
  }

  function readVirtualFile(path) {
    const entry = readVirtualFileEntry(path);
    return entry ? entry.value : null;
  }

  function readVirtualFileEntry(path) {
    const saveKey = browserRpgSaveKeyForPath(path);
    if (saveKey) {
      window.localStorage.removeItem(saveKey);
    }
    for (const key of vfsFileKeys(path)) {
      const value = window.localStorage.getItem(key);
      if (value !== null) return { key, value };
    }
    return null;
  }

  function writeRawVirtualFile(path, value) {
    const saveKey = browserRpgSaveKeyForPath(path);
    if (saveKey) {
      markParentDirs(path);
      window.localStorage.setItem(fileKey(path), value);
      touchVirtualMetadata(path);
      window.localStorage.removeItem(saveKey);
      dispatchSaveChanged("write", path);
      return;
    }
    markParentDirs(path);
    window.localStorage.setItem(fileKey(path), value);
    touchVirtualMetadata(path);
  }

  function removeRawVirtualFile(path) {
    const saveKey = browserRpgSaveKeyForPath(path);
    if (saveKey) {
      window.localStorage.removeItem(saveKey);
    }
    for (const key of vfsFileKeys(path)) {
      window.localStorage.removeItem(key);
    }
    for (const key of vfsMetaKeys(path)) window.localStorage.removeItem(key);
    dispatchSaveChanged("remove", path);
  }

  function virtualFileExists(path) {
    return readVirtualFile(path) !== null;
  }

  function virtualDirExists(path) {
    return vfsDirKeys(path).some((key) => window.localStorage.getItem(key) !== null);
  }

  function isEncodingOptionText(options) {
    if (!options) return false;
    if (typeof options === "string") return options.toLowerCase() !== "buffer";
    if (typeof options === "object" && options.encoding) {
      return String(options.encoding).toLowerCase() !== "buffer";
    }
    return false;
  }

  function normalizeReadEncoding(options) {
    if (!options) return null;
    const value =
      typeof options === "string"
        ? options
        : typeof options === "object"
          ? options.encoding
          : null;
    if (value === null || value === undefined) return null;

    const encoding = String(value).toLowerCase().replace(/[-_]/g, "");
    if (encoding === "buffer") return null;
    if (encoding === "utf8") return "utf8";
    if (encoding === "utf16le" || encoding === "ucs2") return "utf16le";
    if (encoding === "ascii") return "ascii";
    if (encoding === "latin1" || encoding === "binary") return "latin1";
    if (encoding === "hex" || encoding === "base64") return encoding;
    throw new TypeError(
      "MzPlayerDesktop.fs does not support file encoding: " + value,
    );
  }

  function decodeFileBytes(bytes, encoding) {
    if (encoding === "utf8") {
      return new TextDecoder("utf-8").decode(bytes);
    }
    if (encoding === "latin1") {
      let output = "";
      for (let offset = 0; offset < bytes.length; offset += 32768) {
        output += String.fromCharCode.apply(
          null,
          bytes.subarray(offset, Math.min(offset + 32768, bytes.length)),
        );
      }
      return output;
    }
    if (encoding === "ascii" || encoding === "utf16le") {
      return BrowserBuffer.from(bytes).toString(encoding);
    }
    if (encoding === "hex") return bytesToHex(bytes);
    if (encoding === "base64") return bytesToBase64(bytes);
    return enhancedBytes(bytes);
  }

  function readManifestFileSync(path, manifestFile) {
    if (typeof XMLHttpRequest === "undefined") {
      throw new Error(
        "MzPlayerDesktop.fs.readFileSync requires XMLHttpRequest for packaged asset '" +
          path +
          "'.",
      );
    }

    const request = new XMLHttpRequest();
    request.open("GET", manifestFile.url, false);
    if (typeof request.overrideMimeType === "function") {
      request.overrideMimeType("text/plain; charset=x-user-defined");
    }
    try {
      request.send(null);
    } catch (error) {
      const detail = error instanceof Error ? ": " + error.message : "";
      throw new Error(
        "Could not synchronously read packaged asset '" + path + "'" + detail,
      );
    }

    if (request.status < 200 || request.status >= 300) {
      throw new Error(
        "Could not synchronously read packaged asset '" +
          path +
          "' (HTTP " +
          request.status +
          ").",
      );
    }

    const responseText = request.responseText ?? "";
    const bytes = new Uint8Array(responseText.length);
    for (let index = 0; index < responseText.length; index += 1) {
      bytes[index] = responseText.charCodeAt(index) & 255;
    }
    manifestBytesCache.set(manifestCacheKey(manifestFile), bytes);
    return bytes;
  }

  function manifestCacheKey(file) {
    return file.path;
  }

  function parentDirs(path) {
    const dirs = [];
    let current = dirname(path);
    while (current && current !== "." && !dirs.includes(current)) {
      dirs.push(current);
      if (current === "/") break;
      current = dirname(current);
    }
    return dirs;
  }

  function markParentDirs(path) {
    for (const dir of parentDirs(path)) {
      window.localStorage.setItem(dirKey(dir), "1");
    }
  }

  function existsSync(path) {
    return (
      virtualFileExists(path) ||
      virtualDirExists(path) ||
      lookupManifestFile(path) !== null ||
      manifestDirExists(path)
    );
  }

  function readFileSync(path, options) {
    const entry = readVirtualFileEntry(path);
    if (entry) {
      return decodeVirtualFileValue(entry.value, options);
    }

    const manifestFile = lookupManifestFile(path);
    if (manifestFile) {
      const key = manifestCacheKey(manifestFile);
      const encoding = normalizeReadEncoding(options);
      if (encoding === "utf8" && manifestTextCache.has(key)) {
        return manifestTextCache.get(key);
      }
      const bytes = manifestBytesCache.get(key) ?? readManifestFileSync(path, manifestFile);
      const result = decodeFileBytes(bytes, encoding);
      if (encoding === "utf8") {
        manifestTextCache.set(key, result);
      }
      return result;
    }

    const error = new Error("ENOENT: no such file or directory, open '" + path + "'");
    error.code = "ENOENT";
    throw error;
  }

  function writeFileSync(path, data, options) {
    writeRawVirtualFile(path, serializeVirtualFileData(data, options));
  }

  function appendFileSync(path, data, options) {
    const current = readVirtualFileEntry(path);
    const previous = current ? decodeVirtualFileValue(current.value, options) : "";
    if (ArrayBuffer.isView(previous) || ArrayBuffer.isView(data) || data instanceof ArrayBuffer) {
      const previousBytes = ArrayBuffer.isView(previous)
        ? previous
        : new TextEncoder().encode(String(previous ?? ""));
      const dataBytes = ArrayBuffer.isView(data)
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        : data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new TextEncoder().encode(String(data ?? ""));
      const combined = new Uint8Array(previousBytes.byteLength + dataBytes.byteLength);
      combined.set(previousBytes, 0);
      combined.set(dataBytes, previousBytes.byteLength);
      writeFileSync(path, combined, options);
      return;
    }
    writeFileSync(path, String(previous ?? "") + String(data ?? ""), options);
  }

  function truncateSync(path, length = 0) {
    const size = Number(length);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new RangeError("length must be a non-negative integer.");
    }
    if (!existsSync(path)) throw fsError("ENOENT", "truncate", path);
    const current = readFileSync(path);
    const currentBytes = ArrayBuffer.isView(current)
      ? new Uint8Array(current.buffer, current.byteOffset, current.byteLength)
      : new TextEncoder().encode(String(current ?? ""));
    const resized = new Uint8Array(size);
    resized.set(currentBytes.subarray(0, Math.min(size, currentBytes.byteLength)));
    writeFileSync(path, resized);
  }

  function mkdirSync(path, options) {
    void options;
    const normalized = normalizePath(path);
    window.localStorage.setItem(dirKey(normalized), "1");
    touchVirtualMetadata(normalized, true);
    markParentDirs(normalized);
  }

  function unlinkSync(path) {
    if (!readVirtualFileEntry(path)) {
      if (lookupManifestFile(path)) throw fsError("EROFS", "unlink", path);
      throw fsError("ENOENT", "unlink", path);
    }
    removeRawVirtualFile(path);
  }

  function rmSync(path) {
    const normalized = normalizePath(path);
    const saveKey = browserRpgSaveKeyForPath(normalized);
    if (saveKey) {
      window.localStorage.removeItem(saveKey);
      dispatchSaveChanged("remove", normalized);
    }
    if (isBrowserRpgSaveDirectory(normalized)) {
      for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
        const key = window.localStorage.key(index);
        if (key && browserRpgSaveFileNameForKey(key)) {
          window.localStorage.removeItem(key);
        }
      }
      window.dispatchEvent(
        new CustomEvent(SAVE_CHANGED_EVENT, {
          detail: {
            operation: "remove",
            path: normalized,
            reason: "remove RPG save directory",
          },
        }),
      );
    }
    const targets = vfsPathAliases(normalized).flatMap((alias) => {
      const fileStorageKey = fileKey(alias);
      const dirStorageKey = dirKey(alias);
      return [
        fileStorageKey,
        dirStorageKey,
        metaKey(alias),
        fileStorageKey + "/",
        dirStorageKey + "/",
        metaKey(alias) + "/",
      ];
    });
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (targets.some((target) => key === target || key?.startsWith(target))) {
        window.localStorage.removeItem(key);
      }
    }
  }

  function rmdirSync(path, options) {
    return rmSync(path, options);
  }

  function copyFileSync(source, target) {
    const sourceEntry = readVirtualFileEntry(source);
    if (!sourceEntry && !lookupManifestFile(source)) {
      throw fsError("ENOENT", "copyfile", source, target);
    }
    if (sourceEntry) {
      writeRawVirtualFile(target, sourceEntry.value);
    } else {
      writeFileSync(target, readFileSync(source));
    }
  }

  function renameSync(oldPath, newPath) {
    const sourceEntry = readVirtualFileEntry(oldPath);
    if (!sourceEntry) {
      if (lookupManifestFile(oldPath)) throw fsError("EROFS", "rename", oldPath, newPath);
      throw fsError("ENOENT", "rename", oldPath, newPath);
    }
    writeRawVirtualFile(newPath, sourceEntry.value);
    removeRawVirtualFile(oldPath);
  }

  function accessSync(path) {
    if (existsSync(path)) return;
    throw fsError("ENOENT", "access", path);
  }

  function readlinkSync(path) {
    throw fsError("ENOENT", "readlink", path);
  }

  function symlinkSync(target, path) {
    throw fsError("ENOSYS", "symlink", path, target);
  }

  function readdirSync(path, options) {
    const normalized = trimTrailingSlash(normalizePath(path));
    const vfsPrefixes = vfsPathAliases(normalized).flatMap((alias) => {
      const suffix = alias === "." || alias === "/" ? "" : trimTrailingSlash(alias) + "/";
      return [VFS_FILE_PREFIX + suffix, VFS_DIR_PREFIX + suffix];
    });
    const manifestPrefixes = !manifestKey(normalized)
      ? [""]
      : manifestAliases(normalized).map((alias) =>
          alias ? alias.replace(/\/+$/, "") + "/" : "",
        );
    const names = new Set();
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key) continue;
      const prefix = vfsPrefixes.find((candidate) => key.startsWith(candidate));
      const relative = prefix ? key.slice(prefix.length) : null;
      if (!relative) continue;
      const name = relative.split("/")[0];
      if (name) names.add(name);
    }
    if (isBrowserRpgSaveDirectory(normalized)) {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        const name = key ? browserRpgSaveFileNameForKey(key) : null;
        if (name) names.add(name);
      }
    }
    for (const file of config.files) {
      for (const prefix of manifestPrefixes) {
        const path = manifestKey(file.path);
        if (!prefix || path.startsWith(prefix)) {
          const relative = prefix ? path.slice(prefix.length) : path;
          const name = relative.split("/")[0];
          if (name) names.add(name);
        }
      }
    }
    const entries = Array.from(names);
    if (options && typeof options === "object" && options.withFileTypes) {
      return entries.map((name) => {
        const childPath = normalizePath(normalized + "/" + name);
        return {
          name,
          path: normalized,
          parentPath: normalized,
          isFile: () => existsSync(childPath) && !manifestDirExists(childPath) && !virtualDirExists(childPath),
          isDirectory: () => manifestDirExists(childPath) || virtualDirExists(childPath),
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isSymbolicLink: () => false,
          isFIFO: () => false,
          isSocket: () => false,
        };
      });
    }
    const encoding = typeof options === "string" ? options : options?.encoding;
    if (String(encoding ?? "").toLowerCase() === "buffer") {
      return entries.map((name) => BrowserBuffer.from(name));
    }
    return entries;
  }

  function makeStats(path) {
    const virtualFile = readVirtualFile(path);
    const isFile = virtualFile !== null;
    const isDirectory = virtualDirExists(path);
    const manifestFile = lookupManifestFile(path);
    const isManifestDirectory = manifestDirExists(path);
    if (!isFile && !isDirectory && !manifestFile && !isManifestDirectory) {
      const error = new Error("ENOENT: no such file or directory, stat '" + path + "'");
      error.code = "ENOENT";
      throw error;
    }
    const size = isFile
      ? virtualFileSize(virtualFile)
      : manifestFile?.size ?? 0;
    const metadata = readVirtualMetadata(path);
    const mtimeMs = metadata?.mtimeMs ?? 0;
    const birthtimeMs = metadata?.birthtimeMs ?? mtimeMs;
    const timestamp = new Date(mtimeMs);
    const birthtime = new Date(birthtimeMs);
    return {
      isFile: () => isFile || Boolean(manifestFile),
      isDirectory: () => (isDirectory || isManifestDirectory) && !isFile && !manifestFile,
      isSymbolicLink: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
      dev: 0,
      ino: 0,
      mode: isFile || manifestFile ? 0o100666 : 0o40777,
      nlink: 1,
      uid: 0,
      gid: 0,
      rdev: 0,
      size,
      blksize: 4096,
      blocks: Math.ceil(size / 512),
      atimeMs: mtimeMs,
      mtimeMs,
      ctimeMs: mtimeMs,
      birthtimeMs,
      mtime: timestamp,
      ctime: timestamp,
      atime: timestamp,
      birthtime,
    };
  }

  function realpathSync(path) {
    accessSync(path);
    return normalizePath(path);
  }

  function openSync(path, flags = "r") {
    const normalizedFlags = String(flags);
    const exists = existsSync(path);
    if (normalizedFlags.includes("x") && exists) throw fsError("EEXIST", "open", path);
    if (!exists && !/[wa+]/u.test(normalizedFlags)) throw fsError("ENOENT", "open", path);
    if (/[wa+]/u.test(normalizedFlags)) {
      if (!exists || normalizedFlags.startsWith("w")) writeFileSync(path, enhancedBytes(new Uint8Array()));
    }
    const fd = nextFileDescriptor;
    nextFileDescriptor += 1;
    openFiles.set(fd, { flags: normalizedFlags, path: normalizePath(path), position: 0 });
    return fd;
  }

  function fileForDescriptor(fd, syscall) {
    const file = openFiles.get(Number(fd));
    if (!file) throw fsError("EBADF", syscall);
    return file;
  }

  function closeSync(fd) {
    fileForDescriptor(fd, "close");
    openFiles.delete(Number(fd));
  }

  function fstatSync(fd) {
    return makeStats(fileForDescriptor(fd, "fstat").path);
  }

  function ftruncateSync(fd, length = 0) {
    truncateSync(fileForDescriptor(fd, "ftruncate").path, length);
  }

  function readSync(fd, buffer, offset = 0, length = buffer?.byteLength ?? 0, position = null) {
    const file = fileForDescriptor(fd, "read");
    const sourceBytes = fileValueBytes(readFileSync(file.path));
    const targetBytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const start = position === null ? file.position : Number(position);
    const count = Math.max(0, Math.min(Number(length), sourceBytes.byteLength - start, targetBytes.byteLength - offset));
    targetBytes.set(sourceBytes.subarray(start, start + count), Number(offset));
    if (position === null) file.position += count;
    return count;
  }

  function writeSync(fd, data, offset, length, position) {
    const file = fileForDescriptor(fd, "write");
    const existingBytes = existsSync(file.path)
      ? fileValueBytes(readFileSync(file.path))
      : new Uint8Array();
    const stringPosition = typeof data === "string" && typeof offset === "number" ? offset : null;
    const stringEncoding = typeof length === "string"
      ? length
      : typeof offset === "string"
        ? offset
        : "utf8";
    const source = typeof data === "string"
      ? BrowserBuffer.from(data, stringEncoding)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const sourceOffset = typeof data === "string" ? 0 : Number(offset ?? 0);
    const sourceLength = typeof data === "string" ? source.byteLength : Number(length ?? source.byteLength - sourceOffset);
    const start = file.flags.startsWith("a")
      ? existingBytes.byteLength
      : stringPosition !== null
        ? stringPosition
        : position === null || position === undefined
          ? file.position
          : Number(position);
    const output = new Uint8Array(Math.max(existingBytes.byteLength, start + sourceLength));
    output.set(existingBytes);
    output.set(source.subarray(sourceOffset, sourceOffset + sourceLength), start);
    writeFileSync(file.path, output);
    if (position === null || position === undefined) file.position = start + sourceLength;
    return sourceLength;
  }

  async function readManifestResponse(path) {
    const manifestFile = lookupManifestFile(path);
    if (!manifestFile) {
      const error = new Error("ENOENT: no such file or directory, open '" + path + "'");
      error.code = "ENOENT";
      throw error;
    }
    const response = await fetch(manifestFile.url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(
        "Could not read packaged asset '" + path + "' (" + response.status + ")",
      );
    }
    return { file: manifestFile, response };
  }

  async function readFileText(path) {
    const localValue = readVirtualFile(path);
    if (localValue !== null) return String(decodeVirtualFileValue(localValue, "utf8"));

    const manifestFile = lookupManifestFile(path);
    if (manifestFile) {
      const key = manifestCacheKey(manifestFile);
      if (manifestTextCache.has(key)) return manifestTextCache.get(key);
      if (manifestBytesCache.has(key)) {
        const text = decodeFileBytes(manifestBytesCache.get(key), "utf8");
        manifestTextCache.set(key, text);
        return text;
      }
    }

    const { file, response } = await readManifestResponse(path);
    const text = await response.text();
    manifestTextCache.set(manifestCacheKey(file), text);
    return text;
  }

  async function readFileBytes(path) {
    const localValue = readVirtualFile(path);
    if (localValue !== null) {
      return isVirtualBinaryValue(localValue)
        ? virtualBinaryBytes(localValue)
        : new TextEncoder().encode(localValue);
    }

    const manifestFile = lookupManifestFile(path);
    if (manifestFile) {
      const key = manifestCacheKey(manifestFile);
      if (manifestBytesCache.has(key)) return manifestBytesCache.get(key);
    }

    const { file, response } = await readManifestResponse(path);
    const bytes = new Uint8Array(await response.arrayBuffer());
    manifestBytesCache.set(manifestCacheKey(file), bytes);
    return bytes;
  }

  async function readFileCore(path, options) {
    return isEncodingOptionText(options)
      ? readFileText(path)
      : readFileBytes(path);
  }

  const { fsModule } = createFsFacade({
    accessSync,
    appendFileSync,
    closeSync,
    copyFileSync,
    existsSync,
    fileForDescriptor,
    fstatSync,
    ftruncateSync,
    makeStats,
    mkdirSync,
    openSync,
    readFileBytes,
    readFileCore,
    readFileSync,
    readFileText,
    readSync,
    readdirSync,
    readlinkSync,
    realpathSync,
    renameSync,
    rmSync,
    rmdirSync,
    symlinkSync,
    truncateSync,
    unlinkSync,
    writeFileSync,
    writeSync,
  });


  return {
    fsModule,
    readFileSync,
  };
}
