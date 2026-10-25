import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Capacitor } from "@capacitor/core";
import { saveAndroidTextFile } from "@/src/lib/androidFolderPicker";
import type { WolfVariableCatalog } from "@/player-runtime/engines/wolf/variableCatalog";
import type { AetherRuntimeIntrospection } from "@/player-runtime/engines/wolf/runtimeIntrospection";
import type { WolfHpPointerChainSnapshot } from "@/player-runtime/engines/wolf/hpPointerChain";
import { WolfVariableCatalogView, type WolfVariableProbeTarget } from "@/src/components/WolfVariableCatalogView";

type DebugCommand = "probe" | "runtime-introspect" | "address-trace" | "variable-catalog" | "wolf-variable-range-read" | "wolf-variable-base-detect" | "wolf-variable-write" | "wolf-variable-watch-start" | "wolf-variable-watch-stop" | "sys-variable-base-detect" | "sys-variable-range-read" | "list-files" | "read-file" | "write-file" | "scan-first" | "scan-unknown-first" | "scan-next" | "scan-page" | "scan-reset" | "memory-read" | "memory-neighborhood" | "memory-write" | "freeze-add" | "freeze-remove" | "freeze-clear" | "hp-chain-read" | "hp-chain-write" | "wasm-binary-export";
type DebugTab = "overview" | "files" | "variables" | "memory";
type DebugFormat = "text" | "hex";
type DebugScanType = "i8" | "u8" | "i16" | "u16" | "i32" | "u32" | "f32" | "f64";
type DebugScanFilter = "changed" | "unchanged" | "increased" | "decreased" | "equal" | "not-equal" | "greater" | "less" | "between";
type DebugScanMode = "exact" | "unknown";
interface DebugScanResult { offset: number; value: number }
interface DebugScanSummary { scanType: DebugScanType; count: number; scannedBytes: number; truncated: boolean; aligned: boolean; page: number; pageCount: number; results: DebugScanResult[]; unknownBaselinePending: boolean; scanStartOffset: number; scanEndOffset: number }
interface DebugAddressWord { offset: number; hex: string; value: number; signedValue: number; floatValue: number }
interface DebugAddressReference { offset: number; offsetHex: string; pointsTo: number; pointsToHex: string; delta: number; exact: boolean; context: DebugAddressWord[] }
interface DebugAddressTrace { targetOffset: number; targetHex: string; memoryBytes: number; scannedBytes: number; scannedWords: number; radiusBytes: number; exactReferenceCount: number; nearbyReferenceCount: number; referencesTruncated: boolean; references: DebugAddressReference[]; targetContext: DebugAddressWord[]; notes: string[] }
interface DebugNeighborhoodWord { offset: number; offsetHex: string; hex: string; u32: number; i32: number; f32: number }
interface DebugNeighborhoodSnapshot { capturedAt: string; anchorOffset: number; anchorHex: string; radiusBytes: number; memoryBytes: number; words: DebugNeighborhoodWord[] }
interface DebugFreezeEntry { key: string; type: DebugScanType; offset: number; value: number }
interface DebugWolfVariableRange { base: number; count: number; memoryBytes: number; rows: Array<{ id: number; address: number; value: number }> }
interface DebugWolfVariableBaseCandidate { base: number; slotAddress: number; values: { v16: number; v17: number; v18: number; v19: number } }
interface DebugWolfVariableBaseDetection { memoryBytes: number; scannedBytes: number; candidateCount: number; truncated: boolean; candidates: DebugWolfVariableBaseCandidate[] }
interface DebugSysVariableCandidate { base: number; signatureAddress: number }
interface DebugSysVariableBaseDetection { startIndex: number; variableCount: number; signatureValues: number[]; memoryBytes: number; scannedBytes: number; candidateCount: number; truncated: boolean; candidates: DebugSysVariableCandidate[] }
interface DebugSysVariableRange { base: number; count: number; memoryBytes: number; rows: Array<{ id: number; address: number; value: number }> }
interface DebugWolfVariableWriteResult { variableId: number; base: number; address: number; expectedValue: number; requestedValue: number; immediateValue: number; memoryBytes: number }
interface DebugWolfVariableChange { id: number; before: number; after: number; delta: number }
interface DebugWolfVariableWatchResult { base: number; count: number; startedAt?: string; endedAt?: string; durationMs?: number; changes?: DebugWolfVariableChange[]; totalChanges?: number }

interface DebugEntry {
  name: string;
  path: string;
  kind: "directory" | "file";
  size: number;
}
interface DebugFile {
  path: string;
  size: number;
  format: DebugFormat;
  content: string;
}
interface DebugCapabilities {
  engine: string;
  moduleAvailable: boolean;
  filesystemAvailable: boolean;
  memoryAvailable: boolean;
  heapU8: boolean;
  heap32: boolean;
  heapF32: boolean;
  heapF64: boolean;
  heapBytes: number;
  wasmMemory: boolean;
  wasmMemorySource: string;
  wasmCaptureHookInstalled: boolean;
  wasmInstantiateCalls: number;
}
interface DebugResponse {
  type: "aetherplay-debug-result";
  requestId: string;
  gameId: string;
  command: DebugCommand;
  ok: boolean;
  error?: string;
  capabilities?: DebugCapabilities;
  path?: string;
  entries?: DebugEntry[];
  truncated?: boolean;
  file?: DebugFile;
  backupPath?: string;
  scan?: DebugScanSummary;
  memoryValue?: number;
  frozenCount?: number;
  variableCatalog?: WolfVariableCatalog;
  wolfVariables?: DebugWolfVariableRange;
  wolfVariableBaseDetection?: DebugWolfVariableBaseDetection;
  wolfVariableWrite?: DebugWolfVariableWriteResult;
  wolfVariableWatch?: DebugWolfVariableWatchResult;
  sysVariables?: DebugSysVariableRange;
  sysVariableBaseDetection?: DebugSysVariableBaseDetection;
  runtimeIntrospection?: AetherRuntimeIntrospection;
  addressTrace?: DebugAddressTrace;
  hpChain?: WolfHpPointerChainSnapshot;
  neighborhood?: DebugNeighborhoodSnapshot;
  wasmBinary?: Uint8Array;
  wasmBinaryBytes?: number;
  wasmBinaryCaptureStatus?: string;
}
interface DebugRequestArgs { path?: string; format?: DebugFormat; content?: string; scanType?: DebugScanType; scanValue?: number; scanValue2?: number; scanFilter?: DebugScanFilter; scanStartOffset?: number; scanEndOffset?: number; page?: number; aligned?: boolean; offset?: number; neighborhoodRadius?: number; value?: number; expectedValue?: number; variableBase?: number; variableCount?: number; anchorValue?: number; v16Value?: number; v18Value?: number; v19Value?: number; variableId?: number; sysStartIndex?: number; sysVariableBase?: number; sysVariableCount?: number; sysSignatureValues?: number[]; }
interface PendingRequest {
  resolve: (response: DebugResponse) => void;
  reject: (error: Error) => void;
  timeout: number;
}
interface GameDebugPanelProps {
  visible: boolean;
  gameId: string;
  gameTitle: string;
  frameRef: RefObject<HTMLIFrameElement | null>;
  onClose: () => void;
}

const MAX_EDITOR_BYTES = 256 * 1024;
const panelStyle: CSSProperties = {
  position: "fixed", inset: 0, zIndex: 100000, display: "flex", flexDirection: "column",
  background: "#0b1018", color: "#edf3fc", fontFamily: "system-ui, -apple-system, sans-serif",
};
const buttonStyle: CSSProperties = {
  border: "1px solid #354258", borderRadius: 10, padding: "9px 12px", color: "#eaf1fc",
  background: "#182335", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const subtleStyle: CSSProperties = { color: "#9eacc1", fontSize: 12 };
const inputStyle: CSSProperties = {
  width: "100%", boxSizing: "border-box", border: "1px solid #354258", borderRadius: 10,
  padding: 10, background: "#080d14", color: "#edf3fc", fontSize: 13,
};
// AETHER_WOLF_VARIABLE_TRACKER_V1: per-game user labels live in localStorage; builtin labels stay as fallback.
const WOLF_USER_LABELS_KEY = "aetherplay-wolf-user-labels";
function readUserVariableLabels(): Record<string, Record<number, string>> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(WOLF_USER_LABELS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, Record<number, string>> : {};
  } catch { return {}; }
}
function writeUserVariableLabel(gameId: string, variableId: number, label: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    const all = readUserVariableLabels();
    const gameLabels = all[gameId] ?? {};
    const trimmed = label.trim();
    if (trimmed) gameLabels[variableId] = trimmed; else delete gameLabels[variableId];
    all[gameId] = gameLabels;
    localStorage.setItem(WOLF_USER_LABELS_KEY, JSON.stringify(all));
  } catch { /* quota / private mode: labels just won't persist */ }
}
const WOLF_RUNTIME_VARIABLE_LABELS: Record<number, string> = {
  16: "メニュー非表示 / 菜单隐藏",
  17: "所持金 / 持有金钱",
  18: "連れている魔物ID / 携带魔物 ID",
  19: "追跡開始ID / 追踪开始 ID",
};

function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "未知大小";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
function parentPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return `/${parts.join("/")}`;
}

export function GameDebugPanel({ visible, gameId, gameTitle, frameRef, onClose }: GameDebugPanelProps) {
  const [tab, setTab] = useState<DebugTab>("overview");
  const [capabilities, setCapabilities] = useState<DebugCapabilities | null>(null);
  const [currentPath, setCurrentPath] = useState("/");
  const [entries, setEntries] = useState<DebugEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [selectedFile, setSelectedFile] = useState<DebugFile | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [scanType, setScanType] = useState<DebugScanType>("i32");
  const [scanMode, setScanMode] = useState<DebugScanMode>("exact");
  const [scanValue, setScanValue] = useState("100");
  const [refineValue, setRefineValue] = useState("100");
  const [refineValue2, setRefineValue2] = useState("200");
  const [unknownStartText, setUnknownStartText] = useState("0");
  const [unknownEndText, setUnknownEndText] = useState("");
  const [scanFilter, setScanFilter] = useState<DebugScanFilter>("changed");
  const [alignedScan, setAlignedScan] = useState(true);
  const [scanSummary, setScanSummary] = useState<DebugScanSummary | null>(null);
  const [traceAddressText, setTraceAddressText] = useState("0x0795c0b0");
  const [addressTrace, setAddressTrace] = useState<DebugAddressTrace | null>(null);
  // Default anchor is the candidate address from the previous "mi" game report; replace it for other games.
  const [neighborhoodAddressText, setNeighborhoodAddressText] = useState("0x03CECC0C");
  const [neighborhoodRadiusText, setNeighborhoodRadiusText] = useState("128");
  const [neighborhoodSnapshot, setNeighborhoodSnapshot] = useState<DebugNeighborhoodSnapshot | null>(null);
  const [neighborhoodBaseline, setNeighborhoodBaseline] = useState<DebugNeighborhoodSnapshot | null>(null);
  const [scanResults, setScanResults] = useState<DebugScanResult[]>([]);
  const [rowValues, setRowValues] = useState<Record<number, string>>({});
  const [frozenResults, setFrozenResults] = useState<DebugFreezeEntry[]>([]);
  // AETHER_WOLF_RUNTIME_VARIABLE_RANGE_V1: the base is a per-instance candidate, not a permanent pointer.
  const [variableCatalog, setVariableCatalog] = useState<WolfVariableCatalog | null>(null);
  const [wolfVariableBaseText, setWolfVariableBaseText] = useState("0x03CECBC8");
  const [wolfVariableCountText, setWolfVariableCountText] = useState("65");
  const [wolfVariableRange, setWolfVariableRange] = useState<DebugWolfVariableRange | null>(null);
  // AETHER_WOLF_VARIABLE_WRITE_V1: draft values are per-row; the baseline snapshot is intentionally not mutated by writes.
  const [wolfVariableEditValues, setWolfVariableEditValues] = useState<Record<number, string>>({});
  // AETHER_WOLF_VARIABLE_BASE_DETECT_V1: known signature values may be edited for the current game state.
  const [wolfV17AnchorValueText, setWolfV17AnchorValueText] = useState("");
  const [wolfV16SignatureText, setWolfV16SignatureText] = useState("0");
  const [wolfV18SignatureText, setWolfV18SignatureText] = useState("-1");
  const [wolfV19SignatureText, setWolfV19SignatureText] = useState("57");
  const [wolfVariableBaseDetection, setWolfVariableBaseDetection] = useState<DebugWolfVariableBaseDetection | null>(null);
  // AETHER_WOLF_SYS_BASE_DETECT_V1: read-only Sys numeric table locator; no write path is exposed.
  const [sysVariableStartIndexText, setSysVariableStartIndexText] = useState("0");
  const [sysVariableCountText, setSysVariableCountText] = useState("135");
  const [sysSignatureTexts, setSysSignatureTexts] = useState<string[]>(["", "", "", ""]);
  const [sysVariableBaseDetection, setSysVariableBaseDetection] = useState<DebugSysVariableBaseDetection | null>(null);
  const [sysVariableRange, setSysVariableRange] = useState<DebugSysVariableRange | null>(null);

  // AETHER_WOLF_VARIABLE_TRACKER_V1: watch snapshot lives in runtime; panel keeps only UI state and labels.
  const [projectVariableNames, setProjectVariableNames] = useState<Record<number, string>>({});
  // AETHER_WOLF_VARIABLE_BRIDGE_V4: Accurate V0..V64 name mapping from string IDs.
  useEffect(() => {
    if (!variableCatalog) { setProjectVariableNames({}); return; }
    const next: Record<number, string> = {};
    const walk = (node: any) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node.variables)) {
        for (const v of node.variables) {
          const rawId = String(v.id ?? "");
          const m = rawId.match(/^V(\d+)$/i);
          if (m) {
            const id = Number(m[1]);
            const name = String(v.name ?? v.displayName ?? "").trim();
            if (Number.isSafeInteger(id) && id >= 0 && id <= 64 && name) {
              next[id] = name;
            }
          }
        }
      }
      if (Array.isArray(node)) {
        node.forEach(walk);
      } else {
        Object.values(node).forEach(child => {
          if (child && typeof child === "object") walk(child);
        });
      }
    };
    walk(variableCatalog);
    setProjectVariableNames(next);
  }, [variableCatalog]);

  const [wolfLabelDrafts, setWolfLabelDrafts] = useState<Record<number, string>>({});
  
  const getWolfLabel = (id: number): string | undefined => 
    wolfUserLabels[id] ?? projectVariableNames[id] ?? WOLF_RUNTIME_VARIABLE_LABELS[id];

  const saveWolfVariableLabel = (variableId: number) => {
    const draft = (wolfLabelDrafts[variableId] ?? "").trim();
    writeUserVariableLabel(gameId, variableId, draft);
    setWolfUserLabels((old) => {
      const next = { ...old };
      if (draft) next[variableId] = draft; else delete next[variableId];
      return next;
    });
    setWolfLabelDrafts((old) => { const next = { ...old }; delete next[variableId]; return next; });
    setNotice(draft ? `已保存 V${variableId} 名称「${draft}」（本机）。` : `已清除 V${variableId} 的名称标注。`);
  };

  const [wolfVariableWatchStartedAt, setWolfVariableWatchStartedAt] = useState<string | null>(null);
  const [wolfVariableWatchChanges, setWolfVariableChanges] = useState<DebugWolfVariableChange[] | null>(null);
  const [wolfVariableWatchDurationMs, setWolfVariableWatchDurationMs] = useState<number | null>(null);
  const [wolfUserLabels, setWolfUserLabels] = useState<Record<number, string>>({});
  // AETHER_WOLF_RUNTIME_VARIABLE_DIFF_V1: compare snapshots from the same live game instance.
  const [wolfVariableBaseline, setWolfVariableBaseline] = useState<{ gameId: string; range: DebugWolfVariableRange; capturedAt: string } | null>(null);
  const [runtimeIntrospection, setRuntimeIntrospection] = useState<AetherRuntimeIntrospection | null>(null);
  // Read-only validation for a user-supplied, known WOLF variable address.
  const [directAddressText, setDirectAddressText] = useState("0x0795c0b0");
  const [directAddressType, setDirectAddressType] = useState<DebugScanType>("i32");
  const [directMemoryValue, setDirectMemoryValue] = useState<number | null>(null);
  const [directMemoryReadOffset, setDirectMemoryReadOffset] = useState<number | null>(null);
  const [directMemoryReadAt, setDirectMemoryReadAt] = useState("");
  const [hpChain, setHpChain] = useState<WolfHpPointerChainSnapshot | null>(null);
  const [variableProbeTarget, setVariableProbeTarget] = useState<WolfVariableProbeTarget | null>(null);
  const pending = useRef(new Map<string, PendingRequest>());

  const request = useCallback((command: DebugCommand, args: DebugRequestArgs = {}) => {
    const target = frameRef.current?.contentWindow;
    if (!target) return Promise.reject(new Error("游戏 iframe 尚未就绪。"));
    const requestId = newRequestId();
    return new Promise<DebugResponse>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pending.current.delete(requestId);
        reject(new Error("游戏运行时没有响应。请确认游戏已启动，再重试。"));
      }, command === "scan-first" || command === "scan-unknown-first" || command === "scan-next" || command === "variable-catalog" || command === "address-trace" || command === "wasm-binary-export" || command === "wolf-variable-base-detect" || command === "sys-variable-base-detect" ? 180000 : 8000);
      pending.current.set(requestId, { resolve, reject, timeout });
      try {
        target.postMessage({
          type: "aetherplay-debug-command", requestId, gameId, command, ...args,
        }, window.location.origin);
      } catch (cause) {
        window.clearTimeout(timeout);
        pending.current.delete(requestId);
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
    });
  }, [frameRef, gameId]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
      if (!event.data || typeof event.data !== "object") return;
      const response = event.data as Partial<DebugResponse>;
      if (response.type !== "aetherplay-debug-result" || response.gameId !== gameId || typeof response.requestId !== "string") return;
      const item = pending.current.get(response.requestId);
      if (!item) return;
      window.clearTimeout(item.timeout);
      pending.current.delete(response.requestId);
      if (response.ok) item.resolve(response as DebugResponse);
      else item.reject(new Error(response.error || "游戏运行时执行失败。"));
    };
    window.addEventListener("message", onMessage);
    void request("probe").then((response) => {
      setCapabilities(response.capabilities ?? null);
      setNotice("已连接游戏运行时。");
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      window.removeEventListener("message", onMessage);
      for (const item of pending.current.values()) {
        window.clearTimeout(item.timeout);
        item.reject(new Error("调试面板已关闭。"));
      }
      pending.current.clear();
    };
  }, [frameRef, gameId, request]);

  const loadDirectory = useCallback(async (path: string) => {
    setBusy("正在读取目录…");
    setError("");
    setNotice("");
    setSelectedFile(null);
    setEditorContent("");
    try {
      const response = await request("list-files", { path });
      setCurrentPath(response.path || path);
      setEntries(response.entries || []);
      setTruncated(Boolean(response.truncated));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setEntries([]);
    } finally {
      setBusy("");
    }
  }, [request]);

  useEffect(() => {
    if (tab === "files") void loadDirectory(currentPath);
  }, [tab, currentPath, loadDirectory]);

  const openFile = async (entry: DebugEntry) => {
    setBusy(`正在读取 ${entry.name}…`);
    setError("");
    setNotice("");
    try {
      const response = await request("read-file", { path: entry.path });
      if (!response.file) throw new Error("运行时没有返回文件内容。");
      setSelectedFile(response.file);
      setEditorContent(response.file.content);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  };

  const saveFile = async () => {
    if (!selectedFile) return;
    const editedBytes = selectedFile.format === "hex"
      ? Math.ceil(editorContent.replace(/\s+/g, "").length / 2)
      : new TextEncoder().encode(editorContent).byteLength;
    if (editedBytes > MAX_EDITOR_BYTES) {
      setError("编辑内容超过 256 KiB，已阻止写入。");
      return;
    }
    const warning = `即将修改游戏虚拟文件：\n${selectedFile.path}\n\n运行时会先创建原文件备份。若这是存档或关键数据，仍建议先在游戏内另存一份。继续吗？`;
    if (!window.confirm(warning)) return;
    setBusy("正在备份并写入…");
    setError("");
    setNotice("");
    try {
      const response = await request("write-file", {
        path: selectedFile.path, format: selectedFile.format, content: editorContent,
      });
      setNotice(`已写入。原文件备份：${response.backupPath || "已创建"}`);
      const refreshed = await request("read-file", { path: selectedFile.path });
      if (refreshed.file) {
        setSelectedFile(refreshed.file);
        setEditorContent(refreshed.file.content);
      }
      const listing = await request("list-files", { path: currentPath });
      setEntries(listing.entries || []);
      setTruncated(Boolean(listing.truncated));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  };

  const readNumericInput = (raw: string, label: string) => {
    const parsed = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(parsed)) throw new Error(`${label}必须是有效数值。`);
    return parsed;
  };
  const readScanValue = () => readNumericInput(scanValue, "首次搜索值");
  const readAddressInput = (raw: string, label: string, allowEmpty = false): number | undefined => {
    if (allowEmpty && raw.trim() === "") return undefined;
    const parsed = Number(raw.trim());
    if (raw.trim() === "" || !Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label}必须是非负整数；可用十进制或 0x 十六进制。`);
    return parsed;
  };
  const readDirectMemoryAddress = async () => {
    let offset: number;
    try {
      offset = readAddressInput(directAddressText, "内存地址") as number;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    setBusy("正在读取指定 WASM 内存地址…"); setError(""); setNotice("");
    try {
      const response = await request("memory-read", { scanType: directAddressType, offset });
      if (typeof response.memoryValue !== "number" || !Number.isFinite(response.memoryValue)) {
        throw new Error("运行时未返回有效数值。请确认地址、数据类型和游戏实例。");
      }
      setDirectMemoryValue(response.memoryValue);
      setDirectMemoryReadOffset(offset);
      setDirectMemoryReadAt(new Date().toLocaleTimeString());
      setNotice(`只读成功：0x${offset.toString(16).toUpperCase()}（${directAddressType}）= ${response.memoryValue}`);
    } catch (cause) {
      setDirectMemoryValue(null);
      setDirectMemoryReadOffset(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  };

  const captureMemoryNeighborhood = async () => {
    let offset: number;
    let radius: number;
    try {
      offset = readAddressInput(neighborhoodAddressText, "锚点地址") as number;
      radius = readAddressInput(neighborhoodRadiusText, "邻域半径") as number;
      if (!Number.isSafeInteger(offset) || offset > 0xffffffff) throw new Error("锚点必须是有效的 WASM32 地址（不超过 0xFFFFFFFF）。");
      if (!Number.isSafeInteger(radius) || radius < 0 || radius > 512) throw new Error("邻域半径必须是 0 至 512 的整数。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    setBusy("正在读取锚点周边 WASM 内存（只读）…"); setError(""); setNotice("");
    try {
      const response = await request("memory-neighborhood", { offset, neighborhoodRadius: radius });
      if (!response.neighborhood) throw new Error("运行时没有返回内存邻域快照。");
      setNeighborhoodSnapshot(response.neighborhood);
      const compatible = neighborhoodBaseline && neighborhoodBaseline.anchorOffset === response.neighborhood.anchorOffset && neighborhoodBaseline.radiusBytes === response.neighborhood.radiusBytes;
      const changedCount = compatible
        ? response.neighborhood.words.filter((word) => neighborhoodBaseline!.words.find((prior) => prior.offset === word.offset)?.hex !== word.hex).length
        : null;
      setNotice(compatible
        ? `邻域快照完成：${response.neighborhood.words.length} 个 32 位字；相对基线有 ${changedCount} 处原始值变化。`
        : `邻域快照完成：${response.neighborhood.words.length} 个 32 位字。可将当前快照设为基线，再采集一次比较变化。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(""); }
  };

  const refreshHpChain = async () => {
    setBusy("正在重新解析动态 HP 指针链…"); setError(""); setNotice("");
    try {
      const response = await request("hp-chain-read");
      if (!response.hpChain) throw new Error("运行时没有返回 HP 指针链。");
      setHpChain(response.hpChain);
      setDirectAddressText(`0x${response.hpChain.hpAddress.toString(16).toUpperCase().padStart(8, "0")}`);
      setDirectAddressType("i32");
      setDirectMemoryValue(response.hpChain.hpValue);
      setDirectMemoryReadOffset(response.hpChain.hpAddress);
      setDirectMemoryReadAt(new Date().toLocaleTimeString());
      setNotice(`实时 HP 已读取：${response.hpChain.hpValue}，地址 0x${response.hpChain.hpAddress.toString(16).toUpperCase().padStart(8, "0")}。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(""); }
  };

  const writeHpChain = async (rawValue: string) => {
    setError(""); setNotice("");
    try {
      if (!hpChain) throw new Error("请先读取实时 HP 指针链。");
      const value = readNumericInput(rawValue, "新的 HP");
      if (!Number.isSafeInteger(value) || value < -2147483648 || value > 2147483647)
        throw new Error("新的 HP 必须是 Int32 整数（-2147483648 至 2147483647）。");
      if (!window.confirm(`即将修改游戏实时 HP：\n\n当前记录值：${hpChain.hpValue}\n新值：${value}\n\n写入前会重新解析指针链并核对旧值。继续吗？`)) return;
      setBusy("正在重新解析并安全写入 HP…");
      const response = await request("hp-chain-write", { expectedValue: hpChain.hpValue, value });
      if (!response.hpChain) throw new Error("运行时没有返回 HP 写入校验结果。");
      setHpChain(response.hpChain);
      setDirectAddressText(`0x${response.hpChain.hpAddress.toString(16).toUpperCase().padStart(8, "0")}`);
      setDirectAddressType("i32");
      setDirectMemoryValue(response.hpChain.hpValue);
      setDirectMemoryReadOffset(response.hpChain.hpAddress);
      setDirectMemoryReadAt(new Date().toLocaleTimeString());
      setNotice(`HP 修改并回读验证成功：${response.hpChain.hpValue}。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(""); }
  };

  const applyScanResponse = (response: DebugResponse) => {
    if (!response.scan) throw new Error("运行时没有返回扫描结果。");
    setScanSummary(response.scan); setScanResults(response.scan.results || []); setRowValues({});
    setScanType(response.scan.scanType);
    setNotice(response.scan.unknownBaselinePending
      ? `未知初始值快照已记录（${formatBytes(response.scan.scannedBytes)}）。回到游戏操作后，可使用变化条件复筛。`
      : `扫描完成：${response.scan.count.toLocaleString()} 个候选地址。`);
  };
  const runAddressTrace = async () => {
    setBusy("正在扫描指向 HP 地址的指针…"); setError(""); setNotice("");
    try {
      const offset = readAddressInput(traceAddressText, "目标地址") as number;
      if (offset > 0xffffffff) throw new Error("WASM32 指针地址必须不超过 0xFFFFFFFF。");
      const response = await request("address-trace", { offset });
      if (!response.addressTrace) throw new Error("运行时没有返回地址引用分析结果。");
      setAddressTrace(response.addressTrace);
      setNotice(`地址分析完成：发现 ${response.addressTrace.exactReferenceCount} 个精确引用、${response.addressTrace.nearbyReferenceCount} 个附近指针候选。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(""); }
  };
  const exportAddressTrace = async () => {
    if (!addressTrace) return;
    setBusy("正在导出地址引用分析 JSON…"); setError("");
    try {
      const report = { format: "aetherplay-wolf-address-reference-analysis", schemaVersion: 1, exportedAt: new Date().toISOString(), game: { id: gameId, title: gameTitle }, addressTrace };
      const filename = `AetherPlay-WOLF-Address-${addressTrace.targetHex.replace(/^0x/i, "")}.json`;
      await saveAndroidTextFile(filename, JSON.stringify(report, null, 2));
      setNotice(`已请求保存 ${filename}。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(""); }
  };

  const exportMemoryNeighborhood = async () => {
    if (!neighborhoodSnapshot) return;
    const comparable = neighborhoodBaseline && neighborhoodBaseline.anchorOffset === neighborhoodSnapshot.anchorOffset && neighborhoodBaseline.radiusBytes === neighborhoodSnapshot.radiusBytes;
    const differences = comparable
      ? neighborhoodSnapshot.words.flatMap((word) => {
          const prior = neighborhoodBaseline!.words.find((item) => item.offset === word.offset);
          return prior && prior.hex !== word.hex ? [{ offset: word.offset, offsetHex: word.offsetHex, before: prior, after: word }] : [];
        })
      : null;
    const payload = {
      format: "aetherplay-wolf-memory-neighborhood-diff",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      game: { id: gameId, title: gameTitle },
      baseline: neighborhoodBaseline,
      current: neighborhoodSnapshot,
      comparable: Boolean(comparable),
      differences,
      notes: [
        "这是只读的 32 位小端内存邻域快照；采集过程不修改游戏内存。",
        "hex/u32/i32/f32 是同一组 4 字节的不同解释，浮点解释不代表该位置必然是浮点变量。",
        "地址属于当前 WASM 游戏实例；重启或重新进入游戏后可能变化。",
        "默认锚点来自此前 mi 游戏的 V17（所持金）候选地址 0x03CECC0C；其他游戏必须先确认并替换锚点。",
      ],
    };
    const filename = `AetherPlay-WOLF-Memory-Neighborhood-${Date.now()}.json`;
    setBusy("正在导出内存邻域差分 JSON…"); setError("");
    try {
      await saveAndroidTextFile(filename, JSON.stringify(payload, null, 2));
      setNotice(`已请求保存邻域快照与差分：${filename}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(""); }
  };

  const runFirstScan = async () => {
    setBusy(scanMode === "unknown" ? "正在创建未知初始值快照…" : "正在分块扫描 WASM 内存…"); setError(""); setNotice("");
    try {
      let response: DebugResponse;
      if (scanMode === "exact") {
        response = await request("scan-first", { scanType, scanValue: readScanValue(), aligned: alignedScan });
      } else {
        const startOffset = readAddressInput(unknownStartText, "起始地址") as number;
        const endOffset = readAddressInput(unknownEndText, "结束地址", true);
        response = await request("scan-unknown-first", { scanType, aligned: alignedScan, scanStartOffset: startOffset, scanEndOffset: endOffset });
      }
      applyScanResponse(response);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(""); }
  };
  const loadScanPage = async (page: number) => {
    if (!scanSummary || page < 0 || page >= scanSummary.pageCount || page === scanSummary.page) return;
    setBusy("正在读取扫描结果页…"); setError("");
    try {
      const response = await request("scan-page", { page });
      if (!response.scan) throw new Error("运行时没有返回扫描结果页。");
      setScanSummary(response.scan); setScanResults(response.scan.results || []); setRowValues({});
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(""); }
  };
  const runNextScan = async () => {
    let value: number | undefined, value2: number | undefined;
    if (["equal", "not-equal", "greater", "less", "between"].includes(scanFilter)) {
      try {
        value = readNumericInput(refineValue, "复筛目标值");
        if (scanFilter === "between") value2 = readNumericInput(refineValue2, "范围最大值");
        if (scanFilter === "between" && value > (value2 as number)) throw new Error("范围最小值不能大于最大值。");
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
    }
    setBusy("正在筛选候选地址…"); setError(""); setNotice("");
    try { applyScanResponse(await request("scan-next", { scanFilter, scanValue: value, scanValue2: value2 })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(""); }
  };
  const resetScan = async () => {
    setBusy("正在重置扫描…"); setError("");
    try { await request("scan-reset"); setScanSummary(null); setScanResults([]); setRowValues({}); setNotice("已重置搜索，可以更换类型并开始新的首次扫描。"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(""); }
  };
  const writeMemoryResult = async (result: DebugScanResult) => {
    const type = scanSummary?.scanType; if (!type) return;
    const text = rowValues[result.offset] ?? String(result.value), value = Number(text);
    if (text.trim() === "" || !Number.isFinite(value)) { setError("请输入有效写入值。"); return; }
    setBusy(`正在写入 0x${result.offset.toString(16)}…`); setError(""); setNotice("");
    try {
      const response = await request("memory-write", { scanType: type, offset: result.offset, value }), actual = response.memoryValue ?? value;
      setScanResults((old) => old.map((item) => item.offset === result.offset ? { ...item, value: actual } : item));
      setRowValues((old) => ({ ...old, [result.offset]: String(actual) }));
      setFrozenResults((old) => old.map((item) => item.offset === result.offset && item.type === type ? { ...item, value: actual } : item));
      setNotice(`已写入 0x${result.offset.toString(16)} = ${actual}。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(""); }
  };
  const toggleFreeze = async (result: DebugScanResult) => {
    const type = scanSummary?.scanType; if (!type) return;
    const key = `${type}:${result.offset}`, existing = frozenResults.find((item) => item.key === key);
    setBusy(existing ? "正在解除数值锁定…" : "正在锁定数值…"); setError(""); setNotice("");
    try {
      if (existing) {
        await request("freeze-remove", { scanType: type, offset: result.offset }); setFrozenResults((old) => old.filter((item) => item.key !== key)); setNotice("已解除该地址的数值锁定。");
      } else {
        const text = rowValues[result.offset] ?? String(result.value), value = Number(text);
        if (text.trim() === "" || !Number.isFinite(value)) throw new Error("请输入有效的锁定值。");
        await request("freeze-add", { scanType: type, offset: result.offset, value });
        setFrozenResults((old) => [...old.filter((item) => item.key !== key), { key, type, offset: result.offset, value }]);
        setScanResults((old) => old.map((item) => item.offset === result.offset ? { ...item, value } : item));
        setRowValues((old) => ({ ...old, [result.offset]: String(value) })); setNotice(`已锁定 0x${result.offset.toString(16)} = ${value}。`);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(""); }
  };
  const removeFreeze = async (item: DebugFreezeEntry) => {
    setBusy("正在解除数值锁定…"); setError("");
    try { await request("freeze-remove", { scanType: item.type, offset: item.offset }); setFrozenResults((old) => old.filter((entry) => entry.key !== item.key)); setNotice(`已解除 0x${item.offset.toString(16)} 的锁定。`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(""); }
  };
  const clearFreezes = async () => {
    setBusy("正在解除所有数值锁定…"); setError("");
    try { await request("freeze-clear"); setFrozenResults([]); setNotice("已解除全部数值锁定。"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(""); }
  };

  const loadRuntimeIntrospection = async () => {
    setBusy("正在检查 WOLF/WASM 运行时接口…"); setError(""); setNotice("");
    try {
      const response = await request("runtime-introspect");
      if (!response.runtimeIntrospection) throw new Error("运行时没有返回接口探针数据。");
      setRuntimeIntrospection(response.runtimeIntrospection);
      const count = response.runtimeIntrospection.variableApiCandidates.length;
      setNotice(count
        ? `接口探针完成：发现 ${count} 个名称疑似与变量访问有关的函数，仍需验证其语义。`
        : "接口探针完成：未见直接变量 API，已保存 WASM 导出信息供进一步逆向。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(""); }
  };

  const exportRuntimeIntrospection = async () => {
    if (!runtimeIntrospection) return;
    const exportedAt = new Date().toISOString();
    const safeTitle = gameTitle.trim()
      .replace(/[\\\/:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 48) || "WOLF";
    const timestamp = exportedAt.replace(/[:.]/g, "-");
    const filename = `AetherPlay-${safeTitle}-runtime-introspection-${timestamp}.json`;
    const payload = {
      format: "aetherplay-wolf-runtime-introspection",
      schemaVersion: 1,
      exportedAt,
      game: { id: gameId, title: gameTitle },
      runtimeCapabilities: capabilities,
      runtimeIntrospection,
    };
    const content = `${JSON.stringify(payload, null, 2)}\n`;

    setBusy("正在导出探针 JSON 文件…");
    setError("");
    setNotice("");
    try {
      if (Capacitor.getPlatform() === "android") {
        // Uses Android's system document picker; no clipboard or WebView download support needed.
        await saveAndroidTextFile(filename, content);
      } else {
        const blob = new Blob([content], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
      setNotice(`已导出完整探针 JSON：${filename}。请把保存的 JSON 文件发回聊天分析。`);
    } catch (cause) {
      setError(cause instanceof Error ? `导出 JSON 失败：${cause.message}` : `导出 JSON 失败：${String(cause)}`);
    } finally {
      setBusy("");
    }
  };

  const exportWasmBinary = async () => {
    setBusy("正在导出 Woditor WASM 二进制…");
    setError("");
    setNotice("");
    try {
      const response = await request("wasm-binary-export");
      const bytes = response.wasmBinary;
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
        throw new Error(response.wasmBinaryCaptureStatus || "运行时没有返回 WASM 二进制。请完全退出并重新启动游戏后重试。");
      }

      // Encode in chunks divisible by 3 so independently encoded base64 chunks concatenate safely.
      const encodedChunks: string[] = [];
      const chunkSize = 24 * 1024;
      for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
        const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength));
        encodedChunks.push(btoa(String.fromCharCode(...chunk)));
      }
      const base64 = encodedChunks.join("");
      const safeTitle = gameTitle.trim()
        .replace(/[\\\/:*?"<>|\u0000-\u001f]/g, "_")
        .replace(/\s+/g, "_")
        .slice(0, 48) || "WOLF";
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `AetherPlay-${safeTitle}-woditor-${bytes.byteLength}B-${timestamp}.wasm.b64.txt`;

      if (Capacitor.getPlatform() === "android") {
        await saveAndroidTextFile(filename, base64);
      } else {
        const blob = new Blob([base64], { type: "text/plain;charset=us-ascii" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
      setNotice(`已导出 WASM Base64：${filename}（原始 ${bytes.byteLength.toLocaleString()} 字节）。把文件发回聊天，或在 Termux 用 base64 -d 解码。`);
    } catch (cause) {
      setError(cause instanceof Error ? `导出 WASM 失败：${cause.message}` : `导出 WASM 失败：${String(cause)}`);
    } finally {
      setBusy("");
    }
  };

  const applyWolfDetectedBase = async (candidate: DebugWolfVariableBaseCandidate) => {
    let count: number;
    try {
      count = Number(wolfVariableCountText.trim());
      if (!Number.isSafeInteger(count) || count < 1 || count > 256) throw new Error("读取数量必须是 1 至 256 的整数。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    const baseText = `0x${candidate.base.toString(16).toUpperCase().padStart(8, "0")}`;
    setWolfVariableBaseText(baseText);
    setWolfVariableRange(null);
    setBusy("已找到变量基址，正在立即复读变量范围…"); setError(""); setNotice("");
    try {
      const response = await request("wolf-variable-range-read", { variableBase: candidate.base, variableCount: count });
      if (!response.wolfVariables) throw new Error("运行时没有返回基址复核结果。");
      const anchors = new Map(response.wolfVariables.rows.map((row) => [row.id, row.value] as [number, number]));
      if (anchors.get(16) !== candidate.values.v16 || anchors.get(17) !== candidate.values.v17 || anchors.get(18) !== candidate.values.v18 || anchors.get(19) !== candidate.values.v19) {
        throw new Error("候选基址复读时 V16–V19 与扫描签名不一致；可能发生了游戏状态变化。未将本次读取标记为有效，请重新定位。");
      }
      setWolfVariableRange(response.wolfVariables);
      setNotice(`基址定位并复核成功：${baseText}；V16=${candidate.values.v16}、V17=${candidate.values.v17}、V18=${candidate.values.v18}、V19=${candidate.values.v19}。当前实例已读取 ${count} 项。`);
    } catch (cause) {
      setWolfVariableRange(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(""); }
  };

  const startWolfVariableWatch = async () => {
    if (!wolfVariableRange || wolfVariableRange.count !== 65) {
      setError("请先自动定位并复读验证完整的 V0–V64 变量表。"); return;
    }
    setBusy("正在开始变量追踪…"); setError(""); setNotice(""); setWolfVariableChanges(null); setWolfVariableWatchDurationMs(null);
    try {
      const response = await request("wolf-variable-watch-start", {
        variableBase: wolfVariableRange.base, variableCount: wolfVariableRange.count,
      });
      const watch = response.wolfVariableWatch;
      if (!watch?.startedAt) throw new Error("运行时没有返回追踪开始时间。");
      setWolfVariableWatchStartedAt(watch.startedAt);
      setNotice("变量追踪已开始。回到游戏做一件可观察的事（打怪、买东西、移动、使用道具等），完成后点「结束追踪」。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(""); }
  };

  const stopWolfVariableWatch = async () => {
    if (!wolfVariableWatchStartedAt) return;
    setBusy("正在结束追踪并对比…"); setError(""); setNotice("");
    try {
      const response = await request("wolf-variable-watch-stop", {});
      const watch = response.wolfVariableWatch;
      if (!watch || !watch.changes) throw new Error("运行时没有返回追踪结果。");
      setWolfVariableWatchStartedAt(null);
      setWolfVariableChanges(watch.changes);
      setWolfVariableWatchDurationMs(watch.durationMs ?? 0);
      setNotice(`追踪结束：${watch.totalChanges ?? watch.changes.length} 个变量在 ${((watch.durationMs ?? 0) / 1000).toFixed(1)} 秒内发生变化。可以给每个变化的变量输入名称进行标注，保存在本机。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(""); }
  };


  const detectWolfVariableBase = async () => {
    setError(""); setNotice(""); setWolfVariableBaseDetection(null);
    const parseInt32 = (raw: string, label: string): number => {
      if (raw.trim() === "") throw new Error(`${label}不能为空。`);
      const value = Number(raw.trim());
      if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new Error(`${label}必须是有效的 Int32 整数。`);
      return value;
    };
    let anchorValue: number, v16Value: number, v18Value: number, v19Value: number;
    try {
      anchorValue = parseInt32(wolfV17AnchorValueText, "当前 V17 / 游戏内所持金");
      v16Value = parseInt32(wolfV16SignatureText, "V16 特征值");
      v18Value = parseInt32(wolfV18SignatureText, "V18 特征值");
      v19Value = parseInt32(wolfV19SignatureText, "V19 特征值");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    setBusy("正在只读扫描当前 WASM 内存，搜索 V16–V19 特征…");
    try {
      const response = await request("wolf-variable-base-detect", { anchorValue, v16Value, v18Value, v19Value });
      const detection = response.wolfVariableBaseDetection;
      if (!detection) throw new Error("运行时没有返回变量基址搜索结果。");
      setWolfVariableBaseDetection(detection);
      const onlyCandidate = detection.candidates[0];
      if (detection.candidateCount === 1 && detection.candidates.length === 1 && onlyCandidate) {
        await applyWolfDetectedBase(onlyCandidate);
      } else if (detection.candidateCount === 0) {
        setNotice("没有匹配的 V16–V19 特征。请确认输入的是当前游戏显示的金钱，且 V16/V18/V19 特征值与当前游戏状态一致；没有自动选择任何地址。");
      } else {
        setNotice(`发现 ${detection.candidateCount} 个匹配候选。为避免误选，未自动采用；请根据候选的地址与特征值选择一个，再复读校验。`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(""); }
  };

  const applyDetectedSysVariableBase = async (
    candidate: DebugSysVariableCandidate,
    startIndex: number,
    signatureValues: number[],
    count: number,
  ) => {
    setBusy("已发现 Sys 候选基址，正在回读并验证特征…"); setError(""); setNotice("");
    try {
      const response = await request("sys-variable-range-read", { sysVariableBase: candidate.base, sysVariableCount: count });
      const range = response.sysVariables;
      if (!range) throw new Error("运行时没有返回 Sys 变量范围读取结果。");
      for (let i = 0; i < signatureValues.length; i += 1) {
        if (range.rows[startIndex + i]?.value !== signatureValues[i]) {
          throw new Error(`Sys 候选复读失败：Sys${startIndex + i} 与扫描时的值不一致。游戏状态可能已改变；未采用此基址，请重新定位。`);
        }
      }
      setSysVariableRange(range);
      setNotice(`Sys 基址只读定位并复读成功：0x${range.base.toString(16).toUpperCase().padStart(8, "0")}；已读取 ${range.count} 项，${signatureValues.length} 个连续特征全部匹配。此结果尚不开放写入。`);
    } catch (cause) {
      setSysVariableRange(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(""); }
  };

  const detectSysVariableBase = async () => {
    setError(""); setNotice(""); setSysVariableRange(null); setSysVariableBaseDetection(null);
    const parseInteger = (raw: string, label: string, minimum: number, maximum: number) => {
      if (raw.trim() === "") throw new Error(`${label}不能为空。`);
      const value = Number(raw.trim());
      if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label}必须是 ${minimum} 至 ${maximum} 之间的整数。`);
      return value;
    };
    let startIndex: number, count: number, signatureValues: number[];
    try {
      startIndex = parseInteger(sysVariableStartIndexText, "Sys 起始编号", 0, 255);
      count = parseInteger(sysVariableCountText, "Sys 变量数量", 1, 256);
      if (sysSignatureTexts.length < 4 || sysSignatureTexts.length > 8) throw new Error("请提供 4 至 8 个连续 Sys 变量的特征值。");
      signatureValues = sysSignatureTexts.map((raw, index) => parseInteger(raw, `Sys${startIndex + index} 当前值`, -2147483648, 2147483647));
      if (startIndex + signatureValues.length > count) throw new Error("特征值数量超出 Sys 变量数量。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause)); return;
    }
    setBusy("正在只读扫描当前 WASM 内存，搜索连续 Sys 特征…");
    try {
      const response = await request("sys-variable-base-detect", { sysStartIndex: startIndex, sysVariableCount: count, sysSignatureValues: signatureValues });
      const detection = response.sysVariableBaseDetection;
      if (!detection) throw new Error("运行时没有返回 Sys 基址定位结果。");
      setSysVariableBaseDetection(detection);
      if (detection.candidateCount === 1 && detection.candidates.length === 1 && !detection.truncated) {
        await applyDetectedSysVariableBase(detection.candidates[0], startIndex, signatureValues, count);
      } else if (detection.candidateCount === 0) {
        setNotice("没有找到匹配的 Sys 连续特征。请确认起始编号和四个连续变量的当前值；可用变量目录核对名称，并用“定位试验”确认某个 Sys 变量的真实值后重试。没有修改内存。");
      } else {
        setNotice(`发现 ${detection.candidateCount} 个 Sys 候选基址。为避免误选，未自动采用；请逐个选择并复读特征。扫描只读，不会写入。`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(""); }
  };

  const readWolfVariableRange = async () => {
    setError(""); setNotice("");
    let base: number;
    let count: number;
    try {
      base = readAddressInput(wolfVariableBaseText, "WOLF 变量表候选基址") as number;
      count = Number(wolfVariableCountText.trim());
      if (!Number.isSafeInteger(base) || base % 4 !== 0 || base > 0xffffffff) {
        throw new Error("候选基址必须是 4 字节对齐的 WASM32 地址。");
      }
      if (!Number.isSafeInteger(count) || count < 1 || count > 256) {
        throw new Error("读取数量必须是 1 至 256 的整数；验证 V0–V64 时请输入 65。");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    setBusy("正在只读检查 WOLF 变量表候选范围…");
    try {
      const response = await request("wolf-variable-range-read", { variableBase: base, variableCount: count });
      if (!response.wolfVariables) throw new Error("运行时没有返回 WOLF 变量读取结果。");
      setWolfVariableRange(response.wolfVariables);
      const anchorText = response.wolfVariables.rows
        .filter((row) => row.id >= 16 && row.id <= 19)
        .map((row) => `V${row.id}=${row.value}`)
        .join("，");
      setNotice(`只读完成：${response.wolfVariables.count} 个 Int32 槽位；${anchorText || "范围未包含 V16–V19"}。请对照游戏内实际变量核实；这不会自动证明所有 V 编号都采用此布局。`);
    } catch (cause) {
      setWolfVariableRange(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  };

  // AETHER_WOLF_VARIABLE_WRITE_V1: guarded one-row write plus delayed overwrite detection.
  const writeWolfVariable = async (row: DebugWolfVariableRange["rows"][number]) => {
    if (!wolfVariableRange || wolfVariableRange.count !== 65 || row.id < 0 || row.id > 64) {
      setError("请先自动定位并复读验证完整的 V0–V64 变量表。");
      return;
    }
    const candidateExists = Boolean(wolfVariableBaseDetection?.candidates.some((candidate) => candidate.base === wolfVariableRange.base));
    if (!candidateExists) {
      setError("当前变量表没有对应本次自动定位的候选基址。请重新自动定位并复读变量表后再写入。");
      return;
    }
    const raw = (wolfVariableEditValues[row.id] ?? "").trim();
    if (!raw) { setError(`请先输入 V${row.id} 的新 Int32 值。`); return; }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
      setError("新值必须是 -2147483648 至 2147483647 之间的 Int32 整数。");
      return;
    }
    const label = WOLF_RUNTIME_VARIABLE_LABELS[row.id] ? ` · ${WOLF_RUNTIME_VARIABLE_LABELS[row.id]}` : "";
    const expectedValue = row.value;
    if (!window.confirm(`单变量写入确认\n\nV${row.id}${label}\n地址：0x${row.address.toString(16).toUpperCase().padStart(8, "0")}\n预期旧值：${expectedValue}\n新值：${value}\n\n运行时会再次核对旧值，立即回读，并在 500ms 后复查。只写这一项，不批量修改。继续吗？`)) return;
    setBusy(`正在校验并写入 V${row.id}…`); setError(""); setNotice("");
    try {
      const response = await request("wolf-variable-write", {
        variableBase: wolfVariableRange.base,
        variableCount: wolfVariableRange.count,
        variableId: row.id,
        expectedValue,
        value,
      });
      const writeResult = response.wolfVariableWrite;
      if (!writeResult) throw new Error("运行时没有返回写入校验结果。");
      if (writeResult.variableId !== row.id || writeResult.address !== row.address || writeResult.immediateValue !== value) {
        throw new Error("写入回执与请求不一致；请重新读取变量表检查当前值。");
      }
      setWolfVariableRange((current) => current ? {
        ...current,
        memoryBytes: writeResult.memoryBytes,
        rows: current.rows.map((item) => item.id === row.id ? { ...item, value: writeResult.immediateValue } : item),
      } : current);
      setWolfVariableEditValues((current) => ({ ...current, [row.id]: "" }));
      setNotice(`V${row.id} 写入后立即回读成功：${expectedValue} → ${writeResult.immediateValue}。正在 500ms 后复查是否被游戏逻辑覆盖…`);
      setBusy(`V${row.id} 已立即验证，正在延迟复查…`);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
      try {
        const refreshed = await request("wolf-variable-range-read", { variableBase: writeResult.base, variableCount: wolfVariableRange.count });
        if (!refreshed.wolfVariables) throw new Error("延迟复查没有返回变量表。");
        setWolfVariableRange(refreshed.wolfVariables);
        const delayedValue = refreshed.wolfVariables.rows.find((item) => item.id === row.id)?.value;
        if (delayedValue === undefined) throw new Error("延迟复查结果缺少目标变量。");
        if (delayedValue === value) {
          setNotice(`写入验证通过：V${row.id} 立即回读=${writeResult.immediateValue}，500ms 后=${delayedValue}；未观察到游戏覆盖。原对比基线已保留。`);
        } else {
          setNotice(`写入操作立即回读成功，但游戏在 500ms 内改变/覆盖了 V${row.id}：请求=${value}，延迟复查=${delayedValue}。当前快照已更新，原对比基线保留。`);
        }
      } catch (cause) {
        setError(`V${row.id} 写入后立即回读成功（${writeResult.immediateValue}），但延迟复查失败：${cause instanceof Error ? cause.message : String(cause)}。请重新读取变量表确认最终值。`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(""); }
  };

  const captureWolfVariableBaseline = () => {
    if (!wolfVariableRange) return;
    setWolfVariableBaseline({ gameId, range: wolfVariableRange, capturedAt: new Date().toISOString() });
    setNotice(`已保存对比基线：${wolfVariableRange.count} 项。请保持同一游戏运行实例，回到游戏中正常改变所持金等变量，再点击“读取 V0–V64”比较变化。`);
    setError("");
  };

  const clearWolfVariableBaseline = () => {
    setWolfVariableBaseline(null);
    setNotice("已清除变量对比基线。重新读取后可重新设定基线。");
  };

  const exportWolfVariableRange = async () => {
    if (!wolfVariableRange) return;
    setBusy("正在导出 WOLF 变量表 JSON…"); setError("");
    try {
      const baselineMatches = Boolean(wolfVariableRange && wolfVariableBaseline && wolfVariableBaseline.gameId === gameId && wolfVariableBaseline.range.base === wolfVariableRange.base && wolfVariableBaseline.range.count === wolfVariableRange.count && wolfVariableBaseline.range.rows.length === wolfVariableRange.rows.length);
      const baselineById = new Map<number, number>((baselineMatches ? wolfVariableBaseline!.range.rows : []).map((row) => [row.id, row.value] as [number, number]));
      const differences = baselineMatches ? wolfVariableRange.rows.flatMap((row) => { const before = baselineById.get(row.id); return before !== undefined && before !== row.value ? [{ id: row.id, address: row.address, before, after: row.value, delta: row.value - before }] : []; }) : null;
      const report = {
        format: "aetherplay-wolf-runtime-variable-range",
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        game: { id: gameId, title: gameTitle },
        readOnly: true,
        addressModel: "candidate base + variable id * 4, little-endian Int32",
        base: wolfVariableRange.base,
        baseHex: `0x${wolfVariableRange.base.toString(16).toUpperCase().padStart(8, "0")}`,
        count: wolfVariableRange.count,
        memoryBytes: wolfVariableRange.memoryBytes,
        rows: wolfVariableRange.rows.map((row) => ({
          ...row,
          addressHex: `0x${row.address.toString(16).toUpperCase().padStart(8, "0")}`,
          knownLabel: getWolfLabel(row.id) || null,
          knownLabelSource: wolfUserLabels[row.id] ? "user" : (projectVariableNames[row.id] ? "project" : (WOLF_RUNTIME_VARIABLE_LABELS[row.id] ? "builtin" : null)),
          baselineValue: baselineMatches ? baselineById.get(row.id) ?? null : null,
          changedSinceBaseline: baselineMatches ? baselineById.get(row.id) !== row.value : null,
        })),
        comparison: { available: baselineMatches, baselineCapturedAt: baselineMatches ? wolfVariableBaseline!.capturedAt : null, changedCount: differences?.length ?? null, differences },
        notes: [
          "此报告来自用户输入的当前实例候选基址；工具只读，不修改任何变量。",
          "基址 0x03CECBC8 是由已知 V17 地址反推的候选值，不保证跨游戏或重新载入后保持不变。",
          "每项按 4 字节小端 Int32 解读；需要与游戏内变量值交叉核对后才能确认布局。",
          "userLabels 下的名称是本机通过变化追踪标注，不构成引擎层官方命名；跨设备/重装需重新标注。",
          "快照差异仅在同一游戏运行实例、相同基址和相同数量下比较；重载/重启游戏后请清除并重新采集基线。",
        ],
      };
      const filename = `AetherPlay-WOLF-Variables-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      await saveAndroidTextFile(filename, JSON.stringify(report, null, 2));
      setNotice(`已请求导出 ${filename}。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  };

  const loadVariableCatalog = async () => {
    setBusy("正在读取 WOLF 变量元数据…"); setError(""); setNotice("");
    try {
      const response = await request("variable-catalog");
      if (!response.variableCatalog) throw new Error("运行时没有返回 WOLF 变量目录。");
      setVariableCatalog(response.variableCatalog);
      const sysNumericGroup = response.variableCatalog.groups.find((group) => group.id === "system-number");
      if (sysNumericGroup?.count) setSysVariableCountText(String(sysNumericGroup.count));
      setNotice(`变量目录已读取：${response.variableCatalog.totalVariables.toLocaleString()} 个目录项，${response.variableCatalog.groups.length} 个类别。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(""); }
  };

  const startVariableProbe = async (target: WolfVariableProbeTarget) => {
    setError("");
    setNotice("");

    if (!capabilities?.memoryAvailable || capabilities.heapBytes <= 0) {
      setError("当前没有可扫描的 WASM 内存，请先刷新运行时探测。");
      return;
    }

    // 先扫描 64 MiB，控制 Android WebView 的额外内存开销。
    // 如果没有找到候选，下一轮再扩大扫描范围。
    let endOffset = Math.min(
      Math.floor(capabilities.heapBytes),
      64 * 1024 * 1024,
    );
    endOffset -= endOffset % 4;

    if (endOffset < 4) {
      setError("可扫描的内存范围太小。");
      return;
    }

    setBusy(`正在为 ${target.id} 创建基线快照…`);

    try {
      await request("scan-reset");

      const response = await request("scan-unknown-first", {
        scanType: "i32",
        aligned: true,
        scanStartOffset: 0,
        scanEndOffset: endOffset,
      });

      if (!response.scan) {
        throw new Error("运行时没有返回变量定位快照。");
      }

      setVariableProbeTarget(target);
      setScanMode("unknown");
      setScanType("i32");
      setScanSummary(response.scan);
      setScanResults(response.scan.results || []);
      setRowValues({});

      setNotice(
        `${target.id} 基线快照已保存，范围 0x00000000–0x${endOffset.toString(16).toUpperCase()}。现在回到游戏执行能改变该变量的操作。`
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  };

  const filterVariableChanges = async () => {
    if (!variableProbeTarget || !scanSummary) {
      setError("请先选择一个数值变量并创建基线快照。");
      return;
    }

    setBusy("正在筛选变量变化位置…");
    setError("");
    setNotice("");

    try {
      const response = await request("scan-next", {
        scanFilter: "changed",
      });

      if (!response.scan) {
        throw new Error("运行时没有返回变化筛选结果。");
      }

      applyScanResponse(response);

      setNotice(
        `${variableProbeTarget.id} 变化筛选完成：${response.scan.count.toLocaleString()} 个候选位置。可以继续改变变量，再重复筛选。`
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  };

  const matchVariableCurrentValue = async (raw: string) => {
    if (!variableProbeTarget || !scanSummary) {
      setError("请先开始变量定位实验。");
      return;
    }
    if (scanSummary.unknownBaselinePending) {
      setError("请先回到游戏改变变量，再点击“筛选本次变化”。");
      return;
    }

    const value = Number(raw.trim());

    if (
      raw.trim() === "" ||
      !Number.isSafeInteger(value) ||
      value < -2147483648 ||
      value > 2147483647
    ) {
      setError("请输入该变量当前实际的 Int32 数值。");
      return;
    }

    setBusy(`正在用 ${value} 筛选候选位置…`);
    setError("");
    setNotice("");

    try {
      const response = await request("scan-next", {
        scanFilter: "equal",
        scanValue: value,
      });

      if (!response.scan) {
        throw new Error("运行时没有返回数值筛选结果。");
      }

      applyScanResponse(response);
      setNotice(
        `${variableProbeTarget.id} 数值筛选完成：剩余 ${response.scan.count.toLocaleString()} 个候选位置。`
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  };

  const exportVariableProbePage = async () => {
    if (!variableProbeTarget || !scanSummary) {
      setError("没有可导出的变量定位结果。");
      return;
    }

    const report = {
      format: "aetherplay-wolf-variable-storage-probe",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      game: { id: gameId, title: gameTitle },
      variable: variableProbeTarget,
      scan: {
        ...scanSummary,
        // 这里只导出当前结果页；可翻页逐页保存。
        results: scanResults,
      },
      notes: [
        "这些地址是候选，不代表已经证明它们存储该变量。",
        "后续需要比较不同变量编号的候选地址关系。",
        `本次快照实际覆盖 0x${scanSummary.scanStartOffset.toString(16).toUpperCase().padStart(8, "0")}–0x${scanSummary.scanEndOffset.toString(16).toUpperCase().padStart(8, "0")}（结束地址不包含在内），共扫描 ${formatBytes(scanSummary.scannedBytes)}。`,
      ],
    };

    const safeId = variableProbeTarget.id.replace(/[^a-z0-9_-]/giu, "_");
    const filename = `AetherPlay-WOLF-Variable-Probe-${safeId}-${Date.now()}.json`;

    setBusy("正在导出变量定位结果…");
    setError("");

    try {
      await saveAndroidTextFile(filename, JSON.stringify(report, null, 2));
      setNotice(`已请求保存变量定位报告：${filename}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  };

  const neighborhoodBaselineMatches = Boolean(
    neighborhoodBaseline && neighborhoodSnapshot &&
    neighborhoodBaseline.anchorOffset === neighborhoodSnapshot.anchorOffset &&
    neighborhoodBaseline.radiusBytes === neighborhoodSnapshot.radiusBytes,
  );
  const neighborhoodChanges = neighborhoodBaselineMatches
    ? neighborhoodSnapshot!.words.filter((word) => neighborhoodBaseline!.words.find((prior) => prior.offset === word.offset)?.hex !== word.hex)
    : [];

  const wolfVariableBaselineMatches = Boolean(wolfVariableRange && wolfVariableBaseline && wolfVariableBaseline.gameId === gameId && wolfVariableBaseline.range.base === wolfVariableRange.base && wolfVariableBaseline.range.count === wolfVariableRange.count && wolfVariableBaseline.range.rows.length === wolfVariableRange.rows.length);
  const wolfVariableBaselineValues = new Map<number, number>((wolfVariableBaselineMatches ? wolfVariableBaseline!.range.rows : []).map((row) => [row.id, row.value] as [number, number]));
  const wolfVariableChanges = wolfVariableBaselineMatches && wolfVariableRange ? wolfVariableRange.rows.filter((row) => wolfVariableBaselineValues.get(row.id) !== row.value) : [];

  const tabButton = (value: DebugTab, label: string) => (
    <button key={value} type="button" onClick={() => { setTab(value); setError(""); }}
      style={{ ...buttonStyle, flex: 1, background: tab === value ? "#28528a" : "#182335", borderColor: tab === value ? "#5e9ce9" : "#354258" }}>
      {label}
    </button>
  );
  const infoRow = (label: string, value: string) => (
    <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: "1px solid #202b3a" }}>
      <span style={subtleStyle}>{label}</span><span style={{ fontSize: 13, textAlign: "right", overflowWrap: "anywhere" }}>{value}</span>
    </div>
  );

  return (
    <div style={{ ...panelStyle, display: visible ? "flex" : "none" }} role="dialog" aria-modal={visible} aria-hidden={!visible} aria-label="游戏调试台">
      <header style={{ padding: "max(14px, env(safe-area-inset-top, 0px)) 14px 12px", background: "#111a27", borderBottom: "1px solid #263449" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 750 }}>游戏调试台</div>
            <div style={{ ...subtleStyle, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 3 }}>{gameTitle} · {capabilities?.engine || "等待运行时探测"}</div>
          </div>
          <button type="button" onClick={onClose} style={buttonStyle} aria-label="返回游戏并保留搜索">返回游戏 ↩</button>
        </div>
        <nav style={{ display: "flex", gap: 8, marginTop: 13 }}>
          {tabButton("overview", "概览")}{tabButton("files", "虚拟文件")}{tabButton("variables", "变量表")}{tabButton("memory", "内存修改")}
        </nav>
      </header>

      <main style={{ flex: 1, overflow: "auto", padding: 14, paddingBottom: "max(18px, env(safe-area-inset-bottom, 0px))" }}>
        {busy ? <div style={{ ...subtleStyle, padding: "6px 0 12px" }}>{busy}</div> : null}
        {error ? <div role="alert" style={{ marginBottom: 12, padding: 11, borderRadius: 10, background: "#3a1c25", color: "#ffd4dc", fontSize: 13, whiteSpace: "pre-wrap" }}>{error}</div> : null}
        {notice ? <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: "#122d28", color: "#b8f3da", fontSize: 12, overflowWrap: "anywhere" }}>{notice}</div> : null}

        {tab === "overview" ? (
          <section style={{ background: "#111a27", border: "1px solid #253247", borderRadius: 14, padding: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>运行时连接</div>
            <div style={subtleStyle}>此版本支持 WOLF 运行时探测、虚拟文件备份编辑，以及 WASM 数值扫描、复筛、写入和锁定。</div>
            <div style={{ marginTop: 12 }}>
              {infoRow("运行时", capabilities?.moduleAvailable ? "已找到模块" : "尚未确认")}
              {infoRow("虚拟文件系统", capabilities?.filesystemAvailable ? "可访问" : "未开放或尚未就绪")}
              {infoRow("Wasm 内存", capabilities?.memoryAvailable ? "检测到可访问内存" : "尚未检测到可访问内存")}
              {infoRow("内存大小", capabilities?.heapBytes ? formatBytes(capabilities.heapBytes) : "未知")}
            </div>
            <button type="button" style={{ ...buttonStyle, marginTop: 14, width: "100%" }} onClick={() => {
              setError(""); setNotice("");
              void request("probe").then((response) => { setCapabilities(response.capabilities ?? null); setNotice("运行时能力已刷新。"); })
                .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
            }}>重新探测</button>
            <button type="button" style={{ ...buttonStyle, marginTop: 8, width: "100%" }} disabled={Boolean(busy)}
              onClick={() => void loadRuntimeIntrospection()}>
              {busy.includes("运行时接口") ? "检查中…" : "检查实时变量访问接口"}
            </button>
            {runtimeIntrospection ? (
              <div style={{ marginTop: 12 }}>
                <div style={{ ...subtleStyle, lineHeight: 1.6, marginBottom: 8 }}>
                  探针结果已就绪。此操作只导出诊断数据，不会修改游戏内存；点击后通过 Android 系统保存窗口生成完整 JSON 文件，无需长按或复制文本。
                </div>
                <button type="button" style={{ ...buttonStyle, width: "100%" }}
                  disabled={Boolean(busy)} onClick={() => void exportRuntimeIntrospection()}>
                  {busy.includes("导出探针 JSON 文件") ? "正在导出…" : "导出探针 JSON 文件"}
                </button>
                <button type="button" style={{ ...buttonStyle, width: "100%", marginTop: 8 }}
                  disabled={Boolean(busy)} onClick={() => void exportWasmBinary()}>
                  {busy.includes("导出 Woditor WASM") ? "正在导出 WASM…" : "导出 Woditor WASM 二进制（静态分析）"}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {tab === "variables" ? (
          <>
            <section style={{ background: "#111a27", border: "1px solid #354258", borderRadius: 14, padding: 14, marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 750 }}>Sys 系统数值变量：动态基址定位（只读）</div>
              <div style={{ ...subtleStyle, marginTop: 6, lineHeight: 1.6 }}>
                此阶段只验证 Sys 数值表是否为连续的小端 Int32 区域，不开放写入。先点击下方“读取游戏变量表”，从“系统变量 Sys”组确认连续编号及名称；再填写这几个 Sys 变量在当前游戏里的实际整数值。只有候选被重新读取且所有特征都匹配，才显示已验证范围。
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 8, marginTop: 10 }}>
                <label style={{ ...subtleStyle, display: "flex", flexDirection: "column", gap: 5 }}>特征起始编号
                  <input value={sysVariableStartIndexText} inputMode="numeric" onChange={(event) => { setSysVariableStartIndexText(event.target.value); setSysVariableBaseDetection(null); setSysVariableRange(null); }} style={inputStyle} />
                </label>
                <label style={{ ...subtleStyle, display: "flex", flexDirection: "column", gap: 5 }}>Sys 总数量（优先取目录）
                  <input value={sysVariableCountText} inputMode="numeric" onChange={(event) => { setSysVariableCountText(event.target.value); setSysVariableBaseDetection(null); setSysVariableRange(null); }} style={inputStyle} />
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: 10 }}>
                {sysSignatureTexts.map((value, index) => {
                  const start = Number(sysVariableStartIndexText);
                  const id = Number.isSafeInteger(start) && start >= 0 ? start + index : index;
                  const entry = variableCatalog?.groups.find((group) => group.id === "system-number")?.variables[id];
                  return <label key={index} style={{ ...subtleStyle, display: "flex", flexDirection: "column", gap: 5 }}>
                    {`Sys${id}${entry?.name ? ` · ${entry.name}` : ""} 当前值`}
                    <input value={value} inputMode="decimal" onChange={(event) => { setSysSignatureTexts((old) => old.map((item, i) => i === index ? event.target.value : item)); setSysVariableBaseDetection(null); setSysVariableRange(null); }} placeholder="游戏中已确认的 Int32" style={inputStyle} />
                  </label>;
                })}
              </div>
              <button type="button" disabled={Boolean(busy) || !capabilities?.memoryAvailable} onClick={() => void detectSysVariableBase()} style={{ ...buttonStyle, width: "100%", marginTop: 10, background: "#204b40", borderColor: "#397c66" }}>
                {busy.includes("连续 Sys 特征") ? "扫描中…" : "扫描并定位 Sys 基址"}
              </button>
              {sysVariableBaseDetection ? <div style={{ ...subtleStyle, marginTop: 9, lineHeight: 1.6 }}>扫描 {formatBytes(sysVariableBaseDetection.scannedBytes)} / {formatBytes(sysVariableBaseDetection.memoryBytes)} · 候选 {sysVariableBaseDetection.candidateCount}{sysVariableBaseDetection.truncated ? "（结果超过 100，列表截断）" : ""} · 特征值 [{sysVariableBaseDetection.signatureValues.join(", ")}]。</div> : null}
              {sysVariableBaseDetection && sysVariableBaseDetection.candidateCount > 1 ? sysVariableBaseDetection.candidates.map((candidate, index) => (
                <div key={`${candidate.base}:${index}`} style={{ marginTop: 8, padding: 9, border: "1px solid #354258", borderRadius: 8 }}>
                  <div style={{ fontSize: 12 }}>候选 Sys 基址 <code>0x{candidate.base.toString(16).toUpperCase().padStart(8, "0")}</code></div>
                  <div style={{ ...subtleStyle, marginTop: 4 }}>特征起始地址 0x{candidate.signatureAddress.toString(16).toUpperCase().padStart(8, "0")}</div>
                  <button type="button" disabled={Boolean(busy)} onClick={() => void applyDetectedSysVariableBase(candidate, sysVariableBaseDetection.startIndex, sysVariableBaseDetection.signatureValues, sysVariableBaseDetection.variableCount)} style={{ ...buttonStyle, width: "100%", marginTop: 8 }}>采用此候选并复读验证</button>
                </div>
              )) : null}
              {sysVariableRange ? (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>已验证的 Sys 数值范围 · 只读</div>
                  <div style={{ ...subtleStyle, marginTop: 4 }}>基址 0x{sysVariableRange.base.toString(16).toUpperCase().padStart(8, "0")} · {sysVariableRange.count} 项 · 内存 {formatBytes(sysVariableRange.memoryBytes)}</div>
                  <div style={{ marginTop: 8, border: "1px solid #253247", borderRadius: 9, overflow: "hidden" }}>
                    {sysVariableRange.rows.map((row) => {
                      const entry = variableCatalog?.groups.find((group) => group.id === "system-number")?.variables[row.id];
                      return <div key={row.id} style={{ padding: "7px 9px", borderBottom: "1px solid #202b3a", background: "#0f1722" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                          <strong style={{ fontSize: 12 }}>Sys{row.id}{entry?.name ? ` · ${entry.name}` : ""}</strong>
                          <code style={{ fontSize: 10, color: "#9eacc1" }}>0x{row.address.toString(16).toUpperCase().padStart(8, "0")}</code>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, marginTop: 3 }}>{row.value}</div>
                      </div>;
                    })}
                  </div>
                </div>
              ) : null}
            </section>
            <section style={{ background: "#111a27", border: "1px solid #253247", borderRadius: 14, padding: 14, marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>WOLF 运行时变量表（单变量安全写入）</div>
              <div style={{ ...subtleStyle, marginTop: 5, lineHeight: 1.6 }}>
                按候选基址 + V 编号 × 4 读取小端 Int32。只有当前实例的自动定位候选经过范围复读验证后，才允许对 V0–V64 单项写入。写入必须匹配预期旧值，立即回读，并在 500ms 后检查是否被游戏逻辑覆盖；不提供批量写入。
              </div>
              <div style={{ marginTop: 10, padding: 11, border: "1px solid #354258", borderRadius: 10, background: "#0f1722" }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>自动定位变量基址（只读扫描）</div>
                <div style={{ ...subtleStyle, marginTop: 5, lineHeight: 1.55 }}>输入游戏当前显示的所持金，并核对 V16、V18、V19 当前值。工具在当前 WASM 内存中搜索连续签名 [V16, V17, V18, V19]，唯一匹配才自动采用；多个候选需要手动选择。扫描过程不会写入游戏内存。</div>
                <label style={{ ...subtleStyle, display: "flex", flexDirection: "column", gap: 5, marginTop: 9 }}>当前所持金（V17）
                  <input value={wolfV17AnchorValueText} inputMode="numeric" onChange={(event) => setWolfV17AnchorValueText(event.target.value)} placeholder="填写游戏当前显示的金钱，例如 1459" style={inputStyle} />
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 8 }}>
                  <label style={{ ...subtleStyle, display: "flex", flexDirection: "column", gap: 5 }}>V16
                    <input value={wolfV16SignatureText} inputMode="numeric" onChange={(event) => setWolfV16SignatureText(event.target.value)} style={inputStyle} />
                  </label>
                  <label style={{ ...subtleStyle, display: "flex", flexDirection: "column", gap: 5 }}>V18
                    <input value={wolfV18SignatureText} inputMode="numeric" onChange={(event) => setWolfV18SignatureText(event.target.value)} style={inputStyle} />
                  </label>
                  <label style={{ ...subtleStyle, display: "flex", flexDirection: "column", gap: 5 }}>V19
                    <input value={wolfV19SignatureText} inputMode="numeric" onChange={(event) => setWolfV19SignatureText(event.target.value)} style={inputStyle} />
                  </label>
                </div>
                <button type="button" disabled={Boolean(busy) || !capabilities?.memoryAvailable} onClick={() => void detectWolfVariableBase()} style={{ ...buttonStyle, width: "100%", marginTop: 10, background: "#204b40", borderColor: "#397c66" }}>
                  {busy.includes("只读扫描当前 WASM 内存") ? "扫描中…" : "自动定位变量基址"}
                </button>
                {wolfVariableBaseDetection ? <div style={{ ...subtleStyle, marginTop: 8, lineHeight: 1.6 }}>扫描范围 {formatBytes(wolfVariableBaseDetection.scannedBytes)} / 内存 {formatBytes(wolfVariableBaseDetection.memoryBytes)} · 匹配 {wolfVariableBaseDetection.candidateCount} 个候选{wolfVariableBaseDetection.truncated ? "（候选过多，仅显示前 100 个）" : ""}。</div> : null}
                {wolfVariableBaseDetection && wolfVariableBaseDetection.candidateCount > 1 ? wolfVariableBaseDetection.candidates.map((candidate, index) => (
                  <div key={`${candidate.base}:${index}`} style={{ marginTop: 8, padding: 9, border: "1px solid #354258", borderRadius: 8 }}>
                    <div style={{ fontSize: 12, overflowWrap: "anywhere" }}>V0 基址 <code>0x{candidate.base.toString(16).toUpperCase().padStart(8, "0")}</code></div>
                    <div style={{ ...subtleStyle, marginTop: 4 }}>V17 地址 0x{candidate.slotAddress.toString(16).toUpperCase().padStart(8, "0")} · 签名 {candidate.values.v16}, {candidate.values.v17}, {candidate.values.v18}, {candidate.values.v19}</div>
                    <button type="button" disabled={Boolean(busy)} onClick={() => void applyWolfDetectedBase(candidate)} style={{ ...buttonStyle, width: "100%", marginTop: 8 }}>采用此基址并复读验证</button>
                  </div>
                )) : null}
              </div>
              <div style={{ marginTop: 10, padding: 11, border: "1px solid #354258", borderRadius: 10, background: "#0f1722" }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>变量变化追踪（纯读取）</div>
                <div style={{ ...subtleStyle, marginTop: 5, lineHeight: 1.55 }}>
                  在游戏里做一件事之前点「开始追踪」，做完之后点「结束追踪」，工具会自动比对这段时间内哪些 V 变量发生了变化。这是最快的语义识别方式——不用逆向，只要在游戏里正常操作。
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 8, marginTop: 9 }}>
                  <button type="button" disabled={Boolean(busy) || !wolfVariableRange || Boolean(wolfVariableWatchStartedAt)} onClick={() => void startWolfVariableWatch()} style={{ ...buttonStyle, width: "100%", background: "#1f3a52", borderColor: "#3f6389" }}>
                    {wolfVariableWatchStartedAt ? `追踪中（${new Date(wolfVariableWatchStartedAt).toLocaleTimeString()} 起）` : "开始追踪"}
                  </button>
                  <button type="button" disabled={Boolean(busy) || !wolfVariableWatchStartedAt} onClick={() => void stopWolfVariableWatch()} style={{ ...buttonStyle, width: "100%", background: "#204b40", borderColor: "#397c66" }}>结束追踪</button>
                </div>
                {wolfVariableWatchChanges ? (
                  <div style={{ marginTop: 10 }}>
                    {wolfVariableWatchChanges.length === 0 ? (
                      <div style={{ ...subtleStyle }}>
                        {wolfVariableWatchDurationMs !== null ? `追踪 ${(wolfVariableWatchDurationMs / 1000).toFixed(1)} 秒内没有变量发生变化。` : "追踪期间没有变量发生变化。"} 可能是动作太快、变量不在 V0–V64 范围，或游戏内存对象已变化。
                      </div>
                    ) : (
                      <div style={{ border: "1px solid #253247", borderRadius: 9, overflow: "hidden" }}>
                        {wolfVariableWatchChanges.map((change) => (
                          <div key={change.id} style={{ padding: "8px 10px", borderBottom: "1px solid #202b3a", background: "#2a1f14" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                              <strong style={{ color: "#ffd28a" }}>V{change.id}{getWolfLabel(change.id) ? ` · ${getWolfLabel(change.id)}` : ""}</strong>
                              <code style={{ fontSize: 11, color: "#ffd28a" }}>{change.before} → {change.after}（{change.delta > 0 ? "+" : ""}{change.delta}）</code>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 6, marginTop: 6 }}>
                              <input value={wolfLabelDrafts[change.id] ?? ""} placeholder={getWolfLabel(change.id) || "输入名称，例如 玩家HP"} onChange={(event) => setWolfLabelDrafts((old) => ({ ...old, [change.id]: event.target.value }))} style={{ ...inputStyle, padding: "6px 8px" }} />
                              <button type="button" disabled={Boolean(busy)} onClick={() => saveWolfVariableLabel(change.id)} style={{ ...buttonStyle, padding: "6px 10px" }}>保存标注</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 0.8fr)", gap: 8, marginTop: 10 }}>
                <label style={{ ...subtleStyle, display: "flex", flexDirection: "column", gap: 5 }}>V0 候选基址
                  <input value={wolfVariableBaseText} spellCheck={false} onChange={(event) => { setWolfVariableBaseText(event.target.value); setWolfVariableRange(null); }} placeholder="0x03CECBC8" style={inputStyle} />
                </label>
                <label style={{ ...subtleStyle, display: "flex", flexDirection: "column", gap: 5 }}>读取数量
                  <input value={wolfVariableCountText} inputMode="numeric" onChange={(event) => { setWolfVariableCountText(event.target.value); setWolfVariableRange(null); }} placeholder="65" style={inputStyle} />
                </label>
              </div>
              <button type="button" disabled={Boolean(busy) || !capabilities?.memoryAvailable} onClick={() => void readWolfVariableRange()} style={{ ...buttonStyle, width: "100%", marginTop: 10 }}>
                {busy.includes("只读检查 WOLF 变量表") ? "读取中…" : "读取 V0–V64（只读）"}
              </button>
              {wolfVariableRange ? (
                <>
                  <div style={{ ...subtleStyle, marginTop: 10, lineHeight: 1.6 }}>
                    基址 0x{wolfVariableRange.base.toString(16).toUpperCase().padStart(8, "0")} · {wolfVariableRange.count} 项 · 当前 WASM 内存 {formatBytes(wolfVariableRange.memoryBytes)}。V16–V19 是现有已知样本，其余编号仍需对照游戏验证。
                  </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 8, marginTop: 8 }}>
                <button type="button" disabled={Boolean(busy) || !wolfVariableRange} onClick={captureWolfVariableBaseline} style={{ ...buttonStyle, width: "100%", background: "#204b40", borderColor: "#397c66" }}>设为对比基线</button>
                <button type="button" disabled={Boolean(busy) || !wolfVariableBaseline} onClick={clearWolfVariableBaseline} style={{ ...buttonStyle, width: "100%" }}>清除基线</button>
              </div>
              <button type="button" disabled={Boolean(busy) || !wolfVariableRange} onClick={() => void exportWolfVariableRange()} style={{ ...buttonStyle, width: "100%", marginTop: 8 }}>导出读取结果与差异 JSON</button>
              {wolfVariableBaseline ? <div style={{ ...subtleStyle, marginTop: 8, lineHeight: 1.6 }}>基线：{new Date(wolfVariableBaseline.capturedAt).toLocaleTimeString()} · {wolfVariableBaselineMatches ? `已比较，${wolfVariableChanges.length} 项变化` : "基线与当前基址/数量不匹配，或属于其他游戏；请重新设基线"}。若已重载/重新启动游戏，务必清除旧基线后再采集。</div> : null}
              <div style={{ marginTop: 10, border: "1px solid #253247", borderRadius: 9, overflow: "hidden" }}>
                    {wolfVariableRange.rows.map((row) => {
                      const label = getWolfLabel(row.id);
                      const hasBaseline = wolfVariableBaselineMatches && wolfVariableBaselineValues.has(row.id);
                      const baselineValue = hasBaseline ? wolfVariableBaselineValues.get(row.id) : undefined;
                      const changed = hasBaseline && baselineValue !== row.value;
                      return <div key={row.id} style={{ padding: "8px 10px", borderBottom: "1px solid #202b3a", background: changed ? "#392a1b" : label ? "#172437" : "#0f1722" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                          <strong style={{ fontSize: 13, color: label ? "#b8d5ff" : "#edf3fc" }}>V{row.id}{label ? ` · ${label}` : ""}</strong>
                          <code style={{ fontSize: 11, color: "#9eacc1" }}>0x{row.address.toString(16).toUpperCase().padStart(8, "0")}</code>
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums", color: changed ? "#ffd28a" : "#edf3fc" }}>{row.value}</div>
                        {hasBaseline ? <div style={{ ...subtleStyle, marginTop: 3, color: changed ? "#ffd28a" : "#9eacc1" }}>{changed ? `基线 ${baselineValue} → 当前 ${row.value}（变化 ${row.value - (baselineValue as number) > 0 ? "+" : ""}${row.value - (baselineValue as number)}）` : "与基线一致"}</div> : null}
                        {/* AETHER_WOLF_VARIABLE_WRITE_V1: intentionally no batch operation; each row has its own guarded write. */}
                        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, marginTop: 8 }}>
                          <input value={wolfVariableEditValues[row.id] ?? ""} inputMode="numeric" aria-label={`V${row.id} 新值`} placeholder="新 Int32 值" onChange={(event) => setWolfVariableEditValues((old) => ({ ...old, [row.id]: event.target.value }))} style={{ ...inputStyle, minWidth: 0, padding: "8px 9px" }} />
                          <button type="button" disabled={Boolean(busy) || wolfVariableRange.count !== 65 || !wolfVariableBaseDetection?.candidates.some((candidate) => candidate.base === wolfVariableRange.base)} onClick={() => void writeWolfVariable(row)} style={{ ...buttonStyle, padding: "8px 10px", background: "#462b25", borderColor: "#875044" }}>写入此项</button>
                        </div>
                        <div style={{ ...subtleStyle, marginTop: 4 }}>写入前会核对本次显示的旧值 {row.value}；只写单项，立即回读并在 500ms 后复查。</div>
                      </div>;
                    })}
                  </div>
                </>
              ) : <div style={{ ...subtleStyle, marginTop: 8 }}>尚未读取。默认只读取当前内存，不修改数值。</div>}
            </section>
            <details style={{ marginBottom: 12, fontSize: 12, color: "#9eacc1", background: "#111a27", padding: 10, borderRadius: 10, border: "1px solid #253247" }}>
              <summary style={{ cursor: "pointer" }}>🔍 调试：查看提取的变量名与原始目录结构</summary>
              <pre style={{ background: "#000", padding: 10, overflow: "auto", maxHeight: 200, marginTop: 8 }}>
                提取到的变量名：{JSON.stringify(projectVariableNames, null, 2)}


                原始 variableCatalog 前 1000 字符：
{JSON.stringify(variableCatalog).slice(0, 1000)}
              </pre>
            </details>
            <WolfVariableCatalogView
              catalog={variableCatalog}
              loading={Boolean(busy)}
              onLoad={() => void loadVariableCatalog()}
              hpChain={hpChain}
              hpChainBusy={Boolean(busy)}
              onRefreshHpChain={() => void refreshHpChain()}
              onWriteHpChain={(value) => void writeHpChain(value)}
              probeTarget={variableProbeTarget}
              probeSummary={scanSummary}
              probeResults={scanResults}
              onStartVariableProbe={(target) => void startVariableProbe(target)}
              onFilterVariableChanges={() => void filterVariableChanges()}
              onMatchVariableCurrentValue={(value) => void matchVariableCurrentValue(value)}
              onLoadProbePage={(page) => void loadScanPage(page)}
              onExportProbePage={() => void exportVariableProbePage()}
            />
          </>
        ) : null}
        {tab === "memory" ? (
          <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ background: "#111a27", border: "1px solid #253247", borderRadius: 14, padding: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>锚点周边内存快照（只读）</div>
              <div style={{ ...subtleStyle, marginTop: 5, lineHeight: 1.6 }}>
                采集锚点前后对齐的 32 位字，同时显示十六进制、UInt32、Int32 与 Float32；保存第一份作为基线，之后再次采集即可自动标出发生变化的地址。不需要让相邻变量主动变化。
                默认地址 0x03CECC0C 来自此前 mi 游戏的 V17 候选；若当前是其他游戏/新实例，请填入已确认的当前地址。
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 8, marginTop: 10 }}>
                <label style={{ ...subtleStyle, display: "flex", flexDirection: "column", gap: 5 }}>锚点地址
                  <input value={neighborhoodAddressText} onChange={(event) => setNeighborhoodAddressText(event.target.value)} placeholder="例如 0x03CECC0C" style={inputStyle} />
                </label>
                <label style={{ ...subtleStyle, display: "flex", flexDirection: "column", gap: 5 }}>前后范围（字节）
                  <input value={neighborhoodRadiusText} inputMode="numeric" onChange={(event) => setNeighborhoodRadiusText(event.target.value)} placeholder="128" style={inputStyle} />
                </label>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button type="button" disabled={Boolean(busy) || !capabilities?.memoryAvailable} onClick={() => void captureMemoryNeighborhood()} style={{ ...buttonStyle, flex: 1, background: "#245c4b", borderColor: "#397c66" }}>采集快照</button>
                <button type="button" disabled={Boolean(busy) || !neighborhoodSnapshot} onClick={() => {
                  if (!neighborhoodSnapshot) return;
                  setNeighborhoodBaseline(neighborhoodSnapshot);
                  setNotice(`已保存基线：${neighborhoodSnapshot.anchorHex}，${neighborhoodSnapshot.words.length} 个字。回到游戏后再采集一次即可比较。`);
                }} style={{ ...buttonStyle, flex: 1 }}>设为基线</button>
              </div>
              <button type="button" disabled={Boolean(busy) || !neighborhoodSnapshot} onClick={() => void exportMemoryNeighborhood()} style={{ ...buttonStyle, width: "100%", marginTop: 8 }}>导出快照与差分 JSON</button>
              {neighborhoodSnapshot ? (
                <div style={{ marginTop: 10 }}>
                  {infoRow("锚点 / 采集时间", `${neighborhoodSnapshot.anchorHex} · ${new Date(neighborhoodSnapshot.capturedAt).toLocaleTimeString()}`)}
                  {infoRow("实际内存范围", `${formatBytes(neighborhoodSnapshot.memoryBytes)} · ${neighborhoodSnapshot.words.length} 个对齐字`)}
                  {infoRow("基线状态", neighborhoodBaselineMatches ? `可比较 · ${neighborhoodChanges.length} 处变化` : neighborhoodBaseline ? "基线地址/范围不一致，请重新设基线" : "尚未设置；先采集快照，再点击“设为基线”")}
                  <div style={{ ...subtleStyle, marginTop: 8, lineHeight: 1.5 }}>变化比较以原始 32 位 hex 字为准。橙色表示相对基线改变，蓝色表示锚点所在的对齐字。</div>
                  <div style={{ marginTop: 8, border: "1px solid #253247", borderRadius: 9, overflow: "hidden" }}>
                    {neighborhoodSnapshot.words.map((word) => {
                      const prior = neighborhoodBaselineMatches ? neighborhoodBaseline!.words.find((item) => item.offset === word.offset) : undefined;
                      const changed = Boolean(prior && prior.hex !== word.hex);
                      const isAnchor = word.offset === Math.floor(neighborhoodSnapshot.anchorOffset / 4) * 4;
                      return <div key={word.offset} style={{ padding: "8px 9px", borderBottom: "1px solid #202b3a", background: changed ? "#392a1b" : isAnchor ? "#172c46" : "#0f1722" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
                          <code style={{ color: isAnchor ? "#9fc6ff" : changed ? "#ffd28a" : "#c7d2e2" }}>{word.offsetHex}{isAnchor ? "  ← 锚点" : ""}</code>
                          <code>{word.hex}</code>
                        </div>
                        <div style={{ ...subtleStyle, marginTop: 3, overflowWrap: "anywhere" }}>
                          {prior ? `Int32 ${prior.i32} → ${word.i32} · UInt32 ${prior.u32} → ${word.u32}` : `Int32 ${word.i32} · UInt32 ${word.u32}`} · Float32 {Number.isFinite(word.f32) ? word.f32.toPrecision(7) : String(word.f32)}
                        </div>
                      </div>;
                    })}
                  </div>
                </div>
              ) : <div style={{ ...subtleStyle, marginTop: 8 }}>尚无快照。此功能只读取当前 WASM 内存，不会写入或锁定任何值。</div>}
            </div>
            <div style={{ background: "#111a27", border: "1px solid #253247", borderRadius: 14, padding: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>已知地址直接读取（只读）</div>
              <div style={{ ...subtleStyle, marginTop: 5, lineHeight: 1.6 }}>
                用于验证已知变量地址。动态 HP 编辑器会自动刷新地址；此区域仍保留为任意地址只读检查。
              </div>
              <label style={{ ...subtleStyle, display: "flex", flexDirection: "column", gap: 5, marginTop: 10 }}>
                WASM 字节偏移（十进制或 0x 十六进制）
                <input value={directAddressText} inputMode="text" spellCheck={false}
                  onChange={(event) => { setDirectAddressText(event.target.value); setDirectMemoryValue(null); setDirectMemoryReadOffset(null); }}
                  placeholder="0x078e5588" style={inputStyle} />
              </label>
              <label style={{ ...subtleStyle, display: "flex", flexDirection: "column", gap: 5, marginTop: 8 }}>
                读取类型
                <select value={directAddressType} onChange={(event) => { setDirectAddressType(event.target.value as DebugScanType); setDirectMemoryValue(null); }} style={inputStyle}>
                  <option value="i32">Int32（有符号整数）</option><option value="u32">UInt32（无符号整数）</option>
                  <option value="i16">Int16</option><option value="u16">UInt16</option><option value="i8">Int8</option><option value="u8">UInt8</option>
                  <option value="f32">Float32</option><option value="f64">Float64</option>
                </select>
              </label>
              <button type="button" disabled={Boolean(busy) || !capabilities?.memoryAvailable}
                onClick={() => void readDirectMemoryAddress()} style={{ ...buttonStyle, width: "100%", marginTop: 10 }}>
                {busy.includes("读取指定 WASM 内存地址") ? "读取中…" : "读取该地址（不写入）"}
              </button>
              {directMemoryValue !== null && directMemoryReadOffset !== null ? (
                <div style={{ marginTop: 10, borderRadius: 9, border: "1px solid #354258", padding: 10, overflowWrap: "anywhere" }}>
                  <div style={subtleStyle}>最近一次读取 · {directMemoryReadAt} · {directAddressType}</div>
                  <div style={{ marginTop: 5, fontSize: 18, fontWeight: 750 }}>{String(directMemoryValue)}</div>
                  <code style={{ fontSize: 12, color: "#9fc6ff" }}>0x{directMemoryReadOffset.toString(16).toUpperCase().padStart(8, "0")}</code>
                </div>
              ) : null}
            </div>
            <div style={{ background: "#111a27", border: "1px solid #253247", borderRadius: 14, padding: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>已知地址引用分析</div>
              <div style={{ ...subtleStyle, marginTop: 5, lineHeight: 1.55 }}>针对会随 HP 变化的地址，扫描当前 WASM 内存中指向该地址或其附近（±0x400 字节）的 32 位指针。只读、不改值；目的是寻找可能的上层数据结构引用，帮助解决重进游戏后地址变化的问题。</div>
              <label style={{ ...subtleStyle, display: "flex", flexDirection: "column", gap: 5, marginTop: 10 }}>HP 当前地址
                <input value={traceAddressText} onChange={(event) => setTraceAddressText(event.target.value)} placeholder="例如 0x0795c0b0" style={inputStyle} />
              </label>
              <button type="button" disabled={Boolean(busy) || !capabilities?.memoryAvailable} onClick={() => void runAddressTrace()} style={{ ...buttonStyle, width: "100%", marginTop: 9 }}>分析地址引用（只读）</button>
              {addressTrace ? (
                <div style={{ marginTop: 12 }}>
                  {infoRow("目标地址", addressTrace.targetHex)}
                  {infoRow("扫描范围", formatBytes(addressTrace.scannedBytes))}
                  {infoRow("精确指向该地址", addressTrace.exactReferenceCount.toLocaleString())}
                  {infoRow("±0x400 内指针候选", addressTrace.nearbyReferenceCount.toLocaleString())}
                  <div style={{ ...subtleStyle, lineHeight: 1.55, marginTop: 8 }}>以下是指针所在位置及其周围的 32 位字。附近指针只代表候选，不自动证明它属于 HP 结构。</div>
                  {addressTrace.references.slice(0, 30).map((item) => (
                    <div key={`${item.offset}:${item.pointsTo}`} style={{ marginTop: 8, padding: 9, border: "1px solid #253247", borderRadius: 9 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}><code style={{ color: item.exact ? "#b8f3da" : "#9fc6ff" }}>{item.offsetHex}</code><span>{item.exact ? "精确引用" : `偏移 ${item.delta >= 0 ? "+" : ""}${item.delta}`}</span></div>
                      <div style={{ ...subtleStyle, marginTop: 4 }}>指向 {item.pointsToHex}</div>
                      <div style={{ ...subtleStyle, overflowWrap: "anywhere", marginTop: 4 }}>邻近字：{item.context.map((word) => `${word.offset.toString(16)}=${word.hex}`).join(" · ")}</div>
                    </div>
                  ))}
                  {addressTrace.referencesTruncated ? <div style={{ ...subtleStyle, marginTop: 8 }}>引用较多，页面仅显示前 30 项；JSON 文件包含最多 300 个筛选后的引用样本。</div> : null}
                  <button type="button" disabled={Boolean(busy)} onClick={() => void exportAddressTrace()} style={{ ...buttonStyle, width: "100%", marginTop: 10 }}>导出地址分析 JSON</button>
                </div>
              ) : null}
            </div>
            <div style={{ background: "#111a27", border: "1px solid #253247", borderRadius: 14, padding: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>WASM 内存扫描与修改</div>
              <div style={{ ...subtleStyle, marginTop: 5 }}>输入游戏中显示的数值进行首次扫描；回到游戏改变数值，再按变化条件复筛。地址是当前游戏实例内的字节偏移，重启游戏后通常需要重新扫描。</div>
              {infoRow("可用内存", capabilities?.memoryAvailable ? formatBytes(capabilities.heapBytes) : "尚未探测到")}
              {infoRow("内存来源", capabilities?.wasmMemorySource || "未知")}
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)", gap: 8, marginTop: 12 }}>
                <label style={{ ...subtleStyle, display: "flex", flexDirection: "column", gap: 5 }}>数值类型
                  <select value={scanType} disabled={Boolean(scanSummary)} onChange={(event) => setScanType(event.target.value as DebugScanType)} style={inputStyle}>
                    <option value="i32">Int32（常见整数）</option><option value="u32">UInt32</option><option value="i16">Int16</option><option value="u16">UInt16</option><option value="i8">Int8</option><option value="u8">UInt8</option><option value="f32">Float32（小数）</option><option value="f64">Float64</option>
                  </select>
                </label>
                <label style={{ ...subtleStyle, display: "flex", flexDirection: "column", gap: 5 }}>搜索模式
                  <select value={scanMode} disabled={Boolean(scanSummary)} onChange={(event) => setScanMode(event.target.value as DebugScanMode)} style={inputStyle}>
                    <option value="exact">已知数值（精确搜索）</option>
                    <option value="unknown">未知初始值（快照搜索）</option>
                  </select>
                </label>
              </div>
              {scanMode === "exact" ? (
                <label style={{ ...subtleStyle, display: "flex", flexDirection: "column", gap: 5, marginTop: 10 }}>首次搜索的显示值
                  <input inputMode="decimal" value={scanValue} disabled={Boolean(scanSummary)} onChange={(event) => setScanValue(event.target.value)} placeholder="例如 100" style={inputStyle}/>
                </label>
              ) : (
                <div style={{ marginTop: 10 }}>
                  <div style={{ ...subtleStyle, marginBottom: 5 }}>未知值快照范围（结束地址不包含在内；留空表示扫描到内存末尾）</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <label style={{ ...subtleStyle, display: "flex", flexDirection: "column", gap: 5 }}>起始地址（偏移）
                      <input value={unknownStartText} disabled={Boolean(scanSummary)} onChange={(event) => setUnknownStartText(event.target.value)} placeholder="0 或 0x0" style={inputStyle}/>
                    </label>
                    <label style={{ ...subtleStyle, display: "flex", flexDirection: "column", gap: 5 }}>结束地址（可空）
                      <input value={unknownEndText} disabled={Boolean(scanSummary)} onChange={(event) => setUnknownEndText(event.target.value)} placeholder="例如 0x4000000" style={inputStyle}/>
                    </label>
                  </div>
                  <div style={{ ...subtleStyle, marginTop: 5 }}>单次快照最多 128 MiB，范围可用十进制或 0x 十六进制；内存更大时请分段扫描。</div>
                </div>
              )}
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, ...subtleStyle }}><input type="checkbox" checked={alignedScan} disabled={Boolean(scanSummary)} onChange={(event) => setAlignedScan(event.target.checked)}/>仅扫描对齐地址（更快；找不到时可关闭）</label>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button type="button" disabled={Boolean(busy) || !capabilities?.memoryAvailable} onClick={() => void runFirstScan()} style={{ ...buttonStyle, flex: 1, background: "#245c4b", borderColor: "#397c66" }}>首次扫描</button>
                <button type="button" disabled={Boolean(busy) || !scanSummary} onClick={() => void resetScan()} style={{ ...buttonStyle, flex: 1 }}>重置搜索</button>
              </div>
            </div>
            {scanSummary ? (
              <div style={{ background: "#111a27", border: "1px solid #253247", borderRadius: 14, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}><div style={{ fontWeight: 700, fontSize: 14 }}>{scanSummary.unknownBaselinePending ? "未知初始值快照已记录" : `候选地址：${scanSummary.count.toLocaleString()}`}</div><div style={subtleStyle}>{scanSummary.unknownBaselinePending ? formatBytes(scanSummary.scannedBytes) : `显示前 ${scanResults.length} 个`}</div></div>
                <div style={{ ...subtleStyle, marginTop: 4 }}>类型 {scanSummary.scanType} · 已扫描 {formatBytes(scanSummary.scannedBytes)} · {scanSummary.aligned ? "对齐扫描" : "逐字节扫描"}</div>
                {!scanSummary.unknownBaselinePending ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
                    <button type="button" disabled={Boolean(busy) || scanSummary.page <= 0} onClick={() => void loadScanPage(scanSummary.page - 1)} style={buttonStyle}>上一页</button>
                    <span style={subtleStyle}>第 {scanSummary.page + 1} / {scanSummary.pageCount} 页，每页最多 200 项</span>
                    <button type="button" disabled={Boolean(busy) || scanSummary.page + 1 >= scanSummary.pageCount} onClick={() => void loadScanPage(scanSummary.page + 1)} style={buttonStyle}>下一页</button>
                  </div>
                ) : null}
                {scanSummary.truncated ? <div style={{ color: "#ffd28a", fontSize: 12, marginTop: 7 }}>匹配数量超过 50,000 个，当前保留了分布于内存地址范围的 50,000 个抽样候选；建议继续筛选或缩小扫描范围。</div> : null}
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, marginTop: 12 }}>
                  <select value={scanFilter} onChange={(event) => setScanFilter(event.target.value as DebugScanFilter)} style={inputStyle}>
                    <option value="changed">已变化（与上次不同）</option><option value="unchanged">未变化（与上次相同）</option>
                    <option value="increased">比上次增大</option><option value="decreased">比上次减小</option>
                    <option value="equal">当前值等于输入值</option><option value="not-equal">当前值不等于输入值</option>
                    <option value="greater">当前值大于输入值</option><option value="less">当前值小于输入值</option><option value="between">当前值介于两个值之间</option>
                  </select>
                  <button type="button" disabled={Boolean(busy)} onClick={() => void runNextScan()} style={buttonStyle}>再次筛选</button>
                </div>
                {["equal", "not-equal", "greater", "less", "between"].includes(scanFilter) ? (
                  <div style={{ display: "grid", gridTemplateColumns: scanFilter === "between" ? "1fr 1fr" : "1fr", gap: 8, marginTop: 8 }}>
                    <label style={{ ...subtleStyle, display: "flex", flexDirection: "column", gap: 5 }}>复筛目标值（独立于首次搜索）
                      <input inputMode="decimal" value={refineValue} onChange={(event) => setRefineValue(event.target.value)} placeholder="例如 100" style={inputStyle}/>
                    </label>
                    {scanFilter === "between" ? <label style={{ ...subtleStyle, display: "flex", flexDirection: "column", gap: 5 }}>范围最大值
                      <input inputMode="decimal" value={refineValue2} onChange={(event) => setRefineValue2(event.target.value)} placeholder="例如 200" style={inputStyle}/>
                    </label> : null}
                  </div>
                ) : null}
                <div style={{ ...subtleStyle, marginTop: 6 }}>{scanSummary.unknownBaselinePending ? "快照已保存。回到游戏进行一次操作，再回来按变化筛选；若值不易变化，可用已知目标值的等于/大于/小于/范围筛选。" : "变化筛选比较当前候选值与上次扫描时的值；数值条件使用上方独立输入框，不会覆盖首次搜索值。"}</div>
              </div>
            ) : null}
            {scanSummary && scanResults.length > 0 ? (
              <div style={{ border: "1px solid #253247", borderRadius: 12, overflow: "hidden" }}>
                {scanResults.map((result) => {
                  const type = scanSummary.scanType, rowKey = `${type}:${result.offset}`, isFrozen = frozenResults.some((item) => item.key === rowKey);
                  return <div key={rowKey} style={{ padding: 10, borderBottom: "1px solid #202b3a", background: "#0f1722" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, marginBottom: 7 }}><code style={{ color: "#9fc6ff" }}>0x{result.offset.toString(16).padStart(8, "0")}</code><span style={{ color: "#dce8f8" }}>{String(result.value)}</span></div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input aria-label={`地址 0x${result.offset.toString(16)} 新值`} inputMode="decimal" value={rowValues[result.offset] ?? String(result.value)} onChange={(event) => setRowValues((old) => ({ ...old, [result.offset]: event.target.value }))} style={{ ...inputStyle, minWidth: 0, flex: 1, padding: 8 }}/>
                      <button type="button" disabled={Boolean(busy)} onClick={() => void writeMemoryResult(result)} style={{ ...buttonStyle, padding: "8px 9px" }}>写入</button>
                      <button type="button" disabled={Boolean(busy)} onClick={() => void toggleFreeze(result)} style={{ ...buttonStyle, padding: "8px 9px", background: isFrozen ? "#583a28" : "#182335", borderColor: isFrozen ? "#a97848" : "#354258" }}>{isFrozen ? "解锁" : "锁定"}</button>
                    </div>
                  </div>;
                })}
              </div>
            ) : null}
            {scanSummary && !scanSummary.unknownBaselinePending && scanResults.length === 0 ? <div style={{ ...subtleStyle, padding: 12, border: "1px dashed #45536a", borderRadius: 10 }}>没有匹配地址。请确认数值类型/筛选条件；也可以重置后关闭对齐扫描再试。</div> : null}
            <div style={{ background: "#111a27", border: "1px solid #253247", borderRadius: 14, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}><div style={{ fontSize: 14, fontWeight: 700 }}>已锁定数值（{frozenResults.length}）</div><button type="button" disabled={Boolean(busy) || frozenResults.length === 0} onClick={() => void clearFreezes()} style={buttonStyle}>全部解除</button></div>
              {frozenResults.length === 0 ? <div style={{ ...subtleStyle, marginTop: 7 }}>锁定后，运行时每 100 ms 尝试写回目标值。关闭调试面板不会自动解除锁定；可在这里解除或重启游戏。</div> : null}
              {frozenResults.map((item) => <div key={item.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, borderTop: "1px solid #253247", paddingTop: 8, marginTop: 8 }}>
                <div style={{ minWidth: 0, fontSize: 12, overflowWrap: "anywhere" }}><code>0x{item.offset.toString(16).padStart(8, "0")}</code><div style={subtleStyle}>{item.type} = {item.value}</div></div><button type="button" disabled={Boolean(busy)} onClick={() => void removeFreeze(item)} style={buttonStyle}>解除</button>
              </div>)}
            </div>
          </section>
        ) : null}
        {tab === "files" ? (
          <section style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button type="button" style={buttonStyle} disabled={currentPath === "/" || Boolean(busy)} onClick={() => setCurrentPath(parentPath(currentPath))}>上一级</button>
              <div style={{ flex: 1, minWidth: 0, color: "#9eacc1", fontSize: 12, overflowWrap: "anywhere" }}>路径：{currentPath}</div>
              <button type="button" style={buttonStyle} disabled={Boolean(busy)} onClick={() => void loadDirectory(currentPath)}>刷新</button>
            </div>
            <div style={{ border: "1px solid #253247", borderRadius: 12, overflow: "hidden" }}>
              {entries.length === 0 && !busy ? <div style={{ padding: 14, ...subtleStyle }}>目录为空、文件系统尚未就绪，或运行时不支持目录读取。</div> : null}
              {entries.map((entry) => (
                <button key={entry.path} type="button" onClick={() => entry.kind === "directory" ? setCurrentPath(entry.path) : void openFile(entry)}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "12px 11px", border: 0, borderBottom: "1px solid #202b3a", textAlign: "left", background: selectedFile?.path === entry.path ? "#1d3049" : "#0f1722", color: "#edf3fc" }}>
                  <span style={{ fontSize: 18, width: 22, textAlign: "center" }}>{entry.kind === "directory" ? "📁" : "▤"}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflowWrap: "anywhere" }}>{entry.name}</span>
                  <span style={{ ...subtleStyle, flexShrink: 0 }}>{entry.kind === "directory" ? "目录" : formatBytes(entry.size)}</span>
                </button>
              ))}
            </div>
            {truncated ? <div style={subtleStyle}>目录项目较多，仅显示前 250 项。</div> : null}
            {selectedFile ? (
              <div style={{ background: "#111a27", border: "1px solid #253247", borderRadius: 12, padding: 12, marginTop: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, overflowWrap: "anywhere" }}>{selectedFile.path}</div>
                <div style={{ ...subtleStyle, marginTop: 4, marginBottom: 9 }}>{formatBytes(selectedFile.size)} · {selectedFile.format === "text" ? "UTF-8 文本" : "十六进制字节"}</div>
                <textarea aria-label="文件内容" spellCheck={false} value={editorContent} onChange={(event) => setEditorContent(event.target.value)}
                  style={{ ...inputStyle, minHeight: "30vh", resize: "vertical", fontFamily: "ui-monospace, SFMono-Regular, monospace", lineHeight: 1.5 }} />
                <div style={{ ...subtleStyle, marginTop: 6 }}>仅允许编辑已存在且不超过 256 KiB 的文件。十六进制内容可用空格或换行分隔。</div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button type="button" style={{ ...buttonStyle, flex: 1 }} disabled={Boolean(busy)} onClick={() => setEditorContent(selectedFile.content)}>撤销本次编辑</button>
                  <button type="button" style={{ ...buttonStyle, flex: 1, background: "#245c4b", borderColor: "#397c66" }} disabled={Boolean(busy)} onClick={() => void saveFile()}>备份并保存</button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
      </main>
      <footer style={{ padding: "8px 14px max(10px, env(safe-area-inset-bottom, 0px))", borderTop: "1px solid #263449", background: "#0e1621", ...subtleStyle }}>
        修改仅作用于当前游戏实例。内存地址会随运行变化；写入前请保存游戏，锁定的值可在调试面板中解除，重启游戏也会清除本次内存锁定。
      </footer>
    </div>
  );
}
