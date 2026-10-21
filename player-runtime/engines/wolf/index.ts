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
};

type WolfRuntimeModule = {
  preRun: Array<(runtimeModule?: WolfRuntimeModule) => void>;
  canvas?: HTMLCanvasElement;
};

import { normalizeWolfPath, wolfPathKeys } from "@/player-runtime/engines/wolf/path";
import { installWolfCompatibility } from "@/player-runtime/engines/wolf/compatibility";
import type { WolfPlayerSettings } from "@/player-runtime/engines/wolf/compatibility";

declare const Module: WolfRuntimeModule;
declare const FS: {
  analyzePath(path: string): { exists: boolean };
  mkdir(path: string): void;
  writeFile: (...values: unknown[]) => unknown;
  open: (...values: unknown[]) => unknown;
  stat: (...values: unknown[]) => unknown;
  lstat: (...values: unknown[]) => unknown;
};

const config = (window as typeof window & {
  __WOLF_PLAYER_CONFIG__?: WolfPlayerConfig;
}).__WOLF_PLAYER_CONFIG__;
const runtimeModule = (window as typeof window & { Module?: WolfRuntimeModule }).Module ?? Module;
let activeModule: WolfRuntimeModule | undefined;

// AetherPlay WOLF debug bridge. This snippet is inserted after activeModule is declared.
type AetherDebugCommand = {
  type: "aetherplay-debug-command";
  requestId: string;
  gameId: string;
  command: "probe" | "list-files" | "read-file" | "write-file";
  path?: string;
  format?: "text" | "hex";
  content?: string;
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

// AetherPlay diagnostic: capture WebAssembly.Memory without relying on
// Emscripten Module.HEAP* properties.
type AetherDebugWasmApi = {
  instantiate: (...args: unknown[]) => unknown;
  instantiateStreaming?: (...args: unknown[]) => unknown;
};

let aetherDebugCapturedMemory: WebAssembly.Memory | undefined;
let aetherDebugMemorySource = "未捕获";
let aetherDebugWasmInstantiateCalls = 0;
let aetherDebugWasmCaptureHookInstalled = false;

function aetherDebugCaptureMemoryTree(
  value: unknown,
  source: string,
  depth = 0,
): void {
  if (typeof WebAssembly === "undefined") return;

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
window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.origin !== window.location.origin || event.source !== window.parent) return;
  if (!event.data || typeof event.data !== "object") return;
  const message = event.data as Partial<AetherDebugCommand>;
  if (message.type !== "aetherplay-debug-command" || typeof message.requestId !== "string" || typeof message.gameId !== "string" || message.gameId !== config?.gameId) return;
  const command = message.command;
  if (command !== "probe" && command !== "list-files" && command !== "read-file" && command !== "write-file") return;
  try {
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
      const memoryBuffer = heapU8?.buffer ?? memory?.buffer;
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

  runtimeModule.preRun.push((initializedModule) => {
    activeModule = initializedModule ?? runtimeModule;
    const originalOpen = FS.open;
    const originalStat = FS.stat;
    const originalLstat = FS.lstat;

    FS.open = function(path, flags) {
      const readOnly = typeof flags === "string"
        ? !/[wa+]/.test(flags)
        : ((flags as number) & 3) === 0;
      if (readOnly) load(path);
      return originalOpen.apply(FS, arguments as unknown as []);
    };
    FS.stat = function(path) {
      load(path);
      return originalStat.apply(FS, arguments as unknown as []);
    };
    FS.lstat = function(path) {
      load(path);
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
