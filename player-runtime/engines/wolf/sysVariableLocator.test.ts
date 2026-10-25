import { describe, expect, it } from "vitest";
import { matchesInt32Sequence } from "@/player-runtime/engines/wolf/sysVariableLocator";

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
