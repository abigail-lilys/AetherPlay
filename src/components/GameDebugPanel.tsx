import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

type DebugCommand = "probe" | "list-files" | "read-file" | "write-file";
type DebugTab = "overview" | "files" | "memory";
type DebugFormat = "text" | "hex";

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
}
interface DebugRequestArgs {
  path?: string;
  format?: DebugFormat;
  content?: string;
}
interface PendingRequest {
  resolve: (response: DebugResponse) => void;
  reject: (error: Error) => void;
  timeout: number;
}
interface GameDebugPanelProps {
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

export function GameDebugPanel({ gameId, gameTitle, frameRef, onClose }: GameDebugPanelProps) {
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
  const pending = useRef(new Map<string, PendingRequest>());

  const request = useCallback((command: DebugCommand, args: DebugRequestArgs = {}) => {
    const target = frameRef.current?.contentWindow;
    if (!target) return Promise.reject(new Error("游戏 iframe 尚未就绪。"));
    const requestId = newRequestId();
    return new Promise<DebugResponse>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pending.current.delete(requestId);
        reject(new Error("游戏运行时没有响应。请确认游戏已启动，再重试。"));
      }, 8000);
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
    <div style={panelStyle} role="dialog" aria-modal="true" aria-label="游戏调试台">
      <header style={{ padding: "max(14px, env(safe-area-inset-top, 0px)) 14px 12px", background: "#111a27", borderBottom: "1px solid #263449" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 750 }}>游戏调试台</div>
            <div style={{ ...subtleStyle, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 3 }}>{gameTitle} · {capabilities?.engine || "等待运行时探测"}</div>
          </div>
          <button type="button" onClick={onClose} style={buttonStyle} aria-label="关闭调试台">关闭 ✕</button>
        </div>
        <nav style={{ display: "flex", gap: 8, marginTop: 13 }}>
          {tabButton("overview", "概览")}{tabButton("files", "虚拟文件")}{tabButton("memory", "内存能力")}
        </nav>
      </header>

      <main style={{ flex: 1, overflow: "auto", padding: 14, paddingBottom: "max(18px, env(safe-area-inset-bottom, 0px))" }}>
        {busy ? <div style={{ ...subtleStyle, padding: "6px 0 12px" }}>{busy}</div> : null}
        {error ? <div role="alert" style={{ marginBottom: 12, padding: 11, borderRadius: 10, background: "#3a1c25", color: "#ffd4dc", fontSize: 13, whiteSpace: "pre-wrap" }}>{error}</div> : null}
        {notice ? <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: "#122d28", color: "#b8f3da", fontSize: 12, overflowWrap: "anywhere" }}>{notice}</div> : null}

        {tab === "overview" ? (
          <section style={{ background: "#111a27", border: "1px solid #253247", borderRadius: 14, padding: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>运行时连接</div>
            <div style={subtleStyle}>此版本先实现 WOLF 运行时探测与虚拟文件调试。内存扫描会在能力确认后单独启用。</div>
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
          </section>
        ) : null}

        {tab === "memory" ? (
          <section style={{ background: "#111a27", border: "1px solid #253247", borderRadius: 14, padding: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Wasm 内存接口探测</div>
            <div style={{ ...subtleStyle, marginTop: 5, marginBottom: 12 }}>这里只报告运行时真实暴露的接口；不假定变量布局，也不会自动写入内存。</div>
            {infoRow("HEAPU8", capabilities?.heapU8 ? "可用" : "未暴露")}
            {infoRow("HEAP32", capabilities?.heap32 ? "可用" : "未暴露")}
            {infoRow("HEAPF32", capabilities?.heapF32 ? "可用" : "未暴露")}
            {infoRow("HEAPF64", capabilities?.heapF64 ? "可用" : "未暴露")}
            {infoRow("wasmMemory", capabilities?.wasmMemory ? "可用" : "未暴露")}
            {infoRow("捕获钩子", capabilities?.wasmCaptureHookInstalled ? "已安装" : "未安装")}
            {infoRow("WASM 实例化调用次数", String(capabilities?.wasmInstantiateCalls ?? 0))}
            {infoRow("内存来源", capabilities?.wasmMemorySource || "未知")}
            <div style={{ marginTop: 14, border: "1px dashed #45536a", borderRadius: 10, padding: 12 }}>
              <div style={{ fontWeight: 650, fontSize: 13 }}>数值扫描器：尚未启用</div>
              <div style={{ ...subtleStyle, marginTop: 5 }}>下一阶段会先验证候选地址筛选与写入闭环，再开放等于、增大、减小、变化/不变筛选。</div>
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
        修改仅作用于当前游戏运行时的虚拟文件系统；请保留独立存档。调试器不会联网上传游戏数据。
      </footer>
    </div>
  );
}
