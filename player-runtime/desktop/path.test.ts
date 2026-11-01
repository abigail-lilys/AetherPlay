import { describe, expect, it } from "vitest";
import { createPathRuntime } from "./path";

function runtimeWithFiles(paths: string[]) {
  return createPathRuntime({
    entryId: "test-game",
    fileRoutePrefix: "/play/test-game/",
    files: paths.map((path) => ({
      path,
      url: `/play/test-game/${path}`,
      size: 1,
      mimeType: "application/wasm",
    })),
  });
}

describe("PGMMV/Emscripten wasm manifest aliases", () => {
  it("resolves unique wasm basename", () => {
    const runtime = runtimeWithFiles([
      "runtime/pgmmv.js",
      "runtime/pgmmv.wasm",
    ]);
    expect(runtime.lookupManifestFile("/www/pgmmv.wasm")?.path)
      .toBe("runtime/pgmmv.wasm");
  });

  it("does not guess duplicate wasm filenames", () => {
    const runtime = runtimeWithFiles([
      "runtime/pgmmv.wasm",
      "plugins/pgmmv.wasm",
    ]);
    expect(runtime.lookupManifestFile("/www/pgmmv.wasm"))
      .toBeNull();
  });

  it("does not match non-wasm or nested paths", () => {
    const runtime = runtimeWithFiles([
      "runtime/pgmmv.wasm",
      "runtime/config.dat",
    ]);
    expect(runtime.lookupManifestFile("/www/config.dat")).toBeNull();
    expect(runtime.lookupManifestFile("/www/runtime/pgmmv.wasm"))
      .toBeNull();
  });

  it("keeps exact manifest matches first", () => {
    const runtime = runtimeWithFiles([
      "www/pgmmv.wasm",
      "runtime/pgmmv.wasm",
    ]);
    expect(runtime.lookupManifestFile("/www/pgmmv.wasm")?.path)
      .toBe("www/pgmmv.wasm");
  });
});

