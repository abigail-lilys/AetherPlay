export function setWritableProperty(
  target: Record<PropertyKey, unknown>,
  key: PropertyKey,
  value: unknown,
): boolean {
  try {
    target[key] = value;
    if (target[key] === value) return true;
  } catch {
    // Some host objects reject direct assignment.
  }

  try {
    Object.defineProperty(target, key, {
      configurable: true,
      value,
      writable: true,
    });
    return true;
  } catch {
    return false;
  }
}
