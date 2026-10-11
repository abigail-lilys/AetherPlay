// @ts-nocheck

export function createRpgMakerSaveRuntime({ fileKey, vfsPathAliases }) {
  const saveChangedEvent = "MZ_PLAYER_LOCAL_SAVE_CHANGED";

  function browserRpgSaveKeyForPath(path) {
    for (const alias of vfsPathAliases(path)) {
      const key = alias.replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase();
      const saveDirectoryFile = /^(?:www\/)?save\/(.+)$/u.exec(key);
      if (saveDirectoryFile) {
        const relativePath = saveDirectoryFile[1];
        const filename = relativePath.split("/").at(-1) || relativePath;
        const slot = /^file(\d+)(?:[._-].*)?$/u.exec(filename);
        if (slot) {
          return "RPG File" + slot[1] + (filename.endsWith(".bak") ? "bak" : "");
        }
        const special = /^(config|global|shared)(?:[._-].*)?$/u.exec(filename);
        if (special) {
          return "RPG " + special[1][0].toUpperCase() + special[1].slice(1);
        }
        return "RPG Save " + relativePath;
      }
      const flatFile = /^(?:www\/)?([^/]+)$/u.exec(key)?.[1];
      if (!flatFile) continue;
      const flatSlot = /^(?:save)?file(\d+)(?:[._-].*)?$/u.exec(flatFile);
      if (flatSlot) {
        return "RPG File" + flatSlot[1] + (flatFile.endsWith(".bak") ? "bak" : "");
      }
      const flatSpecial = /^save(config|global|shared)(?:[._-].*)?$/u.exec(flatFile);
      if (flatSpecial) {
        return "RPG " + flatSpecial[1][0].toUpperCase() + flatSpecial[1].slice(1);
      }
      if (flatFile.startsWith("save")) return "RPG Save " + flatFile;
    }
    return null;
  }

  function browserRpgSaveFileNameForKey(key) {
    if (key === "RPG Config") return "config.rpgsave";
    if (key === "RPG Global") return "global.rpgsave";
    if (key === "RPG Shared") return "shared.rmmzsave";
    const match = /^RPG File(\d+)(bak)?$/u.exec(String(key));
    if (!match) return null;
    return "file" + match[1] + ".rpgsave" + (match[2] ? ".bak" : "");
  }

  function saveChangeDetail(operation, path) {
    const saveKey = browserRpgSaveKeyForPath(path);
    if (!saveKey) return null;
    return {
      operation,
      path: String(path),
      rawKey: fileKey(path),
      reason: operation + " " + saveKey,
      storageKey: saveKey,
    };
  }

  function dispatchSaveChanged(operation, path) {
    const detail = saveChangeDetail(operation, path);
    if (!detail) return;
    window.dispatchEvent(new CustomEvent(saveChangedEvent, { detail }));
  }

  function isBrowserRpgSaveDirectory(path) {
    return vfsPathAliases(path).some((alias) => {
      const key = alias.replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase();
      return key === "save" || key === "www/save";
    });
  }

  return {
    browserRpgSaveFileNameForKey,
    browserRpgSaveKeyForPath,
    dispatchSaveChanged,
    isBrowserRpgSaveDirectory,
    saveChangedEvent,
  };
}
