export function frameElementRect(): DOMRect | null {
  try {
    const rect = window.frameElement?.getBoundingClientRect?.();
    if (rect && rect.width > 0 && rect.height > 0) return rect;
  } catch {
    // frameElement can be blocked in unusual embed contexts.
  }
  return null;
}

export function scheduleMicrotask(callback: () => void): void {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(callback);
  } else {
    Promise.resolve().then(callback);
  }
}
