import { Capacitor } from "@capacitor/core";
import { appendAndroidRuntimeLog, saveAndroidTextFile } from "@/src/lib/androidFolderPicker";

const STORAGE_KEY = "local-web-game-player-diagnostics-v1";
const MAX_ENTRIES = 800;
const MAX_DETAIL_CHARS = 2500;

type DiagnosticLevel = "info" | "warn" | "error";
type DiagnosticEntry = { at: string; level: DiagnosticLevel; event: string; details?: unknown };
let installed = false;
let originalConsoleError: typeof console.error | undefined;
let originalConsoleWarn: typeof console.warn | undefined;

function valueText(value: unknown): string {
  try {
    if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
    if (typeof value === "string") return value;
    const text = JSON.stringify(value, (_key, v) => {
      if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
      if (typeof v === "bigint") return String(v);
      return v;
    });
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
}

export function diagnosticErrorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`;
  return valueText(error);
}

function loadEntries(): DiagnosticEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed as DiagnosticEntry[] : [];
  } catch {
    return [];
  }
}

type RuntimeLogTarget = { gameId: string; treeUri: string; folderName: string };
type PendingRuntimeLine = { target: RuntimeLogTarget; line: string };
const MAX_PENDING_RUNTIME_LINES = 300;
const RUNTIME_FLUSH_BATCH_LINES = 50;
const RUNTIME_FLUSH_DELAY_MS = 1200;
let runtimeLogTarget: RuntimeLogTarget | null = null;
let runtimeLogUnavailableTreeUri: string | null = null;
let pendingRuntimeLines: PendingRuntimeLine[] = [];
let runtimeFlushTimer: ReturnType<typeof setTimeout> | undefined;
let runtimeFlushInFlight = false;

function persistDiagnosticEntry(entry: DiagnosticEntry): void {
  try {
    const entries = loadEntries();
    entries.push(entry);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // Logging must never interfere with gameplay when storage is full or unavailable.
  }
}

function queueRuntimeLine(entry: DiagnosticEntry): void {
  const target = runtimeLogTarget;
  if (!target || runtimeLogUnavailableTreeUri === target.treeUri || Capacitor.getPlatform() !== "android") return;
  const detail = entry.details === undefined ? "" : ` ${valueText(entry.details)}`;
  pendingRuntimeLines.push({
    target,
    line: `[${entry.at}] [${entry.level.toUpperCase()}] ${entry.event}${detail}\n`,
  });
  if (pendingRuntimeLines.length > MAX_PENDING_RUNTIME_LINES) pendingRuntimeLines.shift();
  if (pendingRuntimeLines.length >= RUNTIME_FLUSH_BATCH_LINES) {
    void flushRuntimeLog();
  } else if (runtimeFlushTimer === undefined) {
    runtimeFlushTimer = setTimeout(() => { void flushRuntimeLog(); }, RUNTIME_FLUSH_DELAY_MS);
  }
}

/** Select the folder belonging to the currently active game. */
export function setRuntimeLogTarget(target: RuntimeLogTarget | null): void {
  runtimeLogTarget = target;
  runtimeLogUnavailableTreeUri = null;
  if (pendingRuntimeLines.length && runtimeFlushTimer === undefined) {
    runtimeFlushTimer = setTimeout(() => { void flushRuntimeLog(); }, RUNTIME_FLUSH_DELAY_MS);
  }
}

/** Flush buffered entries. Android keeps a single runtime.log at <=512 KiB by truncating old entries in place. */
export async function flushRuntimeLog(): Promise<void> {
  if (runtimeFlushTimer !== undefined) {
    clearTimeout(runtimeFlushTimer);
    runtimeFlushTimer = undefined;
  }
  if (runtimeFlushInFlight || pendingRuntimeLines.length === 0) return;
  runtimeFlushInFlight = true;
  try {
    while (pendingRuntimeLines.length > 0) {
      const target = pendingRuntimeLines[0].target;
      if (target.treeUri === runtimeLogUnavailableTreeUri) {
        pendingRuntimeLines = pendingRuntimeLines.filter((item) => item.target.treeUri !== target.treeUri);
        continue;
      }
      const batch: PendingRuntimeLine[] = [];
      let batchChars = 0;
      for (const item of pendingRuntimeLines) {
        if (item.target.treeUri !== target.treeUri || batch.length >= RUNTIME_FLUSH_BATCH_LINES) break;
        if (batch.length > 0 && batchChars + item.line.length > 48 * 1024) break;
        batch.push(item);
        batchChars += item.line.length;
      }
      if (batch.length === 0) break;
      pendingRuntimeLines.splice(0, batch.length);
      try {
        await appendAndroidRuntimeLog(target.treeUri, batch.map((item) => item.line).join(""));
      } catch (cause) {
        runtimeLogUnavailableTreeUri = target.treeUri;
        pendingRuntimeLines = pendingRuntimeLines.filter((item) => item.target.treeUri !== target.treeUri);
        const failure: DiagnosticEntry = {
          at: new Date().toISOString(),
          level: "error",
          event: "runtime.log.write.failed",
          details: `${target.folderName} (${target.gameId}): ${diagnosticErrorText(cause)}`.slice(0, MAX_DETAIL_CHARS),
        };
        persistDiagnosticEntry(failure);
        originalConsoleWarn?.("Could not write runtime.log to the selected game folder", cause);
      }
    }
  } finally {
    runtimeFlushInFlight = false;
    if (pendingRuntimeLines.length > 0 && runtimeFlushTimer === undefined) {
      runtimeFlushTimer = setTimeout(() => { void flushRuntimeLog(); }, RUNTIME_FLUSH_DELAY_MS);
    }
  }
}

export function logDiagnostic(level: DiagnosticLevel, event: string, details?: unknown): void {
  let safeDetails: unknown = details;
  if (details !== undefined) {
    const encoded = valueText(details);
    safeDetails = encoded.length > MAX_DETAIL_CHARS ? `${encoded.slice(0, MAX_DETAIL_CHARS)}…[truncated]` : encoded;
  }
  const entry: DiagnosticEntry = {
    at: new Date().toISOString(),
    level,
    event,
    ...(safeDetails === undefined ? {} : { details: safeDetails }),
  };
  persistDiagnosticEntry(entry);
  queueRuntimeLine(entry);
}

export function installDiagnosticErrorHandlers(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  logDiagnostic("info", "diagnostics.initialized", {
    platform: Capacitor.getPlatform(),
    userAgent: navigator.userAgent,
    href: window.location.href,
  });
  window.addEventListener("error", (event) => {
    logDiagnostic("error", "window.error", {
      message: event.message, filename: event.filename, line: event.lineno, column: event.colno,
      error: diagnosticErrorText(event.error),
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    logDiagnostic("error", "window.unhandledrejection", { reason: diagnosticErrorText(event.reason) });
  });
  originalConsoleError = console.error.bind(console);
  originalConsoleWarn = console.warn.bind(console);
  console.error = (...args: unknown[]) => {
    logDiagnostic("error", "console.error", { args: args.map(valueText) });
    originalConsoleError?.(...args);
  };
  console.warn = (...args: unknown[]) => {
    logDiagnostic("warn", "console.warn", { args: args.map(valueText) });
    originalConsoleWarn?.(...args);
  };
}

export async function exportDiagnosticsTxt(): Promise<void> {
  logDiagnostic("info", "diagnostics.export.started", { platform: Capacitor.getPlatform() });
  const entries = loadEntries();
  const text = [
    "Local Web Game Player — diagnostic log",
    `Exported: ${new Date().toISOString()}`,
    `Platform: ${Capacitor.getPlatform()}`,
    `User-Agent: ${typeof navigator === "undefined" ? "unknown" : navigator.userAgent}`,
    `Entries: ${entries.length}`,
    "=".repeat(72),
    ...entries.map((entry) => `[${entry.at}] [${entry.level.toUpperCase()}] ${entry.event}${entry.details === undefined ? "" : `\n${valueText(entry.details)}`}`),
    "",
  ].join("\n");
  if (Capacitor.getPlatform() === "android") {
    await saveAndroidTextFile("LocalWebGamePlayer-diagnostics.txt", text);
    return;
  }
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "LocalWebGamePlayer-diagnostics.txt";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
