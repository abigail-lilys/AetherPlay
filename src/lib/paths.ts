export function normalizeStoredPath(path: string): string {
  const decoded = path.replaceAll("\\", "/").replace(/^\/+/, "");
  const parts: string[] = [];

  for (const rawPart of decoded.split("/")) {
    const part = rawPart.trim();
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return parts.join("/");
}

export function stripCommonWrapper<T extends { path: string }>(
  entries: T[],
): T[] {
  const paths = entries
    .map((entry) => normalizeStoredPath(entry.path))
    .filter(Boolean);
  if (paths.length === 0) return entries;

  const firstSegments = paths.map((path) => path.split("/")[0]);
  const wrapper = firstSegments[0];
  const hasOneWrapper =
    Boolean(wrapper) && firstSegments.every((segment) => segment === wrapper);
  const wrapperContainsIndex = paths.some(
    (path) =>
      path === `${wrapper}/index.html` || path === `${wrapper}/www/index.html`,
  );

  if (!hasOneWrapper || !wrapperContainsIndex) {
    return entries.map((entry) => ({
      ...entry,
      path: normalizeStoredPath(entry.path),
    }));
  }

  return entries
    .map((entry) => ({
      ...entry,
      path: normalizeStoredPath(entry.path).split("/").slice(1).join("/"),
    }))
    .filter((entry) => entry.path);
}

export function findEntryPath(paths: string[]): string {
  const normalized = paths.map(normalizeStoredPath);
  if (normalized.includes("index.html")) return "index.html";
  if (normalized.includes("www/index.html")) return "www/index.html";

  const candidates = normalized.filter((path) => path.endsWith("/index.html"));
  if (candidates.length > 0) {
    return candidates.sort((a, b) => a.length - b.length)[0];
  }

  throw new Error("Could not find index.html in this game.");
}

export function titleFromEntry(paths: string[], fallback: string): string {
  const normalizedFallback = fallback.replace(/\.[^.]+$/, "").trim();
  const topSegments = paths
    .map(normalizeStoredPath)
    .map((path) => path.split("/")[0])
    .filter(Boolean);
  const first = topSegments[0];
  const commonTop =
    first && topSegments.every((segment) => segment === first) ? first : "";
  const folderTitle = commonTop && !commonTop.includes(".") ? commonTop : "";
  return folderTitle || normalizedFallback || "Imported Game";
}
