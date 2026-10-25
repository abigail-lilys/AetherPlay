export function matchesInt32Sequence(view: DataView, byteOffset: number, values: readonly number[]): boolean {
  if (!Number.isSafeInteger(byteOffset) || byteOffset < 0 || byteOffset % 4 !== 0) return false;
  if (values.length < 4 || values.length > 8 || byteOffset + values.length * 4 > view.byteLength) return false;
  for (let index = 0; index < values.length; index += 1) {
    const expected = values[index];
    if (!Number.isInteger(expected) || expected < -2147483648 || expected > 2147483647) return false;
    if (view.getInt32(byteOffset + index * 4, true) !== expected) return false;
  }
  return true;
}

export interface SysTimeTriple {
  frames: number;
  seconds: number;
  milliseconds: number;
}

export interface SysTimeProgress {
  frameDelta: number;
  secondsDelta: number;
  millisecondsDelta: number;
  clockElapsedMs: number;
  elapsedMs: number;
  approximateFps: number;
  clockErrorMs: number;
}

/**
 * Low-memory prefilter for the documented WOLF Sys28/Sys29/Sys30 order.
 * This is a candidate heuristic, not proof that a triple is the system table.
 */
export function isPlausibleSysTimeTriple(value: SysTimeTriple): boolean {
  const { frames, seconds, milliseconds } = value;
  if (!Number.isInteger(frames) || frames < 1 || frames >= 10_000_000) return false;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 2_000_000) return false;
  if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 1999) return false;
  // Sys28 loops at ten million. Before that wrap, frame/second ratio should be
  // compatible with ordinary running game loops, allowing low/high FPS.
  return frames >= seconds * 5 && frames <= seconds * 240 + 240;
}

/**
 * Validate two Sys28/29/30 snapshots from the same live WASM instance.
 * Requires plausible frame progression and a seconds+milliseconds clock that
 * agrees with the measured delay. A null result means "not a match".
 */
export function evaluateSysTimeProgress(
  before: SysTimeTriple,
  after: SysTimeTriple,
  elapsedMs: number,
): SysTimeProgress | null {
  if (!isPlausibleSysTimeTriple(before)) return null;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 250 || elapsedMs > 30_000) return null;
  if (!Number.isInteger(after.frames) || after.frames < 0 || after.frames >= 10_000_000) return null;
  if (!Number.isInteger(after.seconds) || after.seconds < before.seconds || after.seconds > 2_000_000) return null;
  if (!Number.isInteger(after.milliseconds) || after.milliseconds < 0 || after.milliseconds > 1999) return null;

  const frameDelta = (after.frames - before.frames + 10_000_000) % 10_000_000;
  const secondsDelta = after.seconds - before.seconds;
  const millisecondsDelta = after.milliseconds - before.milliseconds;
  const clockElapsedMs = secondsDelta * 1000 + millisecondsDelta;
  const approximateFps = frameDelta * 1000 / elapsedMs;
  const clockErrorMs = Math.abs(clockElapsedMs - elapsedMs);
  // Sys30 may briefly exceed 999 at a frame boundary, so allow a broad boundary tolerance.
  const maximumClockErrorMs = Math.max(1500, elapsedMs * 0.4);

  if (frameDelta < 1 || approximateFps < 5 || approximateFps > 240) return null;
  if (secondsDelta > Math.ceil(elapsedMs / 1000) + 1) return null;
  if (clockElapsedMs < 0 || clockErrorMs > maximumClockErrorMs) return null;

  return { frameDelta, secondsDelta, millisecondsDelta, clockElapsedMs, elapsedMs, approximateFps, clockErrorMs };
}

