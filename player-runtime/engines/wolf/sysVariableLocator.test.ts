import { describe, expect, it } from "vitest";
import { evaluateSysTimeProgress, isPlausibleSysTimeTriple, matchesInt32Sequence } from "@/player-runtime/engines/wolf/sysVariableLocator";

describe("matchesInt32Sequence", () => {
  it("matches four adjacent little-endian Int32 values at an aligned offset", () => {
    const view = new DataView(new ArrayBuffer(64));
    [100, 0, -1, 7].forEach((value, index) => view.setInt32(16 + index * 4, value, true));
    expect(matchesInt32Sequence(view, 16, [100, 0, -1, 7])).toBe(true);
  });

  it("rejects a changed value", () => {
    const view = new DataView(new ArrayBuffer(32));
    [10, 20, 30, 40].forEach((value, index) => view.setInt32(index * 4, value, true));
    expect(matchesInt32Sequence(view, 0, [10, 20, 31, 40])).toBe(false);
  });

  it("rejects unaligned and out-of-bounds offsets", () => {
    const view = new DataView(new ArrayBuffer(32));
    expect(matchesInt32Sequence(view, 2, [0, 0, 0, 0])).toBe(false);
    expect(matchesInt32Sequence(view, 20, [0, 0, 0, 0])).toBe(false);
  });

  it("requires a signature of four to eight valid Int32 values", () => {
    const view = new DataView(new ArrayBuffer(64));
    expect(matchesInt32Sequence(view, 0, [0, 0, 0])).toBe(false);
    expect(matchesInt32Sequence(view, 0, [0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(false);
    expect(matchesInt32Sequence(view, 0, [0, 0, 0, 2147483648])).toBe(false);
  });
});


describe("Sys28/Sys29/Sys30 time-feature heuristics", () => {
  it("accepts a plausible frame/seconds/milliseconds triple", () => {
    expect(isPlausibleSysTimeTriple({ frames: 600, seconds: 10, milliseconds: 250 })).toBe(true);
    expect(isPlausibleSysTimeTriple({ frames: 2026, seconds: 2027, milliseconds: 2028 })).toBe(false);
  });

  it("matches a progressing 60 FPS counter and elapsed clock", () => {
    const result = evaluateSysTimeProgress(
      { frames: 600, seconds: 10, milliseconds: 250 },
      { frames: 660, seconds: 11, milliseconds: 250 },
      1000,
    );
    expect(result).not.toBeNull();
    expect(result?.frameDelta).toBe(60);
    expect(result?.secondsDelta).toBe(1);
    expect(result?.clockElapsedMs).toBe(1000);
    expect(result?.approximateFps).toBe(60);
  });

  it("handles frame counter and millisecond rollover", () => {
    const result = evaluateSysTimeProgress(
      { frames: 9_999_990, seconds: 165_000, milliseconds: 900 },
      { frames: 6, seconds: 165_001, milliseconds: 100 },
      250,
    );
    expect(result).not.toBeNull();
    expect(result?.frameDelta).toBe(16);
    expect(result?.clockElapsedMs).toBe(200);
  });

  it("rejects unrelated or frozen values", () => {
    expect(evaluateSysTimeProgress(
      { frames: 600, seconds: 10, milliseconds: 250 },
      { frames: 600, seconds: 10, milliseconds: 250 },
      1000,
    )).toBeNull();
  });
});
