type WolfPlayerConfig = {
  gameId: string;
  mode?: "loose" | "packed";
  woditorSrc?: string;
  settings?: WolfPlayerSettings;
};

type WolfAsset = {
  path: string;
  url: string;
  size: number;
};

type WolfAssetResponse = {
  type: "wolf-assets-response";
  requestId: string;
  assets?: WolfAsset[];
  error?: string;
  externalSaveRootRegistered?: boolean;
};

type WolfRuntimeModule = {
  preRun: Array<(runtimeModule?: WolfRuntimeModule) => void>;
  canvas?: HTMLCanvasElement;
};

import { normalizeWolfPath, wolfPathKeys } from "@/player-runtime/engines/wolf/path";
import { installWolfCompatibility } from "@/player-runtime/engines/wolf/compatibility";
import type { WolfPlayerSettings } from "@/player-runtime/engines/wolf/compatibility";
import { createWasmMemoryScanner, type WasmScanFilter, type WasmScanType } from "@/player-runtime/engines/wolf/memoryScanner";
import { resolveWolfHpPointerChain, writeWolfHpPointerChain, type WolfHpPointerChainSnapshot } from "@/player-runtime/engines/wolf/hpPointerChain";
import { buildWolfVariableCatalog, type WolfVariableCatalog } from "@/player-runtime/engines/wolf/variableCatalog";
import { inspectWasmRuntimeSurface, summarizeWasmExports, summarizeWasmImports, type AetherRuntimeIntrospection } from "@/player-runtime/engines/wolf/runtimeIntrospection";

declare const Module: WolfRuntimeModule;
declare const FS: {
  analyzePath(path: string): { exists: boolean };
  mkdir(path: string): void;
  writeFile: (...values: unknown[]) => unknown;
  open: (...values: unknown[]) => unknown;
  stat: (...values: unknown[]) => unknown;
  lstat: (...values: unknown[]) => unknown;
  readdir?: (path: string) => string[];
  unlink?: (path: string) => unknown;
  write?: (...values: unknown[]) => unknown;
};

const config = (window as typeof window & {
  __WOLF_PLAYER_CONFIG__?: WolfPlayerConfig;
}).__WOLF_PLAYER_CONFIG__;
const runtimeModule = (window as typeof window & { Module?: WolfRuntimeModule }).Module ?? Module;
let activeModule: WolfRuntimeModule | undefined;
let externalSaveRootRegistered = false;

// AetherPlay WOLF debug bridge. This snippet is inserted after activeModule is declared.
type AetherDebugCommand = {
  type: "aetherplay-debug-command";
  requestId: string;
  gameId: string;
  command: "probe" | "runtime-introspect" | "address-trace" | "variable-catalog" | "wolf-variable-range-read" | "wolf-variable-base-detect" | "list-files" | "read-file" | "write-file" | "scan-first" | "scan-unknown-first" | "scan-next" | "scan-page" | "scan-reset" | "memory-read" | "memory-neighborhood" | "memory-write" | "freeze-add" | "freeze-remove" | "freeze-clear" | "hp-chain-read" | "hp-chain-write" | "wasm-binary-export";
  scanStartOffset?: number;
  scanEndOffset?: number;
  scanValue2?: number;
  path?: string;
  format?: "text" | "hex";
  content?: string;
  scanType?: WasmScanType;
  scanValue?: number;
  scanFilter?: WasmScanFilter;
  page?: number;
  aligned?: boolean;
  offset?: number;
  neighborhoodRadius?: number;
  value?: number;
  expectedValue?: number;
  variableBase?: number;
  variableCount?: number;
  anchorValue?: number;
  v16Value?: number;
  v18Value?: number;
  v19Value?: number;
};
type AetherDebugEntry = { name: string; path: string; kind: "directory" | "file"; size: number };
type AetherDebugResponse = {
  type: "aetherplay-debug-result";
  requestId: string;
  gameId: string;
  command: AetherDebugCommand["command"];
  ok: boolean;
  error?: string;
  capabilities?: Record<string, unknown>;
  path?: string;
  entries?: AetherDebugEntry[];
  truncated?: boolean;
  file?: { path: string; size: number; format: "text" | "hex"; content: string };
  backupPath?: string;
  scan?: { scanType: WasmScanType; count: number; scannedBytes: number; truncated: boolean; aligned: boolean; page: number; pageCount: number; unknownBaselinePending: boolean; scanStartOffset: number; scanEndOffset: number; results: Array<{ offset: number; value: number }> };
  memoryValue?: number;
  neighborhood?: AetherDebugMemoryNeighborhood;
  frozenCount?: number;
  variableCatalog?: WolfVariableCatalog;
  wolfVariables?: { base: number; count: number; memoryBytes: number; rows: Array<{ id: number; address: number; value: number }> };
  wolfVariableBaseDetection?: { memoryBytes: number; scannedBytes: number; candidateCount: number; truncated: boolean; candidates: Array<{ base: number; slotAddress: number; values: { v16: number; v17: number; v18: number; v19: number } }> };
  runtimeIntrospection?: AetherRuntimeIntrospection;
  addressTrace?: AetherDebugAddressTrace;
  hpChain?: WolfHpPointerChainSnapshot;
  wasmBinary?: Uint8Array;
  wasmBinaryBytes?: number;
  wasmBinaryCaptureStatus?: string;
};
type AetherDebugFS = {
  analyzePath(path: string): { exists: boolean };
  mkdir(path: string): void;
  readdir(path: string): string[];
  stat(path: string): { size: number; mode: number };
  readFile(path: string): Uint8Array | string;
  writeFile(path: string, data: Uint8Array | string): unknown;
};
const AETHER_DEBUG_MAX_BYTES = 256 * 1024;
type AetherDebugAddressWord = { offset: number; hex: string; value: number; signedValue: number; floatValue: number };
type AetherDebugAddressReference = { offset: number; offsetHex: string; pointsTo: number; pointsToHex: string; delta: number; exact: boolean; context: AetherDebugAddressWord[] };
type AetherDebugAddressTrace = { targetOffset: number; targetHex: string; memoryBytes: number; scannedBytes: number; scannedWords: number; radiusBytes: number; exactReferenceCount: number; nearbyReferenceCount: number; referencesTruncated: boolean; references: AetherDebugAddressReference[]; targetContext: AetherDebugAddressWord[]; notes: string[] };
type AetherDebugMemoryNeighborhoodWord = { offset: number; offsetHex: string; hex: string; u32: number; i32: number; f32: number };
type AetherDebugMemoryNeighborhood = { capturedAt: string; anchorOffset: number; anchorHex: string; radiusBytes: number; memoryBytes: number; words: AetherDebugMemoryNeighborhoodWord[] };

// AetherPlay diagnostic: capture WebAssembly.Memory without relying on
// Emscripten Module.HEAP* properties.
type AetherDebugWasmApi = {
  instantiate: (...args: unknown[]) => unknown;
  instantiateStreaming?: (...args: unknown[]) => unknown;
};

let aetherDebugCapturedMemory: WebAssembly.Memory | undefined;
let aetherDebugCapturedWasmModule: WebAssembly.Module | undefined;
let aetherDebugMemorySource = "未捕获";
let aetherDebugCapturedWasmBytes: Uint8Array | undefined;
let aetherDebugWasmBinaryCaptureError = "尚未捕获 WASM 二进制。";
let aetherDebugWasmInstantiateCalls = 0;
let aetherDebugWasmCaptureHookInstalled = false;
let aetherDebugCapturedWasmExports: ReturnType<typeof summarizeWasmExports> = [];
let aetherDebugCapturedWasmImports: string[] = [];

function aetherDebugCaptureMemoryTree(
  value: unknown,
  source: string,
  depth = 0,
): void {
  if (typeof WebAssembly === "undefined") return;

  if (value instanceof WebAssembly.Module) {
    aetherDebugCapturedWasmModule = value;
    return;
  }

  if (value instanceof WebAssembly.Memory) {
    // Prefer a memory explicitly exported by the instantiated WASM.
    if (!aetherDebugCapturedMemory || source.includes(".exports.")) {
      aetherDebugCapturedMemory = value;
      aetherDebugMemorySource = source;
    }
    return;
  }

  if (value instanceof WebAssembly.Instance) {
    const exports = value.exports as unknown as Record<string, unknown>;
    aetherDebugCapturedWasmExports = summarizeWasmExports(exports);
    for (const key of Object.keys(exports)) {
      aetherDebugCaptureMemoryTree(
        exports[key],
        `${source}.exports.${key}`,
        depth + 1,
      );
    }
    return;
  }

  if (!value || typeof value !== "object" || depth >= 3) return;

  let keys: string[];
  try {
    keys = Object.keys(value as Record<string, unknown>);
  } catch {
    return;
  }

  for (const key of keys) {
    if (key === "memory" || key === "instance" ||
        key === "exports" || depth < 2) {
      try {
        aetherDebugCaptureMemoryTree(
          (value as Record<string, unknown>)[key],
          `${source}.${key}`,
          depth + 1,
        );
      } catch {
        // Ignore inaccessible import/export properties.
      }
    }
  }
}

function aetherDebugCaptureWasmSource(source: unknown): void {
  const captureResponse = async (candidate: unknown): Promise<void> => {
    if (!(candidate instanceof Response)) {
      aetherDebugWasmBinaryCaptureError = "instantiateStreaming 的输入不是 Response；未能复制 WASM 原始字节。";
      return;
    }
    try {
      // Clone before instantiateStreaming consumes the original response body.
      const bytes = new Uint8Array(await candidate.clone().arrayBuffer());
      if (bytes.byteLength === 0) {
        aetherDebugWasmBinaryCaptureError = "捕获到的 WASM 响应为空。";
        return;
      }
      if (!aetherDebugCapturedWasmBytes || bytes.byteLength > aetherDebugCapturedWasmBytes.byteLength) {
        aetherDebugCapturedWasmBytes = bytes;
        aetherDebugWasmBinaryCaptureError = "";
      }
    } catch (cause) {
      aetherDebugWasmBinaryCaptureError = cause instanceof Error
        ? `复制 WASM Response 失败：${cause.message}`
        : `复制 WASM Response 失败：${String(cause)}`;
    }
  };

  try {
    if (source instanceof Response) {
      // Handle a direct Response synchronously enough to clone before the original call.
      void captureResponse(source);
    } else {
      // Emscripten normally passes Promise<Response> to instantiateStreaming.
      void Promise.resolve(source).then(captureResponse).catch((cause: unknown) => {
        aetherDebugWasmBinaryCaptureError = cause instanceof Error
          ? `等待 WASM Response 失败：${cause.message}`
          : `等待 WASM Response 失败：${String(cause)}`;
      });
    }
  } catch (cause) {
    aetherDebugWasmBinaryCaptureError = cause instanceof Error
      ? `启动 WASM 二进制捕获失败：${cause.message}`
      : `启动 WASM 二进制捕获失败：${String(cause)}`;
  }
}

function aetherDebugInstallWasmCapture(): void {
  if (typeof WebAssembly === "undefined") return;

  const api = WebAssembly as unknown as AetherDebugWasmApi;
  let installed = 0;

  for (const method of ["instantiate", "instantiateStreaming"] as const) {
    const original = api[method];
    if (typeof original !== "function") continue;

    try {
      api[method] = (...args: unknown[]): unknown => {
        aetherDebugWasmInstantiateCalls += 1;
        if (method === "instantiateStreaming") aetherDebugCaptureWasmSource(args[0]);
        aetherDebugCapturedWasmImports = summarizeWasmImports(args[1]);
        aetherDebugCaptureMemoryTree(
          args[1],
          `WebAssembly.${method}.imports`,
        );

        const result = original.apply(WebAssembly, args);

        if (result && typeof (result as { then?: unknown }).then === "function") {
          return (result as Promise<unknown>).then((value) => {
            aetherDebugCaptureMemoryTree(
              value,
              `WebAssembly.${method}.result`,
            );
            return value;
          });
        }

        aetherDebugCaptureMemoryTree(
          result,
          `WebAssembly.${method}.result`,
        );
        return result;
      };

      if (api[method] !== original) installed += 1;
    } catch {
      // Keep the runtime working even if this browser prevents interception.
    }
  }

  aetherDebugWasmCaptureHookInstalled = installed > 0;
}

aetherDebugInstallWasmCapture();
function aetherDebugGetMemoryBuffer(): ArrayBufferLike | undefined {
  const module = (activeModule ?? runtimeModule) as unknown as Record<string, unknown> | undefined;
  const heap = module?.HEAPU8 instanceof Uint8Array ? module.HEAPU8 : undefined;
  const moduleMemory = typeof WebAssembly !== "undefined" && module?.wasmMemory instanceof WebAssembly.Memory ? module.wasmMemory : undefined;
  const buffer = aetherDebugCapturedMemory?.buffer ?? moduleMemory?.buffer ?? heap?.buffer;
  return buffer && buffer.byteLength > 0 ? buffer : undefined;
}
const aetherDebugScanner = createWasmMemoryScanner(aetherDebugGetMemoryBuffer);

function aetherDebugReadAddressWords(view: DataView, center: number, radius = 16): AetherDebugAddressWord[] {
  const aligned = Math.floor(center / 4) * 4;
  const start = Math.max(0, aligned - radius);
  const end = Math.min(view.byteLength, aligned + radius + 4);
  const words: AetherDebugAddressWord[] = [];
  for (let offset = Math.ceil(start / 4) * 4; offset + 4 <= end; offset += 4) {
    const value = view.getUint32(offset, true);
    words.push({ offset, hex: `0x${value.toString(16).padStart(8, "0")}`, value, signedValue: view.getInt32(offset, true), floatValue: view.getFloat32(offset, true) });
  }
  return words;
}

function aetherDebugReadMemoryNeighborhood(
  anchorOffset: number,
  radiusBytes: number,
): AetherDebugMemoryNeighborhood {
  if (!Number.isSafeInteger(anchorOffset) || anchorOffset < 0 || anchorOffset > 0xffffffff)
    throw new Error("锚点地址必须是 0 至 0xFFFFFFFF 范围内的 WASM32 字节偏移。");
  if (!Number.isSafeInteger(radiusBytes) || radiusBytes < 0 || radiusBytes > 512)
    throw new Error("邻域半径必须是 0 至 512 的整数；为避免影响 Android WebView，单次最多读取 257 个 32 位字。");
  const buffer = aetherDebugGetMemoryBuffer();
  if (!buffer || buffer.byteLength < 4) throw new Error("尚未取得可读的 WASM 内存。");
  if (anchorOffset + 4 > buffer.byteLength)
    throw new Error(`锚点超出当前 WASM 内存；当前长度 ${buffer.byteLength} 字节。`);

  const center = Math.floor(anchorOffset / 4) * 4;
  const start = Math.max(0, Math.floor((center - radiusBytes) / 4) * 4);
  const lastAlignedOffset = Math.floor((buffer.byteLength - 4) / 4) * 4;
  const end = Math.min(lastAlignedOffset, Math.ceil((center + radiusBytes) / 4) * 4);
  const view = new DataView(buffer);
  const words: AetherDebugMemoryNeighborhoodWord[] = [];
  for (let offset = start; offset <= end; offset += 4) {
    const u32 = view.getUint32(offset, true);
    words.push({
      offset,
      offsetHex: `0x${offset.toString(16).toUpperCase().padStart(8, "0")}`,
      hex: `0x${u32.toString(16).toUpperCase().padStart(8, "0")}`,
      u32,
      i32: view.getInt32(offset, true),
      f32: view.getFloat32(offset, true),
    });
  }
  return {
    capturedAt: new Date().toISOString(),
    anchorOffset,
    anchorHex: `0x${anchorOffset.toString(16).toUpperCase().padStart(8, "0")}`,
    radiusBytes,
    memoryBytes: view.byteLength,
    words,
  };
}

async function aetherDebugTraceAddress(targetOffset: number): Promise<AetherDebugAddressTrace> {
  if (!Number.isSafeInteger(targetOffset) || targetOffset < 0 || targetOffset > 0xffffffff) throw new Error("目标地址必须是 0 至 0xFFFFFFFF 范围内的 WASM32 字节偏移。");
  const initialBuffer = aetherDebugGetMemoryBuffer();
  if (!initialBuffer || initialBuffer.byteLength < 4) throw new Error("尚未取得可读的 WASM 内存。");
  if (targetOffset + 4 > initialBuffer.byteLength) throw new Error(`目标地址超出当前 WASM 内存；当前长度 ${initialBuffer.byteLength} 字节。`);
  const scanBytes = initialBuffer.byteLength - (initialBuffer.byteLength % 4);
  const radiusBytes = 0x400;
  const exactSamples: Array<{ offset: number; pointsTo: number; delta: number; exact: boolean }> = [];
  const nearbySamples: Array<{ offset: number; pointsTo: number; delta: number; exact: boolean }> = [];
  let exactReferenceCount = 0;
  let nearbyReferenceCount = 0;
  const chunkBytes = 2 * 1024 * 1024;
  for (let chunkStart = 0; chunkStart < scanBytes; chunkStart += chunkBytes) {
    const currentBuffer = aetherDebugGetMemoryBuffer();
    if (!currentBuffer) throw new Error("扫描期间 WASM 内存不可访问；请重新探测。 ");
    const view = new DataView(currentBuffer);
    const chunkEnd = Math.min(chunkStart + chunkBytes, scanBytes, view.byteLength);
    for (let offset = chunkStart; offset + 4 <= chunkEnd; offset += 4) {
      const pointsTo = view.getUint32(offset, true);
      const delta = pointsTo - targetOffset;
      if (delta === 0) {
        exactReferenceCount += 1;
        if (exactSamples.length < 2000) exactSamples.push({ offset, pointsTo, delta, exact: true });
      } else if (Math.abs(delta) <= radiusBytes) {
        nearbyReferenceCount += 1;
        if (nearbySamples.length < 20000) nearbySamples.push({ offset, pointsTo, delta, exact: false });
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const view = new DataView(aetherDebugGetMemoryBuffer() ?? initialBuffer);
  const pickedExact = exactSamples.sort((a, b) => a.offset - b.offset).slice(0, 100);
  const pickedNearby = nearbySamples.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta) || a.offset - b.offset).slice(0, 200);
  const references = [...pickedExact, ...pickedNearby].map((entry) => ({
    ...entry, offsetHex: `0x${entry.offset.toString(16).padStart(8, "0")}`,
    pointsToHex: `0x${entry.pointsTo.toString(16).padStart(8, "0")}`,
    context: aetherDebugReadAddressWords(view, entry.offset),
  }));
  return {
    targetOffset, targetHex: `0x${targetOffset.toString(16).padStart(8, "0")}`,
    memoryBytes: view.byteLength, scannedBytes: scanBytes, scannedWords: Math.floor(scanBytes / 4), radiusBytes,
    exactReferenceCount, nearbyReferenceCount, referencesTruncated: exactReferenceCount > pickedExact.length || nearbyReferenceCount > pickedNearby.length,
    references, targetContext: aetherDebugReadAddressWords(view, targetOffset, 32),
    notes: [
      "这是只读的 32 位小端指针候选扫描，不会修改游戏内存。",
      "精确引用表示该字恰好等于目标偏移；附近候选表示该字落在目标地址 ±0x400 范围内。",
      "附近候选可能只是巧合或同一内存区域中的其他对象，不能单凭命中认定为 HP 所属结构。",
      "若要跨重启自动定位，需要进一步验证引用位置是否稳定，或递归追踪指向引用位置的上层指针。",
    ],
  };
}

type AetherDebugWasmNameInfo = NonNullable<AetherRuntimeIntrospection["wasmInternalNames"]>;

function aetherDebugReadWasmU32(bytes: Uint8Array, cursor: { offset: number }, limit: number): number {
  let value = 0;
  let shift = 0;
  for (let count = 0; count < 5; count += 1) {
    if (cursor.offset >= limit) throw new Error("WASM name section 的 LEB128 数值越界。");
    const byte = bytes[cursor.offset++];
    value += (byte & 0x7f) * (2 ** shift);
    if ((byte & 0x80) === 0) return value;
    shift += 7;
  }
  throw new Error("WASM name section 的 LEB128 数值过长。");
}

function aetherDebugReadWasmName(bytes: Uint8Array, cursor: { offset: number }, limit: number): string {
  const length = aetherDebugReadWasmU32(bytes, cursor, limit);
  if (length > limit - cursor.offset) throw new Error("WASM name section 的字符串越界。");
  const value = new TextDecoder("utf-8").decode(bytes.subarray(cursor.offset, cursor.offset + length));
  cursor.offset += length;
  return value;
}

function aetherDebugInspectWasmInternalNames(): AetherDebugWasmNameInfo {
  const wasmModule = aetherDebugCapturedWasmModule;
  if (!wasmModule || typeof WebAssembly === "undefined" || typeof WebAssembly.Module.customSections !== "function") {
    return {
      available: false, nameSectionCount: 0, nameSectionBytes: 0,
      functionNameCount: 0, namedFunctions: [], truncated: false, debugSections: [],
      notes: ["当前实例未捕获到 WebAssembly.Module，无法读取内部名称区；本探针未调用任何未知函数。"],
    };
  }

  const debugSectionNames = ["name", "sourceMappingURL", "external_debug_info", "producers", "linking", "dylink.0", "target_features"];
  const debugSections = debugSectionNames.map((name) => {
    try {
      const sections = WebAssembly.Module.customSections(wasmModule, name);
      return { name, count: sections.length, bytes: sections.reduce((total, section) => total + section.byteLength, 0) };
    } catch {
      return { name, count: 0, bytes: 0 };
    }
  }).filter((item) => item.count > 0);

  let nameSections: ArrayBuffer[];
  try {
    nameSections = WebAssembly.Module.customSections(wasmModule, "name");
  } catch (cause) {
    return {
      available: true, nameSectionCount: 0, nameSectionBytes: 0,
      functionNameCount: 0, namedFunctions: [], truncated: false, debugSections,
      notes: [`读取 WASM name section 失败：${cause instanceof Error ? cause.message : String(cause)}`],
    };
  }

  const MAX_FUNCTION_NAMES = 3000;
  const namedFunctions: Array<{ index: number; name: string }> = [];
  const notes: string[] = [];
  let moduleName: string | undefined;
  let functionNameCount = 0;
  let nameSectionBytes = 0;
  let truncated = false;

  for (const buffer of nameSections) {
    const bytes = new Uint8Array(buffer);
    nameSectionBytes += bytes.byteLength;
    const outer = { offset: 0 };
    try {
      while (outer.offset < bytes.byteLength) {
        const subsectionId = bytes[outer.offset++];
        const subsectionSize = aetherDebugReadWasmU32(bytes, outer, bytes.byteLength);
        const subsectionStart = outer.offset;
        const subsectionEnd = subsectionStart + subsectionSize;
        if (subsectionEnd > bytes.byteLength) throw new Error("WASM 名称子区段长度越界。");

        if (subsectionId === 0) {
          const cursor = { offset: subsectionStart };
          moduleName = aetherDebugReadWasmName(bytes, cursor, subsectionEnd);
        } else if (subsectionId === 1) {
          const cursor = { offset: subsectionStart };
          const count = aetherDebugReadWasmU32(bytes, cursor, subsectionEnd);
          functionNameCount += count;
          const remaining = Math.max(0, MAX_FUNCTION_NAMES - namedFunctions.length);
          const take = Math.min(count, remaining);
          for (let item = 0; item < take; item += 1) {
            const index = aetherDebugReadWasmU32(bytes, cursor, subsectionEnd);
            const name = aetherDebugReadWasmName(bytes, cursor, subsectionEnd);
            namedFunctions.push({ index, name });
          }
          if (count > take) truncated = true;
        }
        outer.offset = subsectionEnd;
      }
    } catch (cause) {
      notes.push(`名称区段解析不完整：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  if (nameSections.length === 0) {
    notes.push("该 WASM 没有可读取的 name 自定义区段；因此不能单靠内部名称映射函数编号，需要进一步做二进制指令分析。 ");
  } else if (functionNameCount === 0) {
    notes.push("存在 name 区段，但没有函数名称子区段；可能只保留了模块名等有限调试信息。 ");
  } else {
    notes.push("内部函数名只是静态分析线索，不代表它们可通过 Module.ccall 直接调用，也不代表参数约定已经确定。 ");
  }
  if (truncated) notes.push(`函数名输出限制为 ${MAX_FUNCTION_NAMES} 项；完整名称数量为 ${functionNameCount}。`);

  return {
    available: true,
    ...(moduleName ? { moduleName } : {}),
    nameSectionCount: nameSections.length,
    nameSectionBytes,
    functionNameCount,
    namedFunctions,
    truncated,
    debugSections,
    notes,
  };
}

function aetherDebugInspectRuntimeSurface(): AetherRuntimeIntrospection {
  const module = (activeModule ?? runtimeModule) as unknown as Record<string, unknown> | undefined;
  const moduleMemory = typeof WebAssembly !== "undefined" && module?.wasmMemory instanceof WebAssembly.Memory
    ? module.wasmMemory
    : undefined;
  const summary = inspectWasmRuntimeSurface(
    module,
    aetherDebugCapturedWasmExports,
    aetherDebugCapturedWasmImports,
    aetherDebugGetMemoryBuffer()?.byteLength ?? 0,
    aetherDebugCapturedMemory ? aetherDebugMemorySource : (moduleMemory ? "Module.wasmMemory" : "未捕获"),
  );
  summary.wasmInternalNames = aetherDebugInspectWasmInternalNames();
  return summary;
}

function aetherDebugMetadataAssetPaths(): string[] {
  const host = window as typeof window & {
    __AETHERPLAY_WOLF_ASSET_PATHS__?: string[];
  };
  const eligible = (path: string) => /(?:^|\/)(?:SysDataBase|SysDataBaseBasic)\.project$/iu.test(path) ||
    /(?:^|\/)CommonEvent\.dat$/iu.test(path);
  if (Array.isArray(host.__AETHERPLAY_WOLF_ASSET_PATHS__)) {
    return [...new Set(host.__AETHERPLAY_WOLF_ASSET_PATHS__.filter(eligible))];
  }
  // Packed/runtime fallback: inspect virtual directory entries only. Readdir on
  // a file throws quickly; avoid stat/open on every asset because those hooks can
  // invoke the lazy loader and would download unrelated game assets.
  const fs = aetherDebugFs();
  const found: string[] = [];
  const visited = new Set<string>();
  let visitedDirectories = 0;
  const walk = (directory: string, depth: number): void => {
    if (depth > 12 || visitedDirectories >= 8000 || visited.has(directory)) return;
    visited.add(directory);
    visitedDirectories += 1;
    let names: string[];
    try { names = fs.readdir(directory); } catch { return; }
    for (const name of names) {
      if (!name || name === "." || name === "..") continue;
      const child = directory === "/" ? `/${name}` : `${directory}/${name}`;
      if (eligible(child)) found.push(child.replace(/^\/+/, ""));
      if (depth >= 12 || name.startsWith(".") || /^Save$/iu.test(name) || /^\.aetherplay-debug-backups$/iu.test(name)) continue;
      walk(child, depth + 1);
      if (visitedDirectories >= 8000) break;
    }
  };
  walk("/", 0);
  return [...new Set(found)];
}

function aetherDebugReadMetadataAsset(path: string): Uint8Array | undefined {
  const host = window as typeof window & {
    __AETHERPLAY_WOLF_LOAD_ASSET__?: (path: unknown) => boolean;
  };
  try {
    host.__AETHERPLAY_WOLF_LOAD_ASSET__?.(path);
    const normalized = aetherDebugNormalizePath(path);
    const absolute = normalized.startsWith("/") ? normalized : `/${normalized}`;
    const fs = aetherDebugFs();
    if (!fs.analyzePath(absolute).exists) return undefined;
    const bytes = aetherDebugToBytes(fs.readFile(absolute));
    if (bytes.byteLength > 32 * 1024 * 1024) return undefined;
    return bytes;
  } catch {
    return undefined;
  }
}

function aetherDebugNormalizePath(value: string): string {
  if (typeof value !== "string" || value.length > 2048 || value.includes("\0")) throw new Error("无效文件路径。");
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}
function aetherDebugFs(): AetherDebugFS {
  const candidate = FS as unknown as Partial<AetherDebugFS>;
  if (typeof candidate.readdir !== "function" || typeof candidate.stat !== "function" || typeof candidate.readFile !== "function" || typeof candidate.writeFile !== "function") {
    throw new Error("WOLF 虚拟文件系统接口尚未就绪。");
  }
  return candidate as AetherDebugFS;
}
function aetherDebugToBytes(value: Uint8Array | string): Uint8Array {
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 0xff;
  return bytes;
}
function aetherDebugModeKind(mode: number): "directory" | "file" {
  return (mode & 0o170000) === 0o040000 ? "directory" : "file";
}
function aetherDebugListDirectory(pathInput: string): { path: string; entries: AetherDebugEntry[]; truncated: boolean } {
  const fs = aetherDebugFs();
  const path = aetherDebugNormalizePath(pathInput || "/");
  const names = fs.readdir(path).filter((name) => name !== "." && name !== "..").sort((a, b) => a.localeCompare(b));
  const truncated = names.length > 250;
  const entries = names.slice(0, 250).map((name) => {
    const entryPath = path === "/" ? `/${name}` : `${path}/${name}`;
    try {
      const info = fs.stat(entryPath);
      return { name, path: entryPath, kind: aetherDebugModeKind(Number(info.mode) || 0), size: Math.max(0, Number(info.size) || 0) };
    } catch {
      try {
        fs.readdir(entryPath);
        return { name, path: entryPath, kind: "directory" as const, size: 0 };
      } catch {
        return { name, path: entryPath, kind: "file" as const, size: 0 };
      }
    }
  }).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1));
  return { path, entries, truncated };
}
function aetherDebugReadFile(pathInput: string): NonNullable<AetherDebugResponse["file"]> {
  const fs = aetherDebugFs();
  const path = aetherDebugNormalizePath(pathInput);
  if (path === "/") throw new Error("不能把根目录当作文件读取。");
  const info = fs.stat(path);
  if (aetherDebugModeKind(Number(info.mode) || 0) === "directory") throw new Error("所选路径是目录。");
  const size = Math.max(0, Number(info.size) || 0);
  if (size > AETHER_DEBUG_MAX_BYTES) throw new Error("文件超过 256 KiB。为避免卡顿，本版本不在调试面板中读取该文件。");
  const bytes = aetherDebugToBytes(fs.readFile(path));
  if (bytes.byteLength > AETHER_DEBUG_MAX_BYTES) throw new Error("文件实际大小超过安全读取上限。");
  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error("binary");
    return { path, size: bytes.byteLength, format: "text", content: text };
  } catch {
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
    return { path, size: bytes.byteLength, format: "hex", content: hex };
  }
}
function aetherDebugWriteFile(message: AetherDebugCommand): { backupPath: string } {
  const fs = aetherDebugFs();
  const path = aetherDebugNormalizePath(message.path || "");
  if (path === "/" || path.startsWith("/.aetherplay-debug-backups/")) throw new Error("禁止覆盖根目录或调试器备份文件。");
  if (typeof message.content !== "string") throw new Error("缺少待写入内容。");
  const info = fs.stat(path);
  if (aetherDebugModeKind(Number(info.mode) || 0) === "directory") throw new Error("不能覆盖目录。");
  const oldBytes = aetherDebugToBytes(fs.readFile(path));
  if (oldBytes.byteLength > AETHER_DEBUG_MAX_BYTES) throw new Error("原文件超过 256 KiB，拒绝修改以避免意外损坏。");
  let newBytes: Uint8Array;
  if (message.format === "hex") {
    const compact = message.content.replace(/\s+/g, "");
    if (compact.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(compact)) throw new Error("十六进制内容格式错误：只能包含成对的 0-9、a-f 字节。");
    if (compact.length / 2 > AETHER_DEBUG_MAX_BYTES) throw new Error("写入内容超过 256 KiB。");
    newBytes = new Uint8Array(compact.length / 2);
    for (let index = 0; index < newBytes.length; index += 1) newBytes[index] = Number.parseInt(compact.slice(index * 2, index * 2 + 2), 16);
  } else {
    newBytes = new TextEncoder().encode(message.content);
    if (newBytes.byteLength > AETHER_DEBUG_MAX_BYTES) throw new Error("写入内容超过 256 KiB。");
  }
  const backupDirectory = "/.aetherplay-debug-backups";
  if (!fs.analyzePath(backupDirectory).exists) fs.mkdir(backupDirectory);
  const baseName = path.split("/").filter(Boolean).pop() || "file";
  const safeBaseName = baseName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const backupPath = `${backupDirectory}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${safeBaseName}`;
  fs.writeFile(backupPath, oldBytes);
  fs.writeFile(path, newBytes);
  return { backupPath };
}
function aetherDebugRespond(response: AetherDebugResponse) {
  window.parent.postMessage(response, window.location.origin);
}
window.addEventListener("message", async (event: MessageEvent<unknown>) => {
  if (event.origin !== window.location.origin || event.source !== window.parent) return;
  if (!event.data || typeof event.data !== "object") return;
  const message = event.data as Partial<AetherDebugCommand>;
  if (message.type !== "aetherplay-debug-command" || typeof message.requestId !== "string" || typeof message.gameId !== "string" || message.gameId !== config?.gameId) return;
  const command = message.command;
  if (!command || (command !== "probe" && command !== "runtime-introspect" && command !== "address-trace" && command !== "variable-catalog" && command !== "wolf-variable-range-read" && command !== "wolf-variable-base-detect" && command !== "list-files" && command !== "read-file" && command !== "write-file" && command !== "scan-first" && command !== "scan-unknown-first" && command !== "scan-next" && command !== "scan-page" && command !== "scan-reset" && command !== "memory-read" && command !== "memory-neighborhood" && command !== "memory-write" && command !== "freeze-add" && command !== "freeze-remove" && command !== "freeze-clear" && command !== "hp-chain-read" && command !== "hp-chain-write" && command !== "wasm-binary-export")) return;
  try {
    if (command === "wasm-binary-export") {
      const bytes = aetherDebugCapturedWasmBytes;
      if (!bytes || bytes.byteLength === 0) {
        throw new Error(aetherDebugWasmBinaryCaptureError || "没有捕获到 WASM 二进制。请完全退出并重新启动该游戏，然后再试。");
      }
      aetherDebugRespond({
        type: "aetherplay-debug-result", requestId: message.requestId, gameId: message.gameId,
        command, ok: true, wasmBinary: bytes, wasmBinaryBytes: bytes.byteLength,
        wasmBinaryCaptureStatus: "已复制 instantiateStreaming 的原始 Response 字节；未修改运行中内存。",
      });
      return;
    }
    if (command === "runtime-introspect") {
      const runtimeIntrospection = aetherDebugInspectRuntimeSurface();
      aetherDebugRespond({ type: "aetherplay-debug-result", requestId: message.requestId, gameId: message.gameId, command, ok: true, runtimeIntrospection });
      return;
    }
    if (command === "probe") {
      const module = (activeModule ?? runtimeModule) as unknown as Record<string, unknown> | undefined;
      const heapCandidate = module?.HEAPU8;
      const heapU8 = heapCandidate instanceof Uint8Array ? heapCandidate : undefined;
      const heap32 = module?.HEAP32 instanceof Int32Array;
      const heapF32 = module?.HEAPF32 instanceof Float32Array;
      const heapF64 = module?.HEAPF64 instanceof Float64Array;
      const moduleMemory = typeof WebAssembly !== "undefined" && module?.wasmMemory instanceof WebAssembly.Memory
        ? module.wasmMemory
        : undefined;
      const memory = aetherDebugCapturedMemory ?? moduleMemory;
      const memoryBuffer = aetherDebugGetMemoryBuffer();
      const fs = FS as unknown as Partial<AetherDebugFS>;
      aetherDebugRespond({
        type: "aetherplay-debug-result", requestId: message.requestId, gameId: message.gameId, command, ok: true,
        capabilities: {
          engine: "WOLF RPG / Browser Woditor",
          moduleAvailable: Boolean(module),
          filesystemAvailable: typeof fs.readdir === "function" && typeof fs.stat === "function" && typeof fs.readFile === "function" && typeof fs.writeFile === "function",
          memoryAvailable: Boolean(heapU8 || memory), heapU8: Boolean(heapU8), heap32, heapF32, heapF64,
          wasmMemory: Boolean(memory),
          wasmMemorySource: aetherDebugCapturedMemory ? aetherDebugMemorySource : (moduleMemory ? "Module.wasmMemory" : "未捕获"),
          wasmCaptureHookInstalled: aetherDebugWasmCaptureHookInstalled,
          wasmInstantiateCalls: aetherDebugWasmInstantiateCalls,
          heapBytes: memoryBuffer?.byteLength ?? 0,
        },
      });
      return;
    }
    if (command === "list-files") {
      const result = aetherDebugListDirectory(message.path || "/");
      aetherDebugRespond({ type: "aetherplay-debug-result", requestId: message.requestId, gameId: message.gameId, command, ok: true, ...result });
      return;
    }
    if (command === "read-file") {
      const file = aetherDebugReadFile(message.path || "/");
      aetherDebugRespond({ type: "aetherplay-debug-result", requestId: message.requestId, gameId: message.gameId, command, ok: true, file });
      return;
    }
    if (command === "variable-catalog") {
      const paths = aetherDebugMetadataAssetPaths();
      const variableCatalog = buildWolfVariableCatalog(paths, aetherDebugReadMetadataAsset);
      aetherDebugRespond({ type: "aetherplay-debug-result", requestId: message.requestId, gameId: message.gameId, command, ok: true, variableCatalog });
      return;
    }
    // AETHER_WOLF_RUNTIME_VARIABLE_RANGE_V1: read-only, user-supplied base; never assume this base survives reloads.
    if (command === "wolf-variable-range-read") {
      const base = Number(message.variableBase);
      const count = Number(message.variableCount);
      if (!Number.isSafeInteger(base) || base < 0 || base > 0xffffffff || base % 4 !== 0) {
        throw new Error("WOLF 变量表候选基址必须是 4 字节对齐的非负 WASM32 地址。");
      }
      if (!Number.isSafeInteger(count) || count < 1 || count > 256) {
        throw new Error("变量数量必须是 1 至 256 之间的整数。");
      }
      const buffer = aetherDebugGetMemoryBuffer();
      if (!buffer) throw new Error("尚未取得可读的 WASM 内存；请等待游戏初始化完成并重新探测。");
      const end = base + count * 4;
      if (!Number.isSafeInteger(end) || end > buffer.byteLength) {
        throw new Error(`候选变量范围超出当前 WASM 内存：基址 0x${base.toString(16).toUpperCase()}，数量 ${count}，当前内存 ${buffer.byteLength} 字节。请重新确认本次运行的基址。`);
      }
      const view = new DataView(buffer);
      const rows = Array.from({ length: count }, (_, id) => {
        const address = base + id * 4;
        return { id, address, value: view.getInt32(address, true) };
      });
      aetherDebugRespond({
        type: "aetherplay-debug-result", requestId: message.requestId, gameId: message.gameId,
        command, ok: true, wolfVariables: { base, count, memoryBytes: buffer.byteLength, rows },
      });
      return;
    }
    // AETHER_WOLF_VARIABLE_BASE_DETECT_V1: scan for the confirmed V16-V19 signature; read-only only.
    if (command === "wolf-variable-base-detect") {
      const anchorValue = Number(message.anchorValue);
      const v16Value = Number(message.v16Value);
      const v18Value = Number(message.v18Value);
      const v19Value = Number(message.v19Value);
      const int32Values = [anchorValue, v16Value, v18Value, v19Value];
      if (int32Values.some((value) => !Number.isInteger(value) || value < -2147483648 || value > 2147483647)) {
        throw new Error("V16、V17 当前值、V18、V19 必须全部是有效的 Int32 整数。请填写游戏当前实际显示/已知的值。");
      }
      const buffer = aetherDebugGetMemoryBuffer();
      if (!buffer || buffer.byteLength < 80) throw new Error("当前 WASM 内存不可读或过小，请先重新探测运行时。");
      const memoryBytes = buffer.byteLength;
      const chunkBytes = 2 * 1024 * 1024;
      const candidates: Array<{ base: number; slotAddress: number; values: { v16: number; v17: number; v18: number; v19: number } }> = [];
      let candidateCount = 0;
      for (let chunkStart = 0; chunkStart < memoryBytes; chunkStart += chunkBytes) {
        const currentBuffer = aetherDebugGetMemoryBuffer();
        if (!currentBuffer || currentBuffer !== buffer) {
          throw new Error("扫描期间 WASM 内存发生变化（例如内存增长）；为避免使用过期地址，本次扫描已中止，请重新点击定位。");
        }
        const view = new DataView(currentBuffer);
        const chunkEnd = Math.min(chunkStart + chunkBytes, memoryBytes);
        for (let slotAddress = Math.max(chunkStart, 68); slotAddress + 12 <= memoryBytes && slotAddress < chunkEnd; slotAddress += 4) {
          if (view.getInt32(slotAddress, true) !== anchorValue) continue;
          if (view.getInt32(slotAddress - 4, true) !== v16Value) continue;
          if (view.getInt32(slotAddress + 4, true) !== v18Value) continue;
          if (view.getInt32(slotAddress + 8, true) !== v19Value) continue;
          candidateCount += 1;
          if (candidates.length < 100) {
            candidates.push({
              base: slotAddress - 68,
              slotAddress,
              values: { v16: v16Value, v17: anchorValue, v18: v18Value, v19: v19Value },
            });
          }
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      aetherDebugRespond({
        type: "aetherplay-debug-result", requestId: message.requestId, gameId: message.gameId,
        command, ok: true,
        wolfVariableBaseDetection: {
          memoryBytes, scannedBytes: memoryBytes, candidateCount,
          truncated: candidateCount > candidates.length, candidates,
        },
      });
      return;
    }
    if (command === "hp-chain-read") {
      const buffer = aetherDebugGetMemoryBuffer();
      if (!buffer) throw new Error("尚未取得可读的 WASM 内存，请等待游戏初始化完成。");
      const hpChain = resolveWolfHpPointerChain(new DataView(buffer));
      aetherDebugRespond({ type: "aetherplay-debug-result", requestId: message.requestId, gameId: message.gameId, command, ok: true, hpChain });
      return;
    }
    if (command === "hp-chain-write") {
      if (typeof message.expectedValue !== "number" || !Number.isFinite(message.expectedValue))
        throw new Error("缺少有效的预期旧 HP，请先刷新实时 HP。");
      if (typeof message.value !== "number" || !Number.isFinite(message.value))
        throw new Error("新 HP 必须是有效的 Int32 数值。");
      const buffer = aetherDebugGetMemoryBuffer();
      if (!buffer) throw new Error("尚未取得可写的 WASM 内存。");
      const hpChain = writeWolfHpPointerChain(new DataView(buffer), message.expectedValue, message.value);
      aetherDebugRespond({ type: "aetherplay-debug-result", requestId: message.requestId, gameId: message.gameId, command, ok: true, hpChain });
      return;
    }
    if (command === "scan-first") {
      const scan = await aetherDebugScanner.firstScan(message.scanType as WasmScanType, Number(message.scanValue), message.aligned !== false);
      aetherDebugRespond({ type: "aetherplay-debug-result", requestId: message.requestId, gameId: message.gameId, command, ok: true, scan }); return;
    }
    if (command === "scan-unknown-first") {
      const scan = await aetherDebugScanner.firstUnknownScan(message.scanType as WasmScanType, message.aligned !== false, message.scanStartOffset === undefined ? 0 : Number(message.scanStartOffset), message.scanEndOffset === undefined ? undefined : Number(message.scanEndOffset));
      aetherDebugRespond({ type: "aetherplay-debug-result", requestId: message.requestId, gameId: message.gameId, command, ok: true, scan }); return;
    }
    if (command === "scan-next") {
      const scan = await aetherDebugScanner.nextScan(message.scanFilter as WasmScanFilter, message.scanValue === undefined ? undefined : Number(message.scanValue), message.scanValue2 === undefined ? undefined : Number(message.scanValue2));
      aetherDebugRespond({ type: "aetherplay-debug-result", requestId: message.requestId, gameId: message.gameId, command, ok: true, scan }); return;
    }
    if (command === "scan-page") {
      const scan = aetherDebugScanner.getPage(Number(message.page));
      aetherDebugRespond({ type: "aetherplay-debug-result", requestId: message.requestId, gameId: message.gameId, command, ok: true, scan }); return;
    }
    if (command === "scan-reset") {
      aetherDebugScanner.resetScan();
      aetherDebugRespond({ type: "aetherplay-debug-result", requestId: message.requestId, gameId: message.gameId, command, ok: true, frozenCount: aetherDebugScanner.frozenCount() }); return;
    }
    if (command === "address-trace") {
      const addressTrace = await aetherDebugTraceAddress(Number(message.offset));
      aetherDebugRespond({ type: "aetherplay-debug-result", requestId: message.requestId, gameId: message.gameId, command, ok: true, addressTrace });
      return;
    }
    if (command === "memory-read") {
      const memoryValue = aetherDebugScanner.read(message.scanType as WasmScanType, Number(message.offset));
      aetherDebugRespond({ type: "aetherplay-debug-result", requestId: message.requestId, gameId: message.gameId, command, ok: true, memoryValue }); return;
    }
    if (command === "memory-neighborhood") {
      const neighborhood = aetherDebugReadMemoryNeighborhood(
        Number(message.offset),
        message.neighborhoodRadius === undefined ? 128 : Number(message.neighborhoodRadius),
      );
      aetherDebugRespond({ type: "aetherplay-debug-result", requestId: message.requestId, gameId: message.gameId, command, ok: true, neighborhood });
      return;
    }
    if (command === "memory-write") {
      const memoryValue = aetherDebugScanner.write(message.scanType as WasmScanType, Number(message.offset), Number(message.value));
      aetherDebugRespond({ type: "aetherplay-debug-result", requestId: message.requestId, gameId: message.gameId, command, ok: true, memoryValue }); return;
    }
    if (command === "freeze-add") {
      const frozenCount = aetherDebugScanner.freezeAdd(message.scanType as WasmScanType, Number(message.offset), Number(message.value));
      aetherDebugRespond({ type: "aetherplay-debug-result", requestId: message.requestId, gameId: message.gameId, command, ok: true, frozenCount }); return;
    }
    if (command === "freeze-remove") {
      const frozenCount = aetherDebugScanner.freezeRemove(message.scanType as WasmScanType, Number(message.offset));
      aetherDebugRespond({ type: "aetherplay-debug-result", requestId: message.requestId, gameId: message.gameId, command, ok: true, frozenCount }); return;
    }
    if (command === "freeze-clear") {
      aetherDebugScanner.freezeClear();
      aetherDebugRespond({ type: "aetherplay-debug-result", requestId: message.requestId, gameId: message.gameId, command, ok: true, frozenCount: 0 }); return;
    }
    const result = aetherDebugWriteFile(message as AetherDebugCommand);
    aetherDebugRespond({ type: "aetherplay-debug-result", requestId: message.requestId, gameId: message.gameId, command, ok: true, ...result });
  } catch (cause) {
    aetherDebugRespond({
      type: "aetherplay-debug-result", requestId: message.requestId, gameId: message.gameId, command, ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
});

function showStatus(message: string) {
  const target = document.querySelector<HTMLElement>("#touchtostart");
  if (target) target.textContent = message;
}

function requestAssets(settings: WolfPlayerConfig): Promise<WolfAsset[]> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("The browser player took too long to prepare WOLF assets."));
    }, 30000);

    function onMessage(event: MessageEvent<WolfAssetResponse>) {
      const message = event.data;
      if (
        event.origin !== window.location.origin ||
        event.source !== window.parent ||
        message?.type !== "wolf-assets-response" ||
        message.requestId !== requestId
      ) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      if (message.error) {
        reject(new Error(message.error));
        return;
      }
      if (!Array.isArray(message.assets) || message.assets.length === 0) {
        reject(new Error("The browser player did not provide WOLF assets."));
        return;
      }
      externalSaveRootRegistered = message.externalSaveRootRegistered === true;
      resolve(message.assets);
    }

    window.addEventListener("message", onMessage);
    window.parent.postMessage({
      type: "wolf-assets-request",
      gameId: settings.gameId,
      requestId,
    }, window.location.origin);
  });
}

function installAssetLoader(assets: WolfAsset[]) {
  const available = new Map<string, WolfAsset>();
  for (const asset of assets) {
    const path = normalizeWolfPath(asset.path);
    const normalized = { ...asset, path };
    for (const key of wolfPathKeys(path)) available.set(key, normalized);
  }

  const stats = {
    requests: 0,
    bytes: 0,
    files: [] as string[],
    missing: [] as string[],
  };
  (window as typeof window & { WolfLazyAssetStats?: typeof stats }).WolfLazyAssetStats = stats;
  const reportedMissing = new Set<string>();

  function ensureParents(path: string) {
    const parts = path.split("/");
    parts.pop();
    let current = "";
    for (const part of parts) {
      current += `/${part}`;
      if (!FS.analyzePath(current).exists) FS.mkdir(current);
    }
  }

  // Android external saves are authoritative when an SAF root is registered.
  const checkedExternalSavePaths = new Set<string>();
  // AETHER_EXTERNAL_WOLF_EXTERNAL_IMPORT_AUTHORITY_V2: clear stale writeback intent when SAF replaces a slot.
  let afterExternalSaveImport: ((relativePath: string) => void) | undefined;
  // AETHER_EXTERNAL_WOLF_STALE_CACHE_BLOCK_V1: remember old virtual payloads before importing newer SAF bytes.
  const staleExternalSaveFingerprints = new Map<string, Set<string>>();
  const authoritativeExternalSaveFingerprints = new Map<string, string>();
  const reportedStaleExternalSaveBlocks = new Set<string>();
  // AETHER_EXTERNAL_WOLF_REPLACEMENT_INTENT_GUARD_V1: an external replacement stays authoritative until an explicit save-like write.
  const externalReplacementGuardSlots = new Set<string>();
  const externalReplacementGuardSince = new Map<string, number>();
  const reportedExternalReplacementGuardEvents = new Set<string>();
  const EXTERNAL_SAVE_REPLACEMENT_INTENT_WINDOW_MS = 2_000;
  function fingerprintExternalSaveBytes(bytes: Uint8Array): string {
    let left = 0x811c9dc5;
    let right = 0x9e3779b9;
    for (let index = 0; index < bytes.length; index += 1) {
      left = Math.imul(left ^ bytes[index], 0x01000193) >>> 0;
      right = Math.imul(right ^ (bytes[index] + index), 0x85ebca6b) >>> 0;
    }
    return `${bytes.length}:${left.toString(16)}:${right.toString(16)}`;
  }
  // A 404 is a deletion signal, not permission to restore an IDBFS copy.
  const externallyDeletedSaveSlots = new Set<string>();
  const externalSaveDeletedAt = new Map<string, number>();
  // Avoid flooding runtime.log while directory reconciliation repeatedly sees a tombstoned slot.
  // Keep one log per slot and source, and reset these keys when the tombstone is released.
  const reportedExternalSaveDeleteGuardSources = new Set<string>();
  // Do not unlock a deleted slot just because time passed. Unlock only when a
  // real FS.write follows recent user input after the deletion was observed.
  let lastExternalSaveUserInputAt = 0;
  let lastExternalSaveUserInputType = "none";
  const EXTERNAL_SAVE_USER_INTENT_WINDOW_MS = 5_000;
  const trackExternalSaveUserInput = (event: Event): void => {
    lastExternalSaveUserInputAt = Date.now();
    lastExternalSaveUserInputType = event.type;
  };
  window.addEventListener("pointerdown", trackExternalSaveUserInput, true);
  window.addEventListener("touchstart", trackExternalSaveUserInput, true);
  window.addEventListener("mousedown", trackExternalSaveUserInput, true);
  window.addEventListener("keydown", trackExternalSaveUserInput, true);
  // Unlinking a tombstoned cache file during IDBFS sync can make syncfs fail with ENOENT.
  // Queue virtual deletions until every observed save-mount sync callback has settled.
  let externalSaveSyncsInFlight = 0;
  const deferredExternalSaveDeletePaths = new Set<string>();
  let writingExternalSaveIntoVirtualFs = false;
  let suppressExternalSaveReconcile = false;

  function externalSaveRelativePath(pathInput: unknown): string | undefined {
    const value = String(pathInput ?? "").replace(/\\/g, "/").replace(/\/+/g, "/");
    const normalized = value.replace(/\/+/g, "/").replace(/^\/+/, "");
    const match = normalized.match(/^data0\/[^/]+-(?:Save|GameCache)\/Save\/(SaveData\d+\.sav)$/iu);
    return match ? `Save/${match[1]}` : undefined;
  }

  function saveSlotKey(pathInput: unknown): string | undefined {
    const normalized = String(pathInput ?? "").replace(/\\/g, "/").replace(/\/+/g, "/");
    const match = normalized.match(/(?:^|\/)data0\/[^/]+-(?:Save|GameCache)\/Save\/(SaveData\d+\.sav)$/iu);
    return match?.[1].toLowerCase();
  }

  function saveVirtualPaths(relativePath: string): string[] {
    const fs = FS as unknown as {
      readdir?: (path: string) => string[];
      analyzePath?: (path: string) => { exists: boolean };
    };
    if (!fs.readdir || !fs.analyzePath || !fs.analyzePath("/data0").exists) return [];
    const wanted = relativePath.split("/").pop()?.toLowerCase();
    if (!wanted) return [];
    const paths: string[] = [];
    const oldSuppress = suppressExternalSaveReconcile;
    suppressExternalSaveReconcile = true;
    try {
      for (const rootName of fs.readdir("/data0")) {
        if (!/^[^/]+-(?:Save|GameCache)$/iu.test(rootName)) continue;
        const saveDir = `/data0/${rootName}/Save`;
        const names = fs.analyzePath(saveDir).exists ? fs.readdir(saveDir) : [];
        const matches = names.filter((name) => name.toLowerCase() === wanted);
        if (matches.length) {
          for (const name of matches) paths.push(`${saveDir}/${name}`);
        } else {
          // Include both mount paths even if this mount has no Save directory/file yet;
          // ensureParents() creates it when external bytes are imported.
          paths.push(`${saveDir}/${relativePath.split("/").pop()}`);
        }
      }
    } catch (error) {
      console.warn("AetherPlay: could not enumerate virtual WOLF save copies", error);
    } finally {
      suppressExternalSaveReconcile = oldSuppress;
    }
    return [...new Set(paths.map((path) => path.replace(/\/+/g, "/")))];
  }

  function markExternalSaveCopiesChecked(relativePath: string): void {
    for (const path of saveVirtualPaths(relativePath)) checkedExternalSavePaths.add(path.toLowerCase());
  }

  function flushDeferredExternalSaveDeletes(): void {
    if (externalSaveSyncsInFlight > 0 || deferredExternalSaveDeletePaths.size === 0) return;
    const fs = FS as unknown as {
      analyzePath?: (path: string) => { exists: boolean };
      unlink?: (path: string) => unknown;
    };
    if (!fs.analyzePath || !fs.unlink) return;

    const queued = [...deferredExternalSaveDeletePaths];
    deferredExternalSaveDeletePaths.clear();
    let removed = 0;
    let failed = 0;
    for (const path of queued) {
      // A real post-deletion FS.write may have released this slot while syncfs was active.
      // In that case, do not let an older queued cleanup delete the new game save.
      const slotKey = saveSlotKey(path);
      if (slotKey && !externallyDeletedSaveSlots.has(slotKey)) continue;
      try {
        if (fs.analyzePath(path).exists) {
          fs.unlink(path);
          removed += 1;
        }
      } catch (error) {
        failed += 1;
        deferredExternalSaveDeletePaths.add(path);
        console.warn(`AetherPlay: deferred stale-save cleanup failed ${path}`, error);
      }
    }
    reportWriteback(
      "EXTERNAL_SAVE_DELETE_DEFERRED_FLUSHED",
      "/data0",
      `queuedPaths=${queued.length} removed=${removed} failed=${failed}`,
    );
  }

  function removeCachedExternalSave(relativePath: string): number {
    const fs = FS as unknown as {
      analyzePath?: (path: string) => { exists: boolean };
      unlink?: (path: string) => unknown;
    };
    if (!fs.analyzePath || !fs.unlink) return 0;

    const paths = saveVirtualPaths(relativePath);
    if (externalSaveSyncsInFlight > 0) {
      // Queue both mirrors, including currently absent paths: an active IDBFS sync may
      // materialize a stale file after this function returns but before its callback.
      for (const path of paths) deferredExternalSaveDeletePaths.add(path);
      if (paths.length > 0) {
        reportWriteback(
          "EXTERNAL_SAVE_DELETE_DEFERRED",
          relativePath,
          `queuedPaths=${paths.length} activeSyncs=${externalSaveSyncsInFlight}`,
        );
      }
      return 0;
    }

    let removed = 0;
    for (const path of paths) {
      try {
        if (fs.analyzePath(path).exists) {
          fs.unlink(path);
          removed += 1;
        }
      } catch (error) {
        console.warn(`AetherPlay: could not remove stale cached save ${path}`, error);
      }
    }
    return removed;
  }

  function loadExternalSave(pathInput: unknown): boolean {
    if (writingExternalSaveIntoVirtualFs || !externalSaveRootRegistered || !config?.gameId) return false;
    const relativePath = externalSaveRelativePath(pathInput);
    if (!relativePath) return false;
    const deletedSlotKey = relativePath.split("/").pop()?.toLowerCase();
    if (deletedSlotKey && externallyDeletedSaveSlots.has(deletedSlotKey)) {
      // Also catch a stale IDBFS copy that appears AFTER the first 404 check.
      const removed = removeCachedExternalSave(relativePath);
      const deletedAt = externalSaveDeletedAt.get(deletedSlotKey) ?? Date.now();
      const guardLogKey = `${deletedSlotKey}:directory-reconcile`;
      if (!reportedExternalSaveDeleteGuardSources.has(guardLogKey)) {
        reportedExternalSaveDeleteGuardSources.add(guardLogKey);
        reportWriteback("EXTERNAL_SAVE_DELETE_GUARD", relativePath,
          `ageMs=${Date.now() - deletedAt} removedCachedCopies=${removed} source=directory-reconcile`);
      }
      return false;
    }
    const virtualPath = `/${normalizeWolfPath(String(pathInput))}`;
    const checkKey = virtualPath.toLowerCase();
    if (checkedExternalSavePaths.has(checkKey)) return false;

    try {
      const encoded = relativePath.split("/").map(encodeURIComponent).join("/");
      const request = new XMLHttpRequest();
      request.open("GET", `${window.location.origin}/__save__/${encodeURIComponent(config.gameId)}/${encoded}`, false);
      request.overrideMimeType("text/plain; charset=x-user-defined");
      request.send(null);
      if (request.status === 404) {
        // Record the deletion BEFORE removing files: IDBFS may materialize a cached
        // mirror asynchronously after this first cleanup has found zero copies.
        const deletedSlotKey = relativePath.split("/").pop()?.toLowerCase();
        if (deletedSlotKey) {
          externallyDeletedSaveSlots.add(deletedSlotKey);
          externalSaveDeletedAt.set(deletedSlotKey, Date.now());
        }
        const removed = removeCachedExternalSave(relativePath);
        markExternalSaveCopiesChecked(relativePath);
        checkedExternalSavePaths.add(checkKey);
        reportWriteback("EXTERNAL_SAVE_MISSING", relativePath, `removedCachedCopies=${removed}`);
        return false;
      }
      // Transient provider/network errors must remain retryable.
      if (request.status < 200 || request.status >= 300) {
        reportWriteback("EXTERNAL_SAVE_READ_RETRYABLE", relativePath, `HTTP ${request.status}`);
        return false;
      }

      const bytes = new Uint8Array(request.responseText.length);
      for (let index = 0; index < request.responseText.length; index += 1) {
        bytes[index] = request.responseText.charCodeAt(index) & 255;
      }
      if (bytes.byteLength === 0 || bytes.byteLength > 16 * 1024 * 1024) {
        reportWriteback("EXTERNAL_SAVE_INVALID", relativePath, `bytes=${bytes.byteLength}`);
        return false;
      }
      const slotKey = relativePath.split("/").pop()?.toLowerCase();
      const externalFingerprint = fingerprintExternalSaveBytes(bytes);
      const paths = saveVirtualPaths(relativePath);
      if (!paths.length) paths.push(virtualPath);
      const inspectFs = FS as unknown as {
        analyzePath?: (path: string) => { exists: boolean };
        readFile?: (path: string) => Uint8Array | string;
      };
      const staleFingerprints = new Set<string>(
        slotKey ? (staleExternalSaveFingerprints.get(slotKey) ?? []) : [],
      );
      let foundDifferentVirtualCopy = false;
      for (const path of paths) {
        try {
          if (!inspectFs.analyzePath || !inspectFs.readFile || !inspectFs.analyzePath(path).exists) continue;
          const previous = inspectFs.readFile(path);
          const previousBytes = previous instanceof Uint8Array
            ? Uint8Array.from(previous)
            : Uint8Array.from(previous, character => character.charCodeAt(0) & 255);
          if (previousBytes.byteLength === 0 || previousBytes.byteLength > 16 * 1024 * 1024) continue;
          const previousFingerprint = fingerprintExternalSaveBytes(previousBytes);
          if (previousFingerprint !== externalFingerprint) {
            staleFingerprints.add(previousFingerprint);
            foundDifferentVirtualCopy = true;
          }
        } catch (error) {
          console.warn(`AetherPlay: could not fingerprint old virtual save ${path}`, error);
        }
      }
      if (slotKey) {
        staleExternalSaveFingerprints.set(slotKey, staleFingerprints);
        authoritativeExternalSaveFingerprints.set(slotKey, externalFingerprint);
        if (foundDifferentVirtualCopy) {
          externalReplacementGuardSlots.add(slotKey);
          externalReplacementGuardSince.set(slotKey, Date.now());
        }
      }
      const fs = FS as unknown as {
        writeFile: (path: string, data: Uint8Array) => unknown;
      };
      writingExternalSaveIntoVirtualFs = true;
      try {
        for (const path of paths) {
          ensureParents(path);
          fs.writeFile(path, bytes);
        }
      } finally {
        writingExternalSaveIntoVirtualFs = false;
      }
      markExternalSaveCopiesChecked(relativePath);
      checkedExternalSavePaths.add(checkKey);
      afterExternalSaveImport?.(relativePath);
      reportWriteback("EXTERNAL_SAVE_IMPORTED", relativePath, `bytes=${bytes.byteLength} copies=${paths.length}`);
      return true;
    } catch (error) {
      reportWriteback("EXTERNAL_SAVE_READ_RETRYABLE", relativePath,
        error instanceof Error ? `${error.name}: ${error.message}` : String(error));
      console.warn("AetherPlay: could not read external WOLF save", error);
      return false;
    }
  }

  function reportWriteback(event: string, path: string, details: string): void {
    try {
      if (!config?.gameId) return;
      window.parent.postMessage({
        type: "wolf-save-writeback-event", gameId: config.gameId, event, path, details, at: Date.now(),
      }, window.location.origin);
    } catch { /* diagnostic messages must not affect gameplay */ }
  }

  function installExternalSaveWriteback(): void {
    type AnyFn = (...args: unknown[]) => unknown;
    type MountRecord = { mountpoint?: unknown; type?: Record<string, unknown> };
    type RuntimeFs = Record<string, unknown> & {
      mounts?: MountRecord[];
      mount?: AnyFn;
      syncfs?: AnyFn;
      write?: AnyFn;
      writeFile?: AnyFn;
      readdir?: (path: string) => string[];
      analyzePath?: (path: string) => { exists: boolean };
      readFile?: (path: string) => Uint8Array | string;
      stat?: (path: string) => { size?: number; mode?: number; mtime?: number };
    };
    const fs = FS as unknown as RuntimeFs;
    if (typeof fs.syncfs !== "function") {
      reportWriteback("FS_UNAVAILABLE", "FS.syncfs", "BrowserWoditor has no public FS.syncfs function");
      return;
    }

    const wrappedTypes = new WeakSet<object>();
    const dirtySavePaths = new Set<string>();
    const dirtySaveGeneration = new Map<string, number>();
    const pendingWritebacks = new Map<string, { fingerprint: string; generation: number }>();
    // AETHER_EXTERNAL_WOLF_IMPORT_LOCK_UNTIL_NEW_SAVE_V1: stream authorization is scoped to the latest external import epoch.
    const explicitlyAuthorizedReplacementStreams = new Map<object, { slotKey: string; guardSince: number }>();
    afterExternalSaveImport = (relativePath: string): void => {
      const slotKey = relativePath.split("/").pop()?.toLowerCase();
      if (!slotKey) return;
      let clearedPaths = 0;
      for (const dirtyPath of [...dirtySavePaths]) {
        if (saveSlotKey(dirtyPath) === slotKey) { dirtySavePaths.delete(dirtyPath); clearedPaths += 1; }
      }
      dirtySaveGeneration.delete(slotKey);
      pendingWritebacks.delete(slotKey);
      reportWriteback("EXTERNAL_SAVE_IMPORT_STATE_RESET", relativePath,
        `clearedDirtyPaths=${clearedPaths}; external import invalidated prior writeback intent`);
      // Every successful external import starts a new authority epoch, even if cached
      // bytes happen to match at import time. Old in-memory save streams cannot overrule it.
      const guardSince = Date.now();
      externalReplacementGuardSlots.add(slotKey);
      externalReplacementGuardSince.set(slotKey, guardSince);
      for (const [stream, authorization] of explicitlyAuthorizedReplacementStreams) {
        if (authorization.slotKey === slotKey) explicitlyAuthorizedReplacementStreams.delete(stream);
      }
      reportWriteback("EXTERNAL_SAVE_IMPORT_GUARD_ARMED", relativePath,
        `slot=${slotKey} guardSince=${guardSince}; imported external bytes win until a new eligible game-save stream`);
    };
    let publishTimer: number | undefined;
    let scannedCount = 0;
    let publishCount = 0;
    let insideWriteFile = false;

    const normalizeMount = (value: unknown): string =>
      String(value ?? "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/+$/, "");
    const isSaveMount = (value: unknown): boolean =>
      /\/[^/]+-(?:GameCache|Save)$/iu.test(normalizeMount(value));
    const fingerprint = (bytes: Uint8Array): string => {
      let left = 0x811c9dc5;
      let right = 0x9e3779b9;
      for (let index = 0; index < bytes.length; index += 1) {
        left = Math.imul(left ^ bytes[index], 0x01000193) >>> 0;
        right = Math.imul(right ^ (bytes[index] + index), 0x85ebca6b) >>> 0;
      }
      return `${bytes.length}:${left.toString(16)}:${right.toString(16)}`;
    };
    const markDirty = (pathInput: unknown, source: string, writeStream?: unknown): void => {
      if (writingExternalSaveIntoVirtualFs || !externalSaveRootRegistered) return;
      const slotKey = saveSlotKey(pathInput);
      if (!slotKey) return;
      if (externalReplacementGuardSlots.has(slotKey)) {
        const replacementAuthorization = typeof writeStream === "object" && writeStream !== null
          ? explicitlyAuthorizedReplacementStreams.get(writeStream as object) : undefined;
        const hasExplicitReplacementSaveIntent = source === "FS.write" &&
          replacementAuthorization !== undefined && replacementAuthorization.slotKey === slotKey &&
          replacementAuthorization.guardSince === externalReplacementGuardSince.get(slotKey);
        if (!hasExplicitReplacementSaveIntent) {
          const inputAgeMs = Date.now() - lastExternalSaveUserInputAt;
          const guardKey = `${slotKey}:${source}`;
          if (!reportedExternalReplacementGuardEvents.has(guardKey)) {
            reportedExternalReplacementGuardEvents.add(guardKey);
            reportWriteback("EXTERNAL_SAVE_REPLACEMENT_GUARD", String(pathInput),
              `slot=${slotKey} source=${source} inputAgeMs=${inputAgeMs} input=${lastExternalSaveUserInputType}; external replacement remains authoritative; no authorized write stream`);
          }
          for (const dirtyPath of [...dirtySavePaths]) {
            if (saveSlotKey(dirtyPath) === slotKey) dirtySavePaths.delete(dirtyPath);
          }
          dirtySaveGeneration.delete(slotKey);
          pendingWritebacks.delete(slotKey);
          return;
        }
        externalReplacementGuardSlots.delete(slotKey);
        externalReplacementGuardSince.delete(slotKey);
        explicitlyAuthorizedReplacementStreams.delete(writeStream as object);
        reportWriteback("EXTERNAL_SAVE_REPLACEMENT_GUARD_RELEASED", String(pathInput),
          `slot=${slotKey} source=${source}; write stream opened for write after recent user input; accepting new game save`);
      }
      if (externallyDeletedSaveSlots.has(slotKey)) {
        const deletedAt = externalSaveDeletedAt.get(slotKey) ?? Date.now();
        const ageMs = Date.now() - deletedAt;
        const inputAgeMs = Date.now() - lastExternalSaveUserInputAt;
        const hasExplicitWriteIntent = source === "FS.write" &&
          lastExternalSaveUserInputAt >= deletedAt && inputAgeMs >= 0 &&
          inputAgeMs <= EXTERNAL_SAVE_USER_INTENT_WINDOW_MS;
        if (!hasExplicitWriteIntent) {
          // Treat early FS.write/File operations as startup/cache replay. Unlink
          // both mirrors after the operation so the save list cannot show them.
          const relativePath = externalSaveRelativePath(pathInput);
          const removed = relativePath ? removeCachedExternalSave(relativePath) : 0;
          const guardLogKey = `${slotKey}:${source}`;
          if (!reportedExternalSaveDeleteGuardSources.has(guardLogKey)) {
            reportedExternalSaveDeleteGuardSources.add(guardLogKey);
            reportWriteback("EXTERNAL_SAVE_DELETE_GUARD", String(pathInput),
              `slot=${slotKey} ageMs=${ageMs} source=${source} inputAgeMs=${inputAgeMs} input=${lastExternalSaveUserInputType} removedCachedCopies=${removed}`);
          }
          return;
        }
        // The player acted after deletion and the game now issued FS.write;
        // release immediately rather than waiting for an arbitrary timeout.
        externallyDeletedSaveSlots.delete(slotKey);
        externalSaveDeletedAt.delete(slotKey);
        for (const loggedKey of [...reportedExternalSaveDeleteGuardSources]) {
          if (loggedKey.startsWith(`${slotKey}:`)) reportedExternalSaveDeleteGuardSources.delete(loggedKey);
        }
        reportWriteback("EXTERNAL_SAVE_DELETE_GUARD_RELEASED", String(pathInput),
          `slot=${slotKey} ageMs=${ageMs} source=${source}; treating as a new save`);
      }
      const normalized = normalizeMount(pathInput);
      const path = (normalized.startsWith("/") ? normalized : `/${normalized}`).toLowerCase();
      dirtySavePaths.add(path);
      const generation = (dirtySaveGeneration.get(slotKey) ?? 0) + 1;
      dirtySaveGeneration.set(slotKey, generation);
      reportWriteback("SAVE_DIRTY", String(pathInput), `slot=${slotKey} generation=${generation} source=${source}`);
    };

    // Generic input alone is not save intent. Require a save-slot stream opened for write
    // after a user event that occurred after the external replacement was detected.
    const fsWithOpenClose = fs as unknown as { open?: AnyFn; close?: AnyFn };
    const oldOpenForReplacementGuard = fsWithOpenClose.open;
    if (typeof oldOpenForReplacementGuard === "function") {
      fsWithOpenClose.open = function (...args: unknown[]): unknown {
        const inputAtOpen = lastExternalSaveUserInputAt;
        const stream = (oldOpenForReplacementGuard as AnyFn).apply(FS, args);
        const slotKey = saveSlotKey(args[0]);
        const flags = args[1];
        const writeAccess = typeof flags === "string"
          ? /[wa+]/u.test(flags)
          : typeof flags === "number" && (flags & 3) !== 0;
        if (!insideWriteFile && !writingExternalSaveIntoVirtualFs && slotKey &&
            externalReplacementGuardSlots.has(slotKey) && writeAccess &&
            typeof stream === "object" && stream !== null) {
          const guardSince = externalReplacementGuardSince.get(slotKey) ?? 0;
          const inputAgeMs = Date.now() - inputAtOpen;
          if (guardSince > 0 && inputAtOpen >= guardSince && inputAgeMs >= 0 && inputAgeMs <= EXTERNAL_SAVE_REPLACEMENT_INTENT_WINDOW_MS) {
            explicitlyAuthorizedReplacementStreams.set(stream as object, { slotKey, guardSince });
            reportWriteback("EXTERNAL_SAVE_WRITE_STREAM_AUTHORIZED", String(args[0]),
              `slot=${slotKey} inputAgeMs=${inputAgeMs} epoch=${guardSince}; eligible stream opened after external import`);
          }
        }
        return stream;
      };
    }
    const oldCloseForReplacementGuard = fsWithOpenClose.close;
    if (typeof oldCloseForReplacementGuard === "function") {
      fsWithOpenClose.close = function (...args: unknown[]): unknown {
        try {
          return (oldCloseForReplacementGuard as AnyFn).apply(FS, args);
        } finally {
          const stream = args[0];
          if (typeof stream === "object" && stream !== null) {
            explicitlyAuthorizedReplacementStreams.delete(stream as object);
          }
        }
      };
    }

    // FS.write catches writes made through streams. The writeFile wrapper is also
    // needed because some Emscripten builds route it through internal helpers.
    const oldWrite = fs.write;
    if (typeof oldWrite === "function") {
      fs.write = function (...args: unknown[]): unknown {
        const result = (oldWrite as AnyFn).apply(FS, args);
        if (!insideWriteFile && !writingExternalSaveIntoVirtualFs) {
          const stream = args[0] as { path?: unknown } | undefined;
          const written = typeof result === "number" ? result : Number(args[3] ?? 0);
          if (written > 0) markDirty(stream?.path, "FS.write", stream);
        }
        return result;
      };
    }
    const oldWriteFile = fs.writeFile;
    if (typeof oldWriteFile === "function") {
      fs.writeFile = function (...args: unknown[]): unknown {
        const prior = insideWriteFile;
        insideWriteFile = true;
        let result: unknown;
        try {
          result = (oldWriteFile as AnyFn).apply(FS, args);
        } finally {
          insideWriteFile = prior;
        }
        if (!writingExternalSaveIntoVirtualFs) {
          const data = args[1];
          const length = data instanceof Uint8Array ? data.byteLength
            : typeof data === "string" ? data.length : 0;
          if (length > 0) markDirty(args[0], "FS.writeFile");
        }
        return result;
      };
    }

    const oldReaddir = fs.readdir;
    if (typeof oldReaddir === "function") {
      fs.readdir = function (pathInput: string): string[] {
        const path = normalizeMount(pathInput);
        const names = (oldReaddir as AnyFn).apply(FS, [pathInput]) as string[];
        if (suppressExternalSaveReconcile || !externalSaveRootRegistered ||
            !/^\/data0\/[^/]+-(?:GameCache|Save)\/Save$/iu.test(path)) return names;
        // A readdir is how save menus discover slots. Reconcile each cached slot
        // before returning the listing, and return a fresh list after stale entries
        // were removed or external bytes were imported.
        for (const name of names.slice()) {
          if (/^SaveData\d+\.sav$/iu.test(name)) loadExternalSave(`${path}/${name}`);
        }
        const refreshed = (oldReaddir as AnyFn).apply(FS, [pathInput]) as string[];
        reportWriteback("EXTERNAL_SAVE_LIST_RECONCILED", path, `before=${names.length} after=${refreshed.length}`);
        return refreshed;
      };
    }

    let publishTimerGeneration = 0;
    const publishSavesAfterSync = (): void => {
      if (!config?.gameId || !externalSaveRootRegistered || !fs.readdir || !fs.readFile || !fs.analyzePath || !fs.stat) {
        reportWriteback("SCAN_SKIPPED", "/data0", externalSaveRootRegistered ? "filesystem listing/stat/read functions unavailable" : "external SAF root is not registered");
        return;
      }
      const previousSuppress = suppressExternalSaveReconcile;
      suppressExternalSaveReconcile = true;
      const candidates = new Map<string, {
        name: string; bytes: Uint8Array; rank: number; path: string; mtime: number;
      }>();
      try {
        // A slot can have been marked dirty just before a deletion was observed.
        // Clear that old write intent so later sync callbacks cannot resurrect it.
        for (const slotKey of [...dirtySaveGeneration.keys()]) {
          if (!externallyDeletedSaveSlots.has(slotKey)) continue;
          for (const path of [...dirtySavePaths]) {
            if (saveSlotKey(path) === slotKey) dirtySavePaths.delete(path);
          }
          dirtySaveGeneration.delete(slotKey);
          pendingWritebacks.delete(slotKey);
          reportWriteback("EXTERNAL_SAVE_DELETE_DIRTY_CLEARED", slotKey,
            "discarded stale cached write intent after external 404");
        }
        if (!fs.analyzePath("/data0").exists) {
          reportWriteback("SCAN_NO_DATA0", "/data0", "virtual /data0 directory does not exist");
          return;
        }
        for (const rootName of fs.readdir("/data0")) {
          const rootMatch = rootName.match(/^([^/]+)-(GameCache|Save)$/iu);
          if (!rootMatch) continue;
          const mountpoint = `/data0/${rootName}`;
          const saveDir = `${mountpoint}/Save`;
          try {
            if (!fs.analyzePath(saveDir).exists) continue;
            // The readdir wrapper performs external reconciliation before yielding names.
            for (const name of fs.readdir(saveDir)) {
              if (!/^SaveData\d+\.sav$/iu.test(name)) continue;
              const path = `${saveDir}/${name}`;
              const normalized = normalizeMount(path);
              const normalizedPath = (normalized.startsWith("/") ? normalized : `/${normalized}`).toLowerCase();
              const slotKey = name.toLowerCase();
              // A tombstoned slot is never a publish candidate during the deletion guard.
              if (externallyDeletedSaveSlots.has(slotKey)) continue;
              // Critical safety rule: cached/IDBFS-restored files are not write intent.
              // Publish only a file which the game actually wrote this session.
              if (!dirtySavePaths.has(normalizedPath) || !dirtySaveGeneration.has(slotKey)) continue;
              if (externalReplacementGuardSlots.has(slotKey)) {
                const guardKey = `${slotKey}:scan`;
                if (!reportedExternalReplacementGuardEvents.has(guardKey)) {
                  reportedExternalReplacementGuardEvents.add(guardKey);
                  reportWriteback("EXTERNAL_SAVE_REPLACEMENT_WRITEBACK_BLOCKED", `Save/${name}`,
                    `slot=${slotKey} reason=external replacement has not received explicit save intent source=${path}`);
                }
                continue;
              }
              try {
                const source = fs.readFile(path);
                const bytes = source instanceof Uint8Array
                  ? Uint8Array.from(source)
                  : Uint8Array.from(source, character => character.charCodeAt(0) & 255);
                if (bytes.byteLength === 0 || bytes.byteLength > 16 * 1024 * 1024) continue;
                const externalStaleSlotKey = name.toLowerCase();
                const scannedFingerprint = fingerprint(bytes);
                const staleFingerprints = staleExternalSaveFingerprints.get(externalStaleSlotKey);
                const authoritativeFingerprint = authoritativeExternalSaveFingerprints.get(externalStaleSlotKey);
                if (externalReplacementGuardSlots.has(externalStaleSlotKey) &&
                    staleFingerprints?.has(scannedFingerprint) && scannedFingerprint !== authoritativeFingerprint) {
                  const reportKey = `${externalStaleSlotKey}:${scannedFingerprint}:${authoritativeFingerprint ?? "unknown"}`;
                  if (!reportedStaleExternalSaveBlocks.has(reportKey)) {
                    reportedStaleExternalSaveBlocks.add(reportKey);
                    reportWriteback("EXTERNAL_SAVE_STALE_CACHE_BLOCKED", `Save/${name}`,
                      `fingerprint=${scannedFingerprint} authoritative=${authoritativeFingerprint ?? "unknown"} source=${path}`);
                  }
                  continue;
                }
                let mtime = 0;
                try { mtime = Number(fs.stat(path).mtime ?? 0) || 0; } catch { /* rank is fallback */ }
                const previous = candidates.get(slotKey);
                const rank = rootMatch[2].toLowerCase() === "gamecache" ? 1 : 0;
                if (!previous || mtime > previous.mtime || (mtime === previous.mtime && rank > previous.rank)) {
                  candidates.set(slotKey, { name, bytes, rank, path, mtime });
                }
              } catch (error) {
                reportWriteback("SCAN_FILE_ERROR", path, error instanceof Error ? `${error.name}: ${error.message}` : String(error));
              }
            }
          } catch (error) {
            reportWriteback("SCAN_DIR_ERROR", saveDir, error instanceof Error ? `${error.name}: ${error.message}` : String(error));
          }
        }

        scannedCount += 1;
        reportWriteback("SCAN_COMPLETE", "/data0", `scan=${scannedCount} dirtySlots=${dirtySaveGeneration.size} candidates=${candidates.size}`);
        for (const [slotKey, candidate] of candidates) {
          const relativePath = `Save/${candidate.name}`;
          const generation = dirtySaveGeneration.get(slotKey);
          if (generation === undefined) continue;
          const valueFingerprint = fingerprint(candidate.bytes);
          const pending = pendingWritebacks.get(slotKey);
          if (pending && pending.fingerprint === valueFingerprint && pending.generation === generation) continue;
          pendingWritebacks.set(slotKey, { fingerprint: valueFingerprint, generation });
          const data = candidate.bytes.buffer.slice(
            candidate.bytes.byteOffset, candidate.bytes.byteOffset + candidate.bytes.byteLength,
          ) as ArrayBuffer;
          publishCount += 1;
          reportWriteback("SAVE_PUBLISH", relativePath,
            `bytes=${data.byteLength} source=${candidate.path} generation=${generation} publish=${publishCount}`);
          window.parent.postMessage({
            type: "wolf-save-written", gameId: config.gameId, path: relativePath, data,
            fingerprint: valueFingerprint, generation,
          }, window.location.origin);
        }
      } catch (error) {
        reportWriteback("SCAN_ERROR", "/data0", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
      } finally {
        // The writeback scan must never refresh external bytes over the just-written
        // virtual file. Reconciliation happens on gameplay reads/listing instead.
        suppressExternalSaveReconcile = previousSuppress;
      }
    };

    const scheduleSavePublish = (): void => {
      if (publishTimer !== undefined) window.clearTimeout(publishTimer);
      const scheduledGeneration = ++publishTimerGeneration;
      publishTimer = window.setTimeout(() => {
        if (scheduledGeneration !== publishTimerGeneration) return;
        publishTimer = undefined;
        publishSavesAfterSync();
      }, 350);
    };

    // Acknowledge only the exact pending write. Success clears dirty state only when
    // no newer write to the same slot happened while the native SAF write was queued.
    window.addEventListener("message", (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent ||
          !event.data || typeof event.data !== "object") return;
      const ack = event.data as {
        type?: unknown; gameId?: unknown; path?: unknown; fingerprint?: unknown;
        generation?: unknown; ok?: unknown; error?: unknown;
      };
      if (ack.type !== "wolf-save-writeback-ack" || ack.gameId !== config?.gameId) return;
      const match = String(ack.path ?? "").match(/^Save\/(SaveData\d+\.sav)$/iu);
      if (!match || typeof ack.fingerprint !== "string" || typeof ack.generation !== "number") return;
      const slotKey = match[1].toLowerCase();
      const pending = pendingWritebacks.get(slotKey);
      if (!pending || pending.fingerprint !== ack.fingerprint || pending.generation !== ack.generation) return;
      pendingWritebacks.delete(slotKey);
      if (ack.ok === true && dirtySaveGeneration.get(slotKey) === ack.generation) {
        for (const path of [...dirtySavePaths]) {
          if (saveSlotKey(path) === slotKey) dirtySavePaths.delete(path);
        }
        dirtySaveGeneration.delete(slotKey);
        reportWriteback("WRITEBACK_ACK", String(ack.path), `generation=${ack.generation} fingerprint=${ack.fingerprint}`);
      } else if (ack.ok === true) {
        reportWriteback("WRITEBACK_ACK_STALE", String(ack.path), `ackGeneration=${ack.generation} currentGeneration=${dirtySaveGeneration.get(slotKey) ?? -1}`);
        scheduleSavePublish();
      } else {
        reportWriteback("WRITEBACK_ACK_FAILED", String(ack.path), String(ack.error ?? "native write failed; retry scheduled"));
        window.setTimeout(scheduleSavePublish, 2000);
      }
    });

    const installTypeHook = (typeValue: unknown, hint = ""): void => {
      if (!typeValue || typeof typeValue !== "object") return;
      const type = typeValue as Record<string, unknown>;
      if (wrappedTypes.has(type)) return;
      const oldSync = type.syncfs;
      if (typeof oldSync !== "function") return;
      wrappedTypes.add(type);
      type.syncfs = function (...args: unknown[]): unknown {
        const mountInfo = args[0] as { mountpoint?: unknown } | undefined;
        const mountpoint = normalizeMount(mountInfo?.mountpoint ?? hint);
        const populate = args[1] === true;
        const callback = args[2];
        if (!isSaveMount(mountpoint) || typeof callback !== "function") {
          return (oldSync as AnyFn).apply(type, args);
        }

        const shouldPublish = !populate;
        if (shouldPublish) reportWriteback("IDBFS_SYNC_BEGIN", mountpoint, "populate=false");
        externalSaveSyncsInFlight += 1;
        let settled = false;
        const settleSync = (): void => {
          if (settled) return;
          settled = true;
          externalSaveSyncsInFlight = Math.max(0, externalSaveSyncsInFlight - 1);
          if (externalSaveSyncsInFlight === 0) flushDeferredExternalSaveDeletes();
        };

        const nextArgs = args.slice();
        nextArgs[2] = function (error?: unknown): unknown {
          const message = error == null ? "" : error instanceof Error
            ? `${error.name}: ${error.message}`
            : (() => { try { return JSON.stringify(error); } catch { return String(error); } })();
          // Finish tracking and clean queued tombstones only after IDBFS has stopped
          // touching its database snapshot. Flush before scheduling any save scan.
          settleSync();
          if (shouldPublish) {
            if (error == null) {
              reportWriteback("IDBFS_SYNC_DONE", mountpoint, "populate=false");
              scheduleSavePublish();
            } else {
              reportWriteback("IDBFS_SYNC_ERROR", mountpoint, message);
            }
          }
          return (callback as (error?: unknown) => unknown)(error);
        };
        try {
          return (oldSync as AnyFn).apply(type, nextArgs);
        } catch (error) {
          settleSync();
          throw error;
        }
      };
      reportWriteback("MOUNT_HOOKED", hint || "IDBFS", "hooked per-mount syncfs");
    };

    const installMountHooks = (): void => {
      if (!Array.isArray(fs.mounts)) return;
      for (const mount of fs.mounts) installTypeHook(mount?.type, String(mount?.mountpoint ?? ""));
    };

    // BrowserWoditor creates these IDBFS mounts in its own preRun callback.
    const oldMount = fs.mount;
    if (typeof oldMount === "function") {
      fs.mount = function (...args: unknown[]): unknown {
        const result = (oldMount as AnyFn).apply(FS, args);
        const mountpoint = String(args[2] ?? "");
        installTypeHook(args[0], mountpoint);
        installMountHooks();
        if (isSaveMount(mountpoint)) reportWriteback("MOUNT_CREATED", mountpoint, "FS.mount intercepted");
        return result;
      };
    } else {
      reportWriteback("MOUNT_HOOK_WARNING", "FS.mount", "FS.mount unavailable; using mount-list fallback");
    }

    const oldSyncfs = fs.syncfs;
    fs.syncfs = function (...args: unknown[]): unknown {
      installMountHooks();
      return (oldSyncfs as AnyFn).apply(FS, args);
    };
    installMountHooks();
    window.setTimeout(installMountHooks, 0);
    window.setTimeout(installMountHooks, 100);
    reportWriteback("WRITEBACK_HOOK_INSTALLED", "BrowserWoditor IDBFS",
      "only files written by gameplay this session may be written to the external SAF folder");
  }

  function load(path: unknown): boolean {
    const requested = normalizeWolfPath(path);
    const asset = wolfPathKeys(requested)
      .map((key) => available.get(key))
      .find((candidate) => candidate !== undefined);
    if (!asset) {
      const lower = requested.toLowerCase();
      if (
        lower.includes("data/") &&
        /\.[^/.]{1,8}$/u.test(requested) &&
        !/-(?:gamecache|save)\//iu.test(requested) &&
        !lower.endsWith(".wolf") &&
        !lower.endsWith(".wolfx") &&
        !reportedMissing.has(lower)
      ) {
        reportedMissing.add(lower);
        stats.missing.push(requested);
        console.debug(`Wolf Tools could not match asset: ${requested}`);
      }
      return false;
    }

    const absolute = `/${requested}`;
    if (FS.analyzePath(absolute).exists) return true;

    const request = new XMLHttpRequest();
    request.open("GET", asset.url, false);
    request.overrideMimeType("text/plain; charset=x-user-defined");
    request.send(null);
    if (request.status < 200 || request.status >= 300) {
      throw new Error(`Could not load WOLF asset ${asset.path}. HTTP ${request.status}`);
    }

    const bytes = new Uint8Array(request.responseText.length);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = request.responseText.charCodeAt(index) & 255;
    }
    ensureParents(requested);
    FS.writeFile(absolute, bytes);
    stats.requests += 1;
    stats.bytes += bytes.byteLength;
    stats.files.push(asset.path);
    console.log(`Wolf Tools loaded asset: ${asset.path} (${bytes.byteLength} bytes)`);
    return true;
  }

  const debugAssetHost = window as typeof window & {
    __AETHERPLAY_WOLF_ASSET_PATHS__?: string[];
    __AETHERPLAY_WOLF_LOAD_ASSET__?: (path: unknown) => boolean;
  };
  debugAssetHost.__AETHERPLAY_WOLF_ASSET_PATHS__ = assets.map((asset) => asset.path);
  debugAssetHost.__AETHERPLAY_WOLF_LOAD_ASSET__ = (path) => load(path);

  runtimeModule.preRun.push((initializedModule) => {
    activeModule = initializedModule ?? runtimeModule;
    installExternalSaveWriteback();
    const originalOpen = FS.open;
    const originalStat = FS.stat;
    const originalLstat = FS.lstat;

    FS.open = function(path, flags) {
      const readOnly = typeof flags === "string"
        ? !/[wa+]/.test(flags)
        : ((flags as number) & 3) === 0;
      if (!writingExternalSaveIntoVirtualFs) {
        if (readOnly) load(path);
        // Query SAF even if an older copy is already present in IDBFS; the external
        // file replaces it once per virtual path before BrowserWoditor consumes it.
        loadExternalSave(path);
      }
      return originalOpen.apply(FS, arguments as unknown as []);
    };
    FS.stat = function(path) {
      load(path);
      loadExternalSave(path);
      return originalStat.apply(FS, arguments as unknown as []);
    };
    FS.lstat = function(path) {
      load(path);
      loadExternalSave(path);
      return originalLstat.apply(FS, arguments as unknown as []);
    };
  });
}

function loadWoditor(source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = source;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load Browser Woditor: ${source}`));
    document.body.append(script);
  });
}

async function start() {
  if (!config?.gameId) {
    throw new Error("The WOLF browser player configuration is missing.");
  }
  // Recent Browser Woditor builds remove the global Module reference after
  // startup. Keep the initialized object supplied to preRun so packed games
  // retain access to the canvas just like loose-asset games do.
  runtimeModule.preRun.push((initializedModule) => {
    activeModule = initializedModule ?? runtimeModule;
  });
  installWolfCompatibility({
    gameId: config.gameId,
    initialSettings: config.settings,
    getCanvas: () => activeModule?.canvas ?? runtimeModule.canvas ?? document.querySelector<HTMLCanvasElement>("#canvas, canvas"),
  });
  if (config.mode === "loose") {
    if (!config.woditorSrc) {
      throw new Error("The WOLF loose-asset runtime script is missing.");
    }
    showStatus("Preparing WOLF assets");
    const assets = await requestAssets(config);
    installAssetLoader(assets);
    await loadWoditor(config.woditorSrc);
  }
}

void start().catch((cause) => {
  const message = cause instanceof Error ? cause.message : String(cause);
  showStatus(message);
  window.parent.postMessage({ type: "runtime-error", message }, window.location.origin);
});
