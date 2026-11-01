import { afterEach, describe, expect, it, vi } from "vitest";
import { createAssetRouter } from "./assetRouting";
import { createPathRuntime } from "./path";

function createRouter(paths: string[]) {
  const config = {
    entryId: "test-game",
    fileRoutePrefix: "/play/test-game/",
    files: paths.map((path) => ({
      path,
      url: "/play/test-game/" + path,
      size: 1,
      mimeType: path.toLowerCase().endsWith(".wasm")
        ? "application/wasm"
        : "application/octet-stream",
    })),
  };

  return createAssetRouter(config, createPathRuntime(config));
}

function installFetchRecorder() {
  const requests: string[] = [];

  const fakeWindow = {
    location: { origin: "https://localhost" },
    fetch: async (input: string | URL) => {
      requests.push(String(input));
      return new Response("ok", { status: 200 });
    },
  };

  vi.stubGlobal("window", fakeWindow);
  return { browserWindow: fakeWindow, requests };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PGMMV Emscripten WASM URL aliases", () => {
  it("routes /www/pgmmv.wasm to runtime/pgmmv.wasm", async () => {
    const { browserWindow, requests } = installFetchRecorder();

    createRouter([
      "index.html",
      "runtime/pgmmv.js",
      "runtime/pgmmv.wasm",
    ]).installUrlPatch();

    await browserWindow.fetch("/www/pgmmv.wasm");

    expect(requests).toEqual([
      "/play/test-game/runtime/pgmmv.wasm",
    ]);
  });

  it("routes a bare unique wasm filename", async () => {
    const { browserWindow, requests } = installFetchRecorder();

    createRouter([
      "index.html",
      "runtime/pgmmv.wasm",
    ]).installUrlPatch();

    await browserWindow.fetch("pgmmv.wasm");

    expect(requests).toEqual([
      "/play/test-game/runtime/pgmmv.wasm",
    ]);
  });

  it("does not guess when wasm basenames are duplicated", async () => {
    const { browserWindow, requests } = installFetchRecorder();

    createRouter([
      "index.html",
      "runtime/pgmmv.wasm",
      "plugins/pgmmv.wasm",
    ]).installUrlPatch();

    await browserWindow.fetch("/www/pgmmv.wasm");

    expect(requests).toEqual([
      "/www/pgmmv.wasm",
    ]);
  });
});
