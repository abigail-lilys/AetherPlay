export const WASM_SCAN_TYPES = ["i8", "u8", "i16", "u16", "i32", "u32", "f32", "f64"] as const;
export type WasmScanType = (typeof WASM_SCAN_TYPES)[number];
export type WasmScanFilter = "changed" | "unchanged" | "increased" | "decreased" | "equal";
export interface WasmScanResult { offset: number; value: number }
export interface WasmScanSummary { scanType: WasmScanType; count: number; scannedBytes: number; truncated: boolean; aligned: boolean; page: number; pageCount: number; results: WasmScanResult[] }
export interface WasmMemoryScanner {
  firstScan(type: WasmScanType, value: number, aligned?: boolean): Promise<WasmScanSummary>;
  nextScan(filter: WasmScanFilter, value?: number): Promise<WasmScanSummary>;
  getPage(page: number): WasmScanSummary;
  resetScan(): void;
  read(type: WasmScanType, offset: number): number;
  write(type: WasmScanType, offset: number, value: number): number;
  freezeAdd(type: WasmScanType, offset: number, value: number): number;
  freezeRemove(type: WasmScanType, offset: number): number;
  freezeClear(): void;
  frozenCount(): number;
}
const MAX_CANDIDATES = 50_000, RESULT_PAGE_SIZE = 200, CHUNK_BYTES = 2 * 1024 * 1024, MAX_FREEZES = 256;
type BufferProvider = () => ArrayBufferLike | undefined;
type Candidate = { offset: number; value: number };
type FreezeEntry = { type: WasmScanType; offset: number; value: number };
const TYPE_BYTES: Record<WasmScanType, number> = { i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, f32: 4, f64: 8 };
function assertFinite(value: number): void { if (!Number.isFinite(value)) throw new Error("请输入有效的有限数值。"); }
function assertType(type: WasmScanType): void { if (!(WASM_SCAN_TYPES as readonly string[]).includes(type)) throw new Error("不支持的内存数值类型。"); }
function assertOffset(view: DataView, type: WasmScanType, offset: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + TYPE_BYTES[type] > view.byteLength) throw new Error("内存地址超出当前 WASM 内存范围。请重新扫描后再试。");
}
function readAt(view: DataView, type: WasmScanType, offset: number): number {
  assertType(type); assertOffset(view, type, offset);
  switch (type) {
    case "i8": return view.getInt8(offset); case "u8": return view.getUint8(offset);
    case "i16": return view.getInt16(offset, true); case "u16": return view.getUint16(offset, true);
    case "i32": return view.getInt32(offset, true); case "u32": return view.getUint32(offset, true);
    case "f32": return view.getFloat32(offset, true); case "f64": return view.getFloat64(offset, true);
  }
}
function writeAt(view: DataView, type: WasmScanType, offset: number, value: number): void {
  assertType(type); assertFinite(value); assertOffset(view, type, offset);
  const limits: Partial<Record<WasmScanType, [number, number]>> = {
    i8: [-128, 127], u8: [0, 255], i16: [-32768, 32767], u16: [0, 65535],
    i32: [-2147483648, 2147483647], u32: [0, 4294967295],
  };
  const limit = limits[type];
  if (limit && (!Number.isInteger(value) || value < limit[0] || value > limit[1])) throw new Error(`${type} 的写入值必须是 ${limit[0]} 至 ${limit[1]} 之间的整数。`);
  switch (type) {
    case "i8": view.setInt8(offset, value); break; case "u8": view.setUint8(offset, value); break;
    case "i16": view.setInt16(offset, value, true); break; case "u16": view.setUint16(offset, value, true); break;
    case "i32": view.setInt32(offset, value, true); break; case "u32": view.setUint32(offset, value, true); break;
    case "f32": view.setFloat32(offset, value, true); break; case "f64": view.setFloat64(offset, value, true); break;
  }
}
function valuesEqual(a: number, b: number, type: WasmScanType): boolean {
  if (type !== "f32" && type !== "f64") return a === b;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Object.is(a, b);
  return Math.abs(a - b) <= Math.max(1e-5, Math.abs(b) * 1e-5);
}
function yieldToRuntime(): Promise<void> { return new Promise((resolve) => setTimeout(resolve, 0)); }

export function createWasmMemoryScanner(getBuffer: BufferProvider): WasmMemoryScanner {
  let scanType: WasmScanType | undefined, aligned = true, candidates: Candidate[] = [], truncated = false;
  const freezes = new Map<string, FreezeEntry>();
  let freezeTimer: ReturnType<typeof globalThis.setInterval> | undefined;
  function currentView(): DataView {
    const buffer = getBuffer();
    if (!buffer || buffer.byteLength <= 0) throw new Error("尚未取得可读的 WASM 内存。请重新探测，确认游戏已完成启动。");
    return new DataView(buffer);
  }
  const freezeKey = (type: WasmScanType, offset: number) => `${type}:${offset}`;
  function updateFreezeTimer(): void {
    if (freezes.size > 0 && freezeTimer === undefined) {
      freezeTimer = globalThis.setInterval(() => {
        for (const entry of freezes.values()) { try { writeAt(currentView(), entry.type, entry.offset, entry.value); } catch { /* Ignore stale offsets. */ } }
      }, 100);
    } else if (freezes.size === 0 && freezeTimer !== undefined) { globalThis.clearInterval(freezeTimer); freezeTimer = undefined; }
  }
  function summary(scannedBytes: number, page = 0): WasmScanSummary {
    const pageCount = Math.max(1, Math.ceil(candidates.length / RESULT_PAGE_SIZE));
    if (!Number.isSafeInteger(page) || page < 0 || page >= pageCount) throw new Error("结果页码超出范围。");
    const start = page * RESULT_PAGE_SIZE;
    return { scanType: scanType ?? "i32", count: candidates.length, scannedBytes, truncated, aligned, page, pageCount, results: candidates.slice(start, start + RESULT_PAGE_SIZE).map(({ offset, value }) => ({ offset, value })) };
  }
  async function firstScan(type: WasmScanType, value: number, useAlignment = true): Promise<WasmScanSummary> {
    assertType(type); assertFinite(value);
    const scanBytes = currentView().byteLength, width = TYPE_BYTES[type], stride = useAlignment ? width : 1;
    const found: Candidate[] = []; let totalMatches = 0;
    scanType = type; aligned = useAlignment; candidates = []; truncated = false;
    for (let chunkStart = 0; chunkStart < scanBytes; chunkStart += CHUNK_BYTES) {
      const view = currentView(), safeLength = Math.min(scanBytes, view.byteLength), chunkEnd = Math.min(chunkStart + CHUNK_BYTES, scanBytes);
      let offset = useAlignment ? Math.ceil(chunkStart / width) * width : chunkStart;
      for (; offset < chunkEnd && offset + width <= safeLength; offset += stride) {
        const actual = readAt(view, type, offset);
        if (!valuesEqual(actual, value, type)) continue;
        totalMatches += 1; if (found.length < MAX_CANDIDATES) found.push({ offset, value: actual });
      }
      await yieldToRuntime();
    }
    candidates = found; truncated = totalMatches > MAX_CANDIDATES; return summary(scanBytes);
  }
  async function nextScan(filter: WasmScanFilter, value?: number): Promise<WasmScanSummary> {
    if (!scanType) throw new Error("请先执行首次扫描。");
    if (!( ["changed", "unchanged", "increased", "decreased", "equal"] as const).includes(filter)) throw new Error("不支持的复筛条件。");
    if (filter === "equal") { if (value === undefined) throw new Error("请输入要筛选的数值。"); assertFinite(value); }
    const before = candidates, retained: Candidate[] = [], width = TYPE_BYTES[scanType];
    for (let start = 0; start < before.length; start += 4096) {
      const view = currentView(), end = Math.min(start + 4096, before.length);
      for (let index = start; index < end; index += 1) {
        const candidate = before[index]; if (candidate.offset + width > view.byteLength) continue;
        const now = readAt(view, scanType, candidate.offset);
        const keep = filter === "changed" ? !valuesEqual(now, candidate.value, scanType)
          : filter === "unchanged" ? valuesEqual(now, candidate.value, scanType)
          : filter === "increased" ? now > candidate.value
          : filter === "decreased" ? now < candidate.value : valuesEqual(now, value as number, scanType);
        if (keep) retained.push({ offset: candidate.offset, value: now });
      }
      await yieldToRuntime();
    }
    candidates = retained; return summary(currentView().byteLength);
  }
  function getPage(page: number): WasmScanSummary { return summary(currentView().byteLength, page); }
  function resetScan(): void { scanType = undefined; candidates = []; truncated = false; aligned = true; }
  function read(type: WasmScanType, offset: number): number { return readAt(currentView(), type, offset); }
  function write(type: WasmScanType, offset: number, value: number): number { writeAt(currentView(), type, offset, value); return readAt(currentView(), type, offset); }
  function freezeAdd(type: WasmScanType, offset: number, value: number): number {
    assertType(type); assertFinite(value);
    const key = freezeKey(type, offset);
    if (!freezes.has(key) && freezes.size >= MAX_FREEZES) throw new Error(`最多锁定 ${MAX_FREEZES} 个内存地址。`);
    writeAt(currentView(), type, offset, value); freezes.set(key, { type, offset, value }); updateFreezeTimer(); return freezes.size;
  }
  function freezeRemove(type: WasmScanType, offset: number): number { freezes.delete(freezeKey(type, offset)); updateFreezeTimer(); return freezes.size; }
  function freezeClear(): void { freezes.clear(); updateFreezeTimer(); }
  return { firstScan, nextScan, getPage, resetScan, read, write, freezeAdd, freezeRemove, freezeClear, frozenCount: () => freezes.size };
}
