// @ts-nocheck

import { scheduleMicrotask } from "@/shared/browser";

export function createFsFacade({
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
}) {
  function nodeCallback(callback, error, value) {
    const run = () => callback(error, value);
    scheduleMicrotask(run);
  }

  function nodeCallbackArgs(callback, args) {
    const run = () => callback.apply(null, args);
    scheduleMicrotask(run);
  }

  function requireCallback(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("callback must be a function.");
    }
  }

  function withOptionalCallback(operation, callback) {
    if (callback === undefined) return operation();
    requireCallback(callback);
    try {
      const result = operation();
      nodeCallback(callback, null, result);
    } catch (error) {
      nodeCallback(callback, error);
    }
    return undefined;
  }

  function promiseFromSync(operation) {
    return new Promise((resolve, reject) => {
      try {
        resolve(operation());
      } catch (error) {
        reject(error);
      }
    });
  }

  function readFileCallback(path, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = undefined;
    }
    if (callback === undefined) return readFileCore(path, options);
    requireCallback(callback);
    readFileCore(path, options).then(
      (value) => nodeCallback(callback, null, value),
      (error) => nodeCallback(callback, error),
    );
    return undefined;
  }

  function appendFile(path, data, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = undefined;
    }
    return withOptionalCallback(() => appendFileSync(path, data, options), callback);
  }

  function writeFile(path, data, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = undefined;
    }
    return withOptionalCallback(() => writeFileSync(path, data, options), callback);
  }

  function rename(oldPath, newPath, callback) {
    return withOptionalCallback(() => renameSync(oldPath, newPath), callback);
  }

  function copyFile(source, target, mode, callback) {
    if (typeof mode === "function") {
      callback = mode;
      mode = undefined;
    }
    void mode;
    return withOptionalCallback(() => copyFileSync(source, target), callback);
  }

  function unlink(path, callback) {
    return withOptionalCallback(() => unlinkSync(path), callback);
  }

  function rm(path, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = undefined;
    }
    return withOptionalCallback(() => rmSync(path, options), callback);
  }

  function mkdir(path, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = undefined;
    }
    return withOptionalCallback(() => mkdirSync(path, options), callback);
  }

  function readdir(path, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = undefined;
    }
    return withOptionalCallback(() => readdirSync(path, options), callback);
  }

  function stat(path, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = undefined;
    }
    void options;
    return withOptionalCallback(() => makeStats(path), callback);
  }

  function lstat(path, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = undefined;
    }
    void options;
    return withOptionalCallback(() => makeStats(path), callback);
  }

  function access(path, mode, callback) {
    if (typeof mode === "function") {
      callback = mode;
      mode = undefined;
    }
    void mode;
    return withOptionalCallback(() => accessSync(path), callback);
  }

  function exists(path, callback) {
    requireCallback(callback);
    const result = existsSync(path);
    scheduleMicrotask(() => callback(result));
  }

  function realpath(path, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = undefined;
    }
    void options;
    return withOptionalCallback(() => realpathSync(path), callback);
  }

  function truncate(path, length, callback) {
    if (typeof length === "function") {
      callback = length;
      length = 0;
    }
    return withOptionalCallback(() => truncateSync(path, length), callback);
  }

  function open(path, flags, mode, callback) {
    if (typeof mode === "function") {
      callback = mode;
      mode = undefined;
    }
    void mode;
    return withOptionalCallback(() => openSync(path, flags), callback);
  }

  function close(fd, callback) {
    return withOptionalCallback(() => closeSync(fd), callback);
  }

  function fstat(fd, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = undefined;
    }
    void options;
    return withOptionalCallback(() => fstatSync(fd), callback);
  }

  function ftruncate(fd, length, callback) {
    if (typeof length === "function") {
      callback = length;
      length = 0;
    }
    return withOptionalCallback(() => ftruncateSync(fd, length), callback);
  }

  function read(fd, buffer, offset, length, position, callback) {
    requireCallback(callback);
    try {
      const bytesRead = readSync(fd, buffer, offset, length, position);
      nodeCallbackArgs(callback, [null, bytesRead, buffer]);
    } catch (error) {
      nodeCallback(callback, error);
    }
  }

  function write(fd, data, offset, length, position, callback) {
    if (typeof data === "string") {
      if (typeof length === "function") {
        callback = length;
        length = undefined;
      } else if (typeof position === "function") {
        callback = position;
        position = undefined;
      }
    }
    requireCallback(callback);
    try {
      const bytesWritten = writeSync(fd, data, offset, length, position);
      nodeCallbackArgs(callback, [null, bytesWritten, data]);
    } catch (error) {
      nodeCallback(callback, error);
    }
  }

  realpath.native = realpath;
  realpathSync.native = realpathSync;

  const fsPromises = {
    readFile: readFileCore,
    writeFile: (path, data, options) => promiseFromSync(() => writeFileSync(path, data, options)),
    appendFile: (path, data, options) => promiseFromSync(() => appendFileSync(path, data, options)),
    rename: (oldPath, newPath) => promiseFromSync(() => renameSync(oldPath, newPath)),
    copyFile: (source, target, mode) => {
      void mode;
      return promiseFromSync(() => copyFileSync(source, target));
    },
    unlink: (path) => promiseFromSync(() => unlinkSync(path)),
    rm: (path, options) => promiseFromSync(() => rmSync(path, options)),
    mkdir: (path, options) => promiseFromSync(() => mkdirSync(path, options)),
    readdir: (path, options) => promiseFromSync(() => readdirSync(path, options)),
    stat: (path, options) => {
      void options;
      return promiseFromSync(() => makeStats(path));
    },
    lstat: (path, options) => {
      void options;
      return promiseFromSync(() => makeStats(path));
    },
    access: (path, mode) => {
      void mode;
      return promiseFromSync(() => accessSync(path));
    },
    realpath: (path, options) => {
      void options;
      return promiseFromSync(() => realpathSync(path));
    },
    truncate: (path, length) => promiseFromSync(() => truncateSync(path, length)),
    open: (path, flags, mode) => {
      void mode;
      return promiseFromSync(() => {
        const fd = openSync(path, flags);
        return {
          fd,
          close: () => promiseFromSync(() => closeSync(fd)),
          read: (buffer, offset, length, position) => promiseFromSync(() => ({
            buffer,
            bytesRead: readSync(fd, buffer, offset, length, position),
          })),
          readFile: (options) => promiseFromSync(() => readFileSync(fileForDescriptor(fd, "readFile").path, options)),
          stat: () => promiseFromSync(() => fstatSync(fd)),
          truncate: (length) => promiseFromSync(() => ftruncateSync(fd, length)),
          write: (data, offset, length, position) => promiseFromSync(() => ({
            buffer: data,
            bytesWritten: writeSync(fd, data, offset, length, position),
          })),
          writeFile: (data, options) => promiseFromSync(() => writeFileSync(fileForDescriptor(fd, "writeFile").path, data, options)),
        };
      });
    },
  };

  const fsConstants = Object.freeze({
    F_OK: 0,
    R_OK: 4,
    W_OK: 2,
    X_OK: 1,
    COPYFILE_EXCL: 1,
    COPYFILE_FICLONE: 2,
    COPYFILE_FICLONE_FORCE: 4,
  });

  const fsModule = {
    constants: fsConstants,
    existsSync,
    exists,
    access,
    accessSync,
    appendFileSync,
    appendFile,
    close,
    closeSync,
    copyFile,
    copyFileSync,
    lstat,
    fstat,
    fstatSync,
    ftruncate,
    ftruncateSync,
    mkdirSync,
    mkdir,
    promises: fsPromises,
    readFile: readFileCallback,
    readFileText,
    readFileBytes,
    readFileSync,
    read,
    readSync,
    readlinkSync,
    readdir,
    realpath,
    realpathSync,
    rename,
    renameSync,
    rm,
    writeFileSync,
    writeFile,
    write,
    unlinkSync,
    unlink,
    rmSync,
    rmdirSync,
    readdirSync,
    stat,
    statSync: makeStats,
    lstatSync: makeStats,
    symlinkSync,
    open,
    openSync,
    truncate,
    truncateSync,
    writeSync,
  };
  return { fsModule };
}

