// @ts-nocheck

function pathWithExtension(path, extension) {
  const index = path.lastIndexOf(".");
  if (index < 0) return null;
  return path.slice(0, index) + extension;
}

function suffixedPathCandidates(path) {
  return [path + "_", path + "__", path + "___"];
}

function pathWithoutSuffixMarkers(path) {
  return path.replace(/_+$/u, "");
}

const plainImageExtensions = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const encryptedImageSuffixes = [".png_", ".png__", ".png___"];
const plainAudioExtensions = [".ogg", ".m4a", ".mp3", ".wav", ".oga"];
const encryptedAudioExtensions = [".rpgmvo", ".rpgmvm"];
const plainVideoExtensions = [".webm", ".mp4"];

export function rpgMakerAssetReferenceAliases(path) {
  const lowerPath = path.toLowerCase();
  const unsuffixedPath = pathWithoutSuffixMarkers(path);
  const lowerUnsuffixedPath = unsuffixedPath.toLowerCase();
  const candidates = [];

  function add(candidate) {
    if (candidate && candidate !== path && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  }

  for (const imageExtension of plainImageExtensions) {
    if (!lowerPath.endsWith(imageExtension)) continue;
    const stem = path.slice(0, -imageExtension.length);
    add(stem + ".rpgmvp");
    if (imageExtension === ".png") {
      for (const encryptedSuffix of encryptedImageSuffixes) {
        add(stem + encryptedSuffix);
      }
    }
    return candidates;
  }

  if (lowerPath.endsWith(".rpgmvp")) {
    for (const encryptedSuffix of encryptedImageSuffixes) {
      add(pathWithExtension(path, encryptedSuffix));
    }
    for (const imageExtension of plainImageExtensions) {
      add(pathWithExtension(path, imageExtension));
    }
    return candidates;
  }

  for (const encryptedSuffix of encryptedImageSuffixes) {
    if (!lowerPath.endsWith(encryptedSuffix)) continue;
    const stem = path.slice(0, -encryptedSuffix.length);
    add(stem + ".rpgmvp");
    for (const candidateSuffix of encryptedImageSuffixes) {
      add(stem + candidateSuffix);
    }
    for (const imageExtension of plainImageExtensions) {
      add(stem + imageExtension);
    }
    return candidates;
  }

  if (
    plainAudioExtensions.some((extension) =>
      lowerUnsuffixedPath.endsWith(extension),
    )
  ) {
    add(unsuffixedPath);
    for (const candidate of suffixedPathCandidates(unsuffixedPath)) {
      add(candidate);
    }
    for (const encryptedExtension of encryptedAudioExtensions) {
      const encryptedPath = pathWithExtension(
        unsuffixedPath,
        encryptedExtension,
      );
      add(encryptedPath);
      if (encryptedPath) {
        for (const candidate of suffixedPathCandidates(encryptedPath)) {
          add(candidate);
        }
      }
    }
    return candidates;
  }

  if (
    encryptedAudioExtensions.some((extension) =>
      lowerUnsuffixedPath.endsWith(extension),
    )
  ) {
    add(unsuffixedPath);
    for (const candidate of suffixedPathCandidates(unsuffixedPath)) {
      add(candidate);
    }
    for (const plainExtension of plainAudioExtensions) {
      const plainPath = pathWithExtension(unsuffixedPath, plainExtension);
      add(plainPath);
      if (plainPath) {
        for (const candidate of suffixedPathCandidates(plainPath)) {
          add(candidate);
        }
      }
    }
    return candidates;
  }

  if (
    plainVideoExtensions.some((extension) =>
      lowerUnsuffixedPath.endsWith(extension),
    )
  ) {
    add(unsuffixedPath);
    for (const candidate of suffixedPathCandidates(unsuffixedPath)) {
      add(candidate);
    }
    for (const videoExtension of plainVideoExtensions) {
      const videoPath = pathWithExtension(unsuffixedPath, videoExtension);
      add(videoPath);
      if (videoPath) {
        for (const candidate of suffixedPathCandidates(videoPath)) {
          add(candidate);
        }
      }
    }
    return candidates;
  }

  return candidates;
}


