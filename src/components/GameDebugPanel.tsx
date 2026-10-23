import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Capacitor } from "@capacitor/core";
import { saveAndroidTextFile } from "@/src/lib/androidFolderPicker";
import type { WolfVariableCatalog } from "@/player-runtime/engines/wolf/variableCatalog";
import type { AetherRuntimeIntrospection } from "@/player-runtime/engines/wolf/runtimeIntrospection";
import { WolfVariableCatalogView } from "@/src/components/WolfVariableCatalogView";

type DebugCommand = "probe" | "runtime-introspect" | "address-trace" | "variable-catalog" | "list-files" | "read-file" | "write-file" | "scan-first" | "scan-unknown-first" | "scan-next" | "scan-page" | "scan-reset" | "memory-read" | "memory-write" | "freeze-add" | "freeze-remove" | "freeze-clear";
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
interface DebugFreezeEntry { key: string; type: DebugScanType; offset: number; value: number }

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
  runtimeIntrospection?: AetherRuntimeIntrospection;
  addressTrace?: DebugAddressTrace;
}
interface DebugRequestArgs { path?: string; format?: DebugFormat; content?: string; scanType?: DebugScanType; scanValue?: number; scanValue2?: number; scanFilter?: DebugScanFilter; scanStartOffset?: number; scanEndOffset?: number; page?: number; aligned?: boolean; offset?: number; value?: number; }
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
  const [scanResults, setScanResults] = useState<DebugScanResult[]>([]);
  const [rowValues, setRowValues] = useState<Record<number, string>>({});
  const [frozenResults, setFrozenResults] = useState<DebugFreezeEntry[]>([]);
  const [variableCatalog, setVariableCatalog] = useState<WolfVariableCatalog | null>(null);
  const [runtimeIntrospection, setRuntimeIntrospection] = useState<AetherRuntimeIntrospection | null>(null);
  // Read-only validation for a user-supplied, known WOLF variable address.
  const [directAddressText, setDirectAddressText] = useState("0x078e5588");
  const [directAddressType, setDirectAddressType] = useState<DebugScanType>("i32");
  const [directMemoryValue, setDirectMemoryValue] = useState<number | null>(null);
  const [directMemoryReadOffset, setDirectMemoryReadOffset] = useState<number | null>(null);
  const [directMemoryReadAt, setDirectMemoryReadAt] = useState("");
  const pending = useRef(new Map<string, PendingRequest>());

  const request = useCallback((command: DebugCommand, args: DebugRequestArgs = {}) => {
    const target = frameRef.current?.contentWindow;
    if (!target) return Promise.reject(new Error("游戏 iframe 尚未就绪。"));
    const requestId = newRequestId();
    return new Promise<DebugResponse>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pending.current.delete(requestId);
        reject(new Error("游戏运行时没有响应。请确认游戏已启动，再重试。"));
      }, command === "scan-first" || command === "scan-unknown-first" || command === "scan-next" || command === "variable-catalog" || command === "address-trace" ? 180000 : 8000);
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

  const loadVariableCatalog = async () => {
    setBusy("正在读取 WOLF 变量元数据…"); setError(""); setNotice("");
    try {
      const response = await request("variable-catalog");
      if (!response.variableCatalog) throw new Error("运行时没有返回 WOLF 变量目录。");
      setVariableCatalog(response.variableCatalog);
      setNotice(`变量目录已读取：${response.variableCatalog.totalVariables.toLocaleString()} 个目录项，${response.variableCatalog.groups.length} 个类别。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(""); }
  };

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
              </div>
            ) : null}
          </section>
        ) : null}

        {tab === "variables" ? (
          <WolfVariableCatalogView catalog={variableCatalog} loading={Boolean(busy)} onLoad={() => void loadVariableCatalog()} />
        ) : null}
        {tab === "memory" ? (
          <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ background: "#111a27", border: "1px solid #253247", borderRadius: 14, padding: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>已知地址直接读取（只读）</div>
              <div style={{ ...subtleStyle, marginTop: 5, lineHeight: 1.6 }}>
                用于验证已知变量地址。默认填入提供的 HP 地址 0x078e5588；此区域只读，不会修改或锁定内存。
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
