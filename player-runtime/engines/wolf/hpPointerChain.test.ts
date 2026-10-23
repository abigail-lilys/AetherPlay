import { describe, expect, it } from "vitest";
import {
  resolveWolfHpPointerChain,
  writeWolfHpPointerChain,
  WOLF_HP_ROOT_POINTER_OFFSET,
} from "./hpPointerChain";

const SIZE = 0x00600000;
const P1 = 0x00500000;
const P2 = 0x00510000;
const P3 = 0x00520000;

function fixture(hp = 77) {
  const view = new DataView(new ArrayBuffer(SIZE));
  view.setUint32(WOLF_HP_ROOT_POINTER_OFFSET, P1, true);
  view.setUint32(P1 + 0x84, P2, true);
  view.setUint32(P2, P3, true);
  view.setInt32(P3 + 8, hp, true);
  return view;
}

describe("WOLF live HP pointer chain", () => {
  it("resolves the pointer chain", () => {
    const result = resolveWolfHpPointerChain(fixture());
    expect(result.p1).toBe(P1);
    expect(result.slotOffset).toBe(P1 + 0x84);
    expect(result.p2).toBe(P2);
    expect(result.p3).toBe(P3);
    expect(result.hpAddress).toBe(P3 + 8);
    expect(result.hpValue).toBe(77);
  });

  it("re-resolves changed pointers instead of caching old addresses", () => {
    const view = fixture();
    const old = resolveWolfHpPointerChain(view);
    const p2 = 0x00530000, p3 = 0x00540000;
    view.setUint32(P1 + 0x84, p2, true);
    view.setUint32(p2, p3, true);
    view.setInt32(p3 + 8, 88, true);
    const next = resolveWolfHpPointerChain(view);
    expect(next.hpAddress).not.toBe(old.hpAddress);
    expect(next.hpValue).toBe(88);
  });

  it("writes and verifies HP when the recorded old value matches", () => {
    const view = fixture();
    expect(writeWolfHpPointerChain(view, 77, 999).hpValue).toBe(999);
    expect(view.getInt32(P3 + 8, true)).toBe(999);
  });

  it("rejects a stale old value without changing HP", () => {
    const view = fixture(78);
    expect(() => writeWolfHpPointerChain(view, 77, 999)).toThrow(/写入已取消/u);
    expect(view.getInt32(P3 + 8, true)).toBe(78);
  });

  it("rejects null and out-of-range pointers", () => {
    const zero = fixture();
    zero.setUint32(WOLF_HP_ROOT_POINTER_OFFSET, 0, true);
    expect(() => resolveWolfHpPointerChain(zero)).toThrow(/指针无效/u);
    const invalid = fixture();
    invalid.setUint32(WOLF_HP_ROOT_POINTER_OFFSET, 0xfffffffc, true);
    expect(() => resolveWolfHpPointerChain(invalid)).toThrow(/指针无效/u);
  });

  it("rejects values outside Int32", () => {
    expect(() => writeWolfHpPointerChain(fixture(), 77, 2147483648)).toThrow(/Int32/u);
  });
});
