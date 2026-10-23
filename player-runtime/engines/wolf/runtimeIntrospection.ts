export type RuntimeValueKind = "function" | "memory" | "table" | "global" | "object" | "number" | "string" | "boolean" | "undefined" | "other";

export interface AetherWasmExportSummary {
  name: string;
  kind: RuntimeValueKind;
  arity?: number;
  byteLength?: number;
  length?: number;
  value?: string | number | boolean | null;
}
export interface AetherRuntimeIntrospection {
  generatedAt: string;
  moduleKeyCount: number;
  moduleKeys: string[];
  moduleKeysTruncated: boolean;
  moduleFunctionCount: number;
  moduleFunctions: Array<{ name: string; arity: number }>;
  variableApiCandidates: string[];
  wasmExportCount: number;
  wasmExports: AetherWasmExportSummary[];
  wasmExportsTruncated: boolean;
  wasmImports: string[];
  wasmImportsTruncated: boolean;
  nestedObjectShapes: Array<{ path: string; keys: string[]; functionKeys: string[]; truncated: boolean }>;
  scalarValues: Array<{ name: string; value: string | number | boolean | null }>;
  memoryBytes: number;
  memorySource: string;
  notes: string[];
}

const MAX_MODULE_KEYS = 300;
const MAX_FUNCTIONS = 240;
const MAX_EXPORTS = 800;
const MAX_IMPORTS = 800;
const MAX_NESTED_KEYS = 100;
const MAX_SCALARS = 120;
const MAX_NESTED_OBJECTS = 30;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return undefined;
  if (typeof Node !== "undefined" && value instanceof Node) return undefined;
  return value as Record<string, unknown>;
}
function printableScalar(value: unknown): string | number | boolean | null | undefined {
  if (value === null) return null;
  if (typeof value === "string") return value.length > 180 ? `${value.slice(0, 177)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  return undefined;
}
function isWasmMemory(value: unknown): value is WebAssembly.Memory {
  return typeof WebAssembly !== "undefined" && value instanceof WebAssembly.Memory;
}
function isWasmGlobal(value: unknown): value is WebAssembly.Global {
  return typeof WebAssembly !== "undefined" && value instanceof WebAssembly.Global;
}
function isWasmTable(value: unknown): value is WebAssembly.Table {
  return typeof WebAssembly !== "undefined" && value instanceof WebAssembly.Table;
}

export function summarizeWasmExports(value: unknown): AetherWasmExportSummary[] {
  const record = asRecord(value);
  if (!record) return [];
  const names = Object.keys(record);
  return names.slice(0, MAX_EXPORTS).map((name) => {
    let item: unknown;
    try { item = record[name]; } catch { item = undefined; }
    if (typeof item === "function") return { name, kind: "function", arity: item.length };
    if (isWasmMemory(item)) return { name, kind: "memory", byteLength: item.buffer.byteLength };
    if (isWasmTable(item)) {
      let length: number | undefined;
      try { length = item.length; } catch { /* inaccessible table */ }
      return { name, kind: "table", ...(length === undefined ? {} : { length }) };
    }
    if (isWasmGlobal(item)) {
      let raw: unknown;
      try { raw = item.value; } catch { raw = undefined; }
      const scalar = printableScalar(raw);
      return { name, kind: "global", ...(scalar === undefined ? {} : { value: scalar }) };
    }
    if (item === null) return { name, kind: "object", value: null };
    if (typeof item === "number") return { name, kind: "number", value: item };
    if (typeof item === "string") return { name, kind: "string", value: printableScalar(item) as string };
    if (typeof item === "boolean") return { name, kind: "boolean", value: item };
    if (item === undefined) return { name, kind: "undefined" };
    return { name, kind: "other" };
  });
}

export function summarizeWasmImports(value: unknown): string[] {
  const root = asRecord(value);
  if (!root) return [];
  const rows: string[] = [];
  for (const [moduleName, rawImports] of Object.entries(root)) {
    const imports = asRecord(rawImports);
    if (!imports) {
      rows.push(`${moduleName}: ${typeof rawImports}`);
      continue;
    }
    for (const [name, item] of Object.entries(imports)) {
      const kind = typeof item === "function" ? `function/${item.length}` : isWasmMemory(item) ? "memory" : isWasmTable(item) ? "table" : isWasmGlobal(item) ? "global" : typeof item;
      rows.push(`${moduleName}.${name}: ${kind}`);
      if (rows.length >= MAX_IMPORTS) return rows;
    }
  }
  return rows;
}

const VARIABLE_API_NAME = /(?:get|set|read|write|resolve|find|lookup).{0,28}(?:var(?:iable)?|value|cself|syss|global|slot)|(?:var(?:iable)?|value|cself|syss|global|slot).{0,28}(?:get|set|read|write|resolve|find|lookup)|^(?:get|set|read|write)_?(?:var|variable|value|self|system)/i;

export function inspectWasmRuntimeSurface(
  moduleValue: unknown,
  wasmExports: AetherWasmExportSummary[],
  wasmImports: string[],
  memoryBytes: number,
  memorySource: string,
): AetherRuntimeIntrospection {
  const module = asRecord(moduleValue) ?? {};
  let allKeys: string[] = [];
  try { allKeys = Object.keys(module).sort((a, b) => a.localeCompare(b)); } catch { /* inaccessible module proxy */ }
  const moduleKeys = allKeys.slice(0, MAX_MODULE_KEYS);
  const moduleFunctions = allKeys
    .filter((name) => {
      try { return typeof module[name] === "function"; } catch { return false; }
    })
    .map((name) => {
      try { return { name, arity: (module[name] as (...args: unknown[]) => unknown).length }; }
      catch { return { name, arity: -1 }; }
    });
  const candidateNames: string[] = [];
  for (const fn of moduleFunctions) {
    if (VARIABLE_API_NAME.test(fn.name)) candidateNames.push(`Module.${fn.name}(${fn.arity})`);
  }
  for (const item of wasmExports) {
    if (item.kind === "function" && VARIABLE_API_NAME.test(item.name)) candidateNames.push(`WASM.${item.name}(${item.arity ?? "?"})`);
  }

  const nestedObjectShapes: AetherRuntimeIntrospection["nestedObjectShapes"] = [];
  const visited = new Set<object>();
  const visit = (path: string, value: unknown, depth: number) => {
    if (nestedObjectShapes.length >= MAX_NESTED_OBJECTS || depth > 2) return;
    const record = asRecord(value);
    if (!record || visited.has(record)) return;
    visited.add(record);
    let keys: string[];
    try { keys = Object.keys(record).sort((a, b) => a.localeCompare(b)); } catch { return; }
    const shown = keys.slice(0, MAX_NESTED_KEYS);
    const functionKeys: string[] = [];
    for (const key of shown) {
      let child: unknown;
      try { child = record[key]; } catch { continue; }
      if (typeof child === "function") {
        functionKeys.push(`${key}(${child.length})`);
        if (VARIABLE_API_NAME.test(key)) candidateNames.push(`${path}.${key}(${child.length})`);
      }
    }
    nestedObjectShapes.push({ path, keys: shown, functionKeys, truncated: keys.length > shown.length });
    if (depth < 2) {
      for (const key of shown) {
        if (!/^(woditor|DxLib|asm|exports|instance|game|variable|variables|runtime|debug|data|system)$/i.test(key)) continue;
        let child: unknown;
        try { child = record[key]; } catch { continue; }
        visit(`${path}.${key}`, child, depth + 1);
      }
    }
  };
  for (const key of ["woditor", "DxLib", "asm", "exports", "instance", "game", "variables", "variable", "runtime", "debug"]) {
    let value: unknown;
    try { value = module[key]; } catch { continue; }
    if (value && typeof value === "object") visit(`Module.${key}`, value, 1);
  }

  const scalarValues: AetherRuntimeIntrospection["scalarValues"] = [];
  for (const name of allKeys) {
    if (scalarValues.length >= MAX_SCALARS) break;
    if (/^(HEAP|canvas|ctx|FS|wasmMemory|preRun|postRun|print|printErr|onRuntimeInitialized)$/i.test(name)) continue;
    let value: unknown;
    try { value = module[name]; } catch { continue; }
    const scalar = printableScalar(value);
    if (scalar !== undefined) scalarValues.push({ name, value: scalar });
  }

  const notes: string[] = [];
  if (candidateNames.length === 0) {
    notes.push("未发现名称明确的变量读写 API。当前运行时导出信息本身不能证明某个地址对应某个变量；后续需对 WASM 存储结构做逆向或使用可控变量变化验证地址。");
  } else {
    notes.push("发现名称疑似与变量/值访问有关的函数；仅凭名称还不能确定函数参数、调用约定或副作用。");
  }
  notes.push("WASM 导出中的 global 数值只作为线索；它们可能是栈指针/运行时状态，不自动视为变量地址。");
  return {
    generatedAt: new Date().toISOString(),
    moduleKeyCount: allKeys.length,
    moduleKeys,
    moduleKeysTruncated: allKeys.length > moduleKeys.length,
    moduleFunctionCount: moduleFunctions.length,
    moduleFunctions: moduleFunctions.slice(0, MAX_FUNCTIONS),
    variableApiCandidates: [...new Set(candidateNames)].slice(0, 100),
    wasmExportCount: wasmExports.length,
    wasmExports: wasmExports.slice(0, MAX_EXPORTS),
    wasmExportsTruncated: wasmExports.length >= MAX_EXPORTS,
    wasmImports: wasmImports.slice(0, MAX_IMPORTS),
    wasmImportsTruncated: wasmImports.length >= MAX_IMPORTS,
    nestedObjectShapes,
    scalarValues,
    memoryBytes,
    memorySource,
    notes,
  };
}
