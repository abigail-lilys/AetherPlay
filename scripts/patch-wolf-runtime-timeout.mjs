import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const target = fileURLToPath(new URL("../public/mz-player-runtime/wolf.js", import.meta.url));
const source = await readFile(target, "utf8");
const timeoutMessage = 'The browser player took too long to prepare WOLF assets.';
// esbuild may rename the minified reject callback as the WOLF bundle grows.
// Match the unique error message and timeout value, not a particular one-letter variable.
const oldTimeoutPattern = /([A-Za-z_$][\w$]*)\(new Error\("The browser player took too long to prepare WOLF assets\."\)\)\},\s*(?:3e4|30000)\s*\);/g;
const newTimeoutPattern = /[A-Za-z_$][\w$]*\(new Error\("The browser player took too long to prepare WOLF assets\."\)\)\},\s*(?:12e4|120000)\s*\);/;
if (newTimeoutPattern.test(source)) {
  console.log("WOLF asset timeout already set to 120 seconds.");
} else {
  const matches = [...source.matchAll(oldTimeoutPattern)];
  if (matches.length !== 1) {
    const messageCount = source.split(timeoutMessage).length - 1;
    throw new Error(`Expected exactly one generated 30-second WOLF timeout around the unique message; matched ${matches.length} timeout expression(s), message occurrences=${messageCount}. No runtime file changed.`);
  }
  const patched = source.replace(oldTimeoutPattern, (_match, callbackName) =>
    `${callbackName}(new Error("${timeoutMessage}"))},12e4);`);
  await writeFile(target, patched, "utf8");
  console.log("WOLF asset preparation timeout patched: 30s -> 120s (minifier-independent match).");
}
