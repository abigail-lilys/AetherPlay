import { afterEach, describe, expect, it, vi } from "vitest";
import { createWasmMemoryScanner } from "./memoryScanner";
describe("WASM memory scanner", () => {
  afterEach(() => { vi.useRealTimers(); });
  function fixture() {
    const buffer = new ArrayBuffer(128), data = new DataView(buffer);
    data.setInt32(0, 100, true); data.setInt32(4, 100, true); data.setInt32(8, 250, true); data.setFloat32(16, 12.5, true);
    return { data, scanner: createWasmMemoryScanner(() => buffer) };
  }
  it("finds aligned exact values and returns byte offsets", async () => {
    const { scanner } = fixture(), result = await scanner.firstScan("i32", 100, true);
    expect(result.count).toBe(2); expect(result.results.map((x) => x.offset)).toEqual([0, 4]); expect(result.scannedBytes).toBe(128);
  });
  it("narrows candidates by changed values", async () => {
    const { data, scanner } = fixture(); await scanner.firstScan("i32", 100, true); data.setInt32(4, 125, true);
    const result = await scanner.nextScan("changed"); expect(result.count).toBe(1); expect(result.results[0]).toEqual({ offset: 4, value: 125 });
  });
  it("paginates candidate addresses", async () => {
    const buffer = new ArrayBuffer(1200), data = new DataView(buffer);
    for (let offset = 0; offset < buffer.byteLength; offset += 4) data.setInt32(offset, 7, true);
    const scanner = createWasmMemoryScanner(() => buffer);
    const first = await scanner.firstScan("i32", 7);
    expect(first.count).toBe(300); expect(first.pageCount).toBe(2); expect(first.results).toHaveLength(200);
    const second = scanner.getPage(1); expect(second.page).toBe(1); expect(second.results).toHaveLength(100); expect(second.results[0].offset).toBe(800);
  });
  it("writes typed values and rejects out-of-range integers", () => {
    const { scanner } = fixture(); expect(scanner.write("i32", 0, 420)).toBe(420); expect(() => scanner.write("u8", 0, 300)).toThrow(/整数/);
  });
  it("supports float scans and rejects out-of-range addresses", async () => {
    const { scanner } = fixture(); expect((await scanner.firstScan("f32", 12.5)).count).toBe(1);
    expect(scanner.read("f32", 16)).toBeCloseTo(12.5); expect(() => scanner.read("i32", 127)).toThrow(/范围/);
  });
  it("freezes values until the address is unfrozen", () => {
    vi.useFakeTimers(); const { data, scanner } = fixture();
    expect(scanner.freezeAdd("i32", 8, 999)).toBe(1); data.setInt32(8, 2, true); vi.advanceTimersByTime(100);
    expect(data.getInt32(8, true)).toBe(999); expect(scanner.freezeRemove("i32", 8)).toBe(0);
    data.setInt32(8, 3, true); vi.advanceTimersByTime(100); expect(data.getInt32(8, true)).toBe(3);
  });
});
