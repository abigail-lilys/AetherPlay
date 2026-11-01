export const WASM_SCAN_TYPES = ["i8", "u8", "i16", "u16", "i32", "u32", "f32", "f64"] as const;
export type WasmScanType = (typeof WASM_SCAN_TYPES)[number];
export type WasmScanFilter =
  | "changed" | "unchanged" | "increased" | "decreased"
  | "equal" | "not-equal" | "greater" | "less" | "between";
export interface WasmScanResult { offset: number; value: number }
export interface WasmScanSummary {
  scanType: WasmScanType;
  count: number;
  scannedBytes: number;
  truncated: boolean;
  aligned: boolean;
  page: number;
  pageCount: number;
  results: WasmScanResult[];
  unknownBaselinePending: boolean;
  scanStartOffset: number;
  scanEndOffset: number;
}
export interface WasmMemoryScanner {
  firstScan(type: WasmScanType, value: number, aligned?: boolean): Promise<WasmScanSummary>;
  firstUnknownScan(type: WasmScanType, aligned?: boolean, startOffset?: number, endOffset?: number): Promise<WasmScanSummary>;
  nextScan(filter: WasmScanFilter, value?: number, value2?: number): Promise<WasmScanSummary>;
  getPage(page: number): WasmScanSummary;
  resetScan(): void;
  read(type: WasmScanType, offset: number): number;
  write(type: WasmScanType, offset: number, value: number): number;
  freezeAdd(type: WasmScanType, offset: number, value: number): number;
  freezeRemove(type: WasmScanType, offset: number): number;
  freezeClear(): void;
  frozenCount(): number;
}
const MAX_CANDIDATES = 50_000;
const RESULT_PAGE_SIZE = 200;
const CHUNK_BYTES = 2 * 1024 * 1024;
const MAX_FREEZES = 256;
const MAX_UNKNOWN_SNAPSHOT_BYTES = 128 * 1024 * 1024;
type BufferProvider = () => ArrayBufferLike | undefined;
type Candidate = { offset: number; value: number };
type FreezeEntry = { type: WasmScanType; offset: number; value: number };
const TYPE_BYTES: Record<WasmScanType, number> = {
  i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, f32: 4, f64: 8,
};

function assertFinite(value: number): void {
  if (!Number.isFinite(value)) throw new Error("请输入有效的有限数值。");
}
function assertType(type: WasmScanType): void {
  if (!(WASM_SCAN_TYPES as readonly string[]).includes(type)) throw new Error("不支持的内存数值类型。");
}
function assertOffset(view: DataView, type: WasmScanType, offset: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + TYPE_BYTES[type] > view.byteLength) {
    throw new Error("内存地址超出当前 WASM 内存范围。请重新扫描后再试。");
  }
}
function readAt(view: DataView, type: WasmScanType, offset: number): number {
  assertType(type);
  assertOffset(view, type, offset);
  switch (type) {
    case "i8": return view.getInt8(offset);
    case "u8": return view.getUint8(offset);
    case "i16": return view.getInt16(offset, true);
    case "u16": return view.getUint16(offset, true);
    case "i32": return view.getInt32(offset, true);
    case "u32": return view.getUint32(offset, true);
    case "f32": return view.getFloat32(offset, true);
    case "f64": return view.getFloat64(offset, true);
  }
}
function writeAt(view: DataView, type: WasmScanType, offset: number, value: number): void {
  assertType(type);
  assertFinite(value);
  assertOffset(view, type, offset);
  const limits: Partial<Record<WasmScanType, [number, number]>> = {
    i8: [-128, 127], u8: [0, 255], i16: [-32768, 32767], u16: [0, 65535],
    i32: [-2147483648, 2147483647], u32: [0, 4294967295],
  };
  const limit = limits[type];
  if (limit && (!Number.isInteger(value) || value < limit[0] || value > limit[1])) {
    throw new Error(`${type} 的写入值必须是 ${limit[0]} 至 ${limit[1]} 之间的整数。`);
  }
  switch (type) {
    case "i8": view.setInt8(offset, value); break;
    case "u8": view.setUint8(offset, value); break;
    case "i16": view.setInt16(offset, value, true); break;
    case "u16": view.setUint16(offset, value, true); break;
    case "i32": view.setInt32(offset, value, true); break;
    case "u32": view.setUint32(offset, value, true); break;
    case "f32": view.setFloat32(offset, value, true); break;
    case "f64": view.setFloat64(offset, value, true); break;
  }
}
function valuesEqual(a: number, b: number, type: WasmScanType): boolean {
  if (type !== "f32" && type !== "f64") return a === b;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Object.is(a, b);
  return Math.abs(a - b) <= Math.max(1e-5, Math.abs(b) * 1e-5);
}
function yieldToRuntime(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
function compareValue(now: number, previous: number, type: WasmScanType, filter: WasmScanFilter, value?: number, value2?: number): boolean {
  switch (filter) {
    case "changed": return !valuesEqual(now, previous, type);
    case "unchanged": return valuesEqual(now, previous, type);
    case "increased": return now > previous;
    case "decreased": return now < previous;
    case "equal": return valuesEqual(now, value as number, type);
    case "not-equal": return !valuesEqual(now, value as number, type);
    case "greater": return now > (value as number);
    case "less": return now < (value as number);
    case "between": return now >= (value as number) && now <= (value2 as number);
  }
}
function validateFilter(filter: WasmScanFilter, value?: number, value2?: number): void {
  if (!( ["changed", "unchanged", "increased", "decreased", "equal", "not-equal", "greater", "less", "between"] as const).includes(filter)) {
    throw new Error("不支持的复筛条件。");
  }
  if (["equal", "not-equal", "greater", "less", "between"].includes(filter)) {
    if (value === undefined) throw new Error("当前复筛条件需要输入目标值。");
    assertFinite(value);
  }
  if (filter === "between") {
    if (value === undefined || value2 === undefined) throw new Error("范围筛选需要输入最小值和最大值。");
    assertFinite(value2);
    if (value > value2) throw new Error("范围最小值不能大于最大值。");
  }
}

export function createWasmMemoryScanner(getBuffer: BufferProvider): WasmMemoryScanner {
  let scanType: WasmScanType | undefined;
  let aligned = true;
  let candidates: Candidate[] = [];
  let truncated = false;
  let unknownBaseline: Uint8Array | undefined;
  let scanStartOffset = 0;
  let scanEndOffset = 0;
  let scannedBytes = 0;
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
        for (const entry of freezes.values()) {
          try { writeAt(currentView(), entry.type, entry.offset, entry.value); }
          catch { /* Ignore stale offsets. */ }
        }
      }, 100);
    } else if (freezes.size === 0 && freezeTimer !== undefined) {
      globalThis.clearInterval(freezeTimer);
      freezeTimer = undefined;
    }
  }
  function summary(page = 0): WasmScanSummary {
    const pageCount = Math.max(1, Math.ceil(candidates.length / RESULT_PAGE_SIZE));
    if (!Number.isSafeInteger(page) || page < 0 || page >= pageCount) throw new Error("结果页码超出范围。");
    const start = page * RESULT_PAGE_SIZE;
    return {
      scanType: scanType ?? "i32", count: candidates.length, scannedBytes, truncated, aligned,
      page, pageCount,
      results: candidates.slice(start, start + RESULT_PAGE_SIZE).map(({ offset, value }) => ({ offset, value })),
      unknownBaselinePending: Boolean(unknownBaseline), scanStartOffset, scanEndOffset,
    };
  }
  async function firstScan(type: WasmScanType, value: number, useAlignment = true): Promise<WasmScanSummary> {
    assertType(type); assertFinite(value);
    const scanBytes = currentView().byteLength, width = TYPE_BYTES[type], stride = useAlignment ? width : 1;
    const found: Candidate[] = []; let totalMatches = 0;
    scanType = type; aligned = useAlignment; candidates = []; truncated = false; unknownBaseline = undefined;
    scanStartOffset = 0; scanEndOffset = scanBytes; scannedBytes = scanBytes;
    for (let chunkStart = 0; chunkStart < scanBytes; chunkStart += CHUNK_BYTES) {
      const view = currentView(), safeLength = Math.min(scanBytes, view.byteLength), chunkEnd = Math.min(chunkStart + CHUNK_BYTES, scanBytes);
      let offset = useAlignment ? Math.ceil(chunkStart / width) * width : chunkStart;
      for (; offset < chunkEnd && offset + width <= safeLength; offset += stride) {
        const actual = readAt(view, type, offset);
        if (!valuesEqual(actual, value, type)) continue;
        totalMatches += 1;
        if (found.length < MAX_CANDIDATES) found.push({ offset, value: actual });
        else { const slot = Math.floor(Math.random() * totalMatches); if (slot < MAX_CANDIDATES) found[slot] = { offset, value: actual }; }
      }
      await yieldToRuntime();
    }
    candidates = found.sort((a, b) => a.offset - b.offset); truncated = totalMatches > MAX_CANDIDATES;
    return summary();
  }
  async function firstUnknownScan(type: WasmScanType, useAlignment = true, startOffset = 0, endOffset?: number): Promise<WasmScanSummary> {
    assertType(type);
    const view = currentView(), end = endOffset === undefined ? view.byteLength : endOffset;
    if (!Number.isSafeInteger(startOffset) || !Number.isSafeInteger(end) || startOffset < 0 || end <= startOffset || end > view.byteLength) {
      throw new Error(`未知初始扫描范围无效。当前内存长度为 ${view.byteLength} 字节，结束地址为开区间。`);
    }
    const length = end - startOffset;
    if (length > MAX_UNKNOWN_SNAPSHOT_BYTES) {
      throw new Error("未知初始值扫描一次最多快照 128 MiB。请在起始/结束地址中缩小扫描范围，地址支持十进制或 0x 十六进制。");
    }
    scanType = type; aligned = useAlignment; candidates = []; truncated = false;
    scanStartOffset = startOffset; scanEndOffset = end; scannedBytes = length;
    try {
      unknownBaseline = new Uint8Array(view.buffer, view.byteOffset + startOffset, length).slice();
    } catch (cause) {
      unknownBaseline = undefined;
      throw new Error(`创建未知初始值快照失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
    return summary();
  }
  async function nextScan(filter: WasmScanFilter, value?: number, value2?: number): Promise<WasmScanSummary> {
    if (!scanType) throw new Error("请先执行首次扫描。");
    validateFilter(filter, value, value2);
    const width = TYPE_BYTES[scanType];
    if (unknownBaseline) {
      const baseline = new DataView(unknownBaseline.buffer, unknownBaseline.byteOffset, unknownBaseline.byteLength);
      const found: Candidate[] = []; let totalMatches = 0;
      const absoluteStart = scanStartOffset, absoluteEnd = Math.min(scanEndOffset, currentView().byteLength), stride = aligned ? width : 1;
      for (let chunkStart = absoluteStart; chunkStart < absoluteEnd; chunkStart += CHUNK_BYTES) {
        const view = currentView(), chunkEnd = Math.min(chunkStart + CHUNK_BYTES, absoluteEnd);
        let offset = aligned ? Math.ceil(chunkStart / width) * width : chunkStart;
        for (; offset + width <= chunkEnd; offset += stride) {
          const now = readAt(view, scanType, offset), previous = readAt(baseline, scanType, offset - absoluteStart);
          if (!compareValue(now, previous, scanType, filter, value, value2)) continue;
          totalMatches += 1;
          if (found.length < MAX_CANDIDATES) found.push({ offset, value: now });
          else { const slot = Math.floor(Math.random() * totalMatches); if (slot < MAX_CANDIDATES) found[slot] = { offset, value: now }; }
        }
        await yieldToRuntime();
      }
      candidates = found.sort((a, b) => a.offset - b.offset); truncated = totalMatches > MAX_CANDIDATES; unknownBaseline = undefined;
      return summary();
    }
    const before = candidates, retained: Candidate[] = [];
    for (let start = 0; start < before.length; start += 4096) {
      const view = currentView(), end = Math.min(start + 4096, before.length);
      for (let index = start; index < end; index += 1) {
        const candidate = before[index];
        if (candidate.offset + width > view.byteLength) continue;
        const now = readAt(view, scanType, candidate.offset);
        if (compareValue(now, candidate.value, scanType, filter, value, value2)) retained.push({ offset: candidate.offset, value: now });
      }
      await yieldToRuntime();
    }
    candidates = retained;
    return summary();
  }
  function getPage(page: number): WasmScanSummary { currentView(); return summary(page); }
  function resetScan(): void {
    scanType = undefined; candidates = []; truncated = false; unknownBaseline = undefined;
    aligned = true; scanStartOffset = 0; scanEndOffset = 0; scannedBytes = 0;
  }
  function read(type: WasmScanType, offset: number): number { return readAt(currentView(), type, offset); }
  function write(type: WasmScanType, offset: number, value: number): number {
    writeAt(currentView(), type, offset, value); return readAt(currentView(), type, offset);
  }
  function freezeAdd(type: WasmScanType, offset: number, value: number): number {
    assertType(type); assertFinite(value);
    const key = freezeKey(type, offset);
    if (!freezes.has(key) && freezes.size >= MAX_FREEZES) throw new Error(`最多锁定 ${MAX_FREEZES} 个内存地址。`);
    writeAt(currentView(), type, offset, value); freezes.set(key, { type, offset, value }); updateFreezeTimer(); return freezes.size;
  }
  function freezeRemove(type: WasmScanType, offset: number): number { freezes.delete(freezeKey(type, offset)); updateFreezeTimer(); return freezes.size; }
  function freezeClear(): void { freezes.clear(); updateFreezeTimer(); }
  return { firstScan, firstUnknownScan, nextScan, getPage, resetScan, read, write, freezeAdd, freezeRemove, freezeClear, frozenCount: () => freezes.size };
}
