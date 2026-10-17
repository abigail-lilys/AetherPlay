import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const target = fileURLToPath(new URL("../public/mz-player-runtime/wolf.js", import.meta.url));
const source = await readFile(target, "utf8");
const oldTimeout = 'n(new Error("The browser player took too long to prepare WOLF assets."))},3e4);';
const newTimeout = 'n(new Error("The browser player took too long to prepare WOLF assets."))},12e4);';
if (source.includes(newTimeout)) {
  console.log("WOLF asset timeout already set to 120 seconds.");
} else {
  const count = source.split(oldTimeout).length - 1;
  if (count !== 1) {
    throw new Error(`Expected exactly one generated 30-second WOLF timeout, found ${count}. No runtime file changed.`);
  }
  await writeFile(target, source.replace(oldTimeout, newTimeout), "utf8");
  console.log("WOLF asset preparation timeout patched: 30s -> 120s.");
}
