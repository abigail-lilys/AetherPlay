import { describe, expect, it } from "vitest";
import { inspectWasmRuntimeSurface, summarizeWasmExports, summarizeWasmImports } from "./runtimeIntrospection";

describe("WOLF runtime surface probe", () => {
  it("summarizes exports without reading or mutating WASM memory", () => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const global = new WebAssembly.Global({ value: "i32", mutable: true }, 4096);
    const exports = summarizeWasmExports({
      memory,
      _main: () => 0,
      _getVariable: (id: number) => id,
      __stack_pointer: global,
      version: 3,
    });
    expect(exports).toContainEqual(expect.objectContaining({ name: "memory", kind: "memory", byteLength: 65536 }));
    expect(exports).toContainEqual(expect.objectContaining({ name: "_getVariable", kind: "function", arity: 1 }));
    expect(exports).toContainEqual(expect.objectContaining({ name: "__stack_pointer", kind: "global", value: 4096 }));
  });

  it("lists module import names without invoking imported functions", () => {
    const imports = summarizeWasmImports({
      env: { abort: () => undefined, memory: new WebAssembly.Memory({ initial: 1 }) },
      wasi_snapshot_preview1: { proc_exit: (code: number) => code },
    });
    expect(imports).toContain("env.abort: function/0");
    expect(imports).toContain("env.memory: memory");
    expect(imports).toContain("wasi_snapshot_preview1.proc_exit: function/1");
  });

  it("marks function names as candidates, not confirmed variable mappings", () => {
    const result = inspectWasmRuntimeSurface({
      _getVariable: (id: number) => id,
      _main: () => 0,
      woditor: { _setVariable: (_id: number, value: number) => value, textInputState: 0 },
    }, [
      { name: "memory", kind: "memory", byteLength: 65536 },
      { name: "get_variable_value", kind: "function", arity: 1 },
    ], ["env.abort: function/0"], 65536, "test memory");
    expect(result.variableApiCandidates.some((item) => item.includes("getVariable"))).toBe(true);
    expect(result.variableApiCandidates.some((item) => item.includes("setVariable"))).toBe(true);
    expect(result.notes.join(" ")).toContain("名称");
    expect(result.memoryBytes).toBe(65536);
  });

  it("clearly reports when no direct variable API is visible", () => {
    const result = inspectWasmRuntimeSurface({ _main: () => 0, _malloc: (size: number) => size }, [], [], 1024, "test");
    expect(result.variableApiCandidates).toHaveLength(0);
    expect(result.notes.join(" ")).toContain("未发现名称明确的变量读写 API");
  });
});
