import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { WolfVariableCatalog } from "@/player-runtime/engines/wolf/variableCatalog";
import {
  WOLF_SYSTEM_VARIABLE_BY_ID,
  WOLF_SYSTEM_VARIABLE_COUNT,
} from "@/player-runtime/engines/wolf/systemVariables";

type DebugCommand =
  | "probe" | "variable-catalog" | "sys-time-feature-scan" | "sys-variable-range-read" | "sys-variable-write"
  | "wolf-variable-base-detect" | "wolf-variable-range-read" | "wolf-variable-write"
  | "freeze-add" | "freeze-remove" | "freeze-clear";

type DebugRow = { id: number; address: number; value: number };
type DebugResponse = {
  type: "aetherplay-debug-result";
  requestId: string;
  gameId: string;
  command: DebugCommand;
  ok: boolean;
  error?: string;
  capabilities?: { memoryAvailable?: boolean; heapBytes?: number };
  variableCatalog?: WolfVariableCatalog;
  sysVariables?: { base: number; count: number; rows: DebugRow[] };
  sysVariableWrite?: { variableId: number; immediateValue: number };
  sysTimeFeatureScan?: {
    phase: "baseline" | "compare" | "reset";
    baselineCandidateCount: number;
    candidateCount: number;
    truncated: boolean;
    candidates: Array<{ base: number }>;
  };
  wolfVariableBaseDetection?: {
    candidateCount: number;
    truncated: boolean;
    candidates: Array<{ base: number }>;
  };
  wolfVariables?: { base: number; count: number; rows: DebugRow[] };
  wolfVariableWrite?: { variableId: number; immediateValue: number };
  frozenCount?: number;
};

type PendingRequest = { resolve: (value: DebugResponse) => void; reject: (error: Error) => void; timeout: number };
type PanelProps = {
  visible: boolean;
  gameId: string;
  gameTitle: string;
  frameRef: RefObject<HTMLIFrameElement | null>;
  onClose: () => void;
};
type ActiveGroup = "sys" | "v";
type DisplayRow = { key: string; id: number; label: string; value: number; address: number; readOnly: boolean };

const panel: CSSProperties = {
  position: "fixed", inset: 0, zIndex: 100000, display: "flex", flexDirection: "column",
  background: "#0b1018", color: "#edf3fc", fontFamily: "system-ui, sans-serif",
};
const button: CSSProperties = {
  border: "1px solid #354258", borderRadius: 9, padding: "8px 11px", color: "#edf3fc",
  background: "#1b293c", fontSize: 13, fontWeight: 650, cursor: "pointer",
};
const input: CSSProperties = {
  width: "100%", minWidth: 0, boxSizing: "border-box", border: "1px solid #354258", borderRadius: 8,
  padding: "8px 9px", background: "#080d14", color: "#edf3fc", fontSize: 14,
};
const muted: CSSProperties = { color: "#9eacc1", fontSize: 12, lineHeight: 1.5 };

function parseInt32(raw: string, label: string): number {
  if (!raw.trim()) throw new Error(`${label} 不能为空。`);
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < -2147483648 || value > 2147483647) {
    throw new Error(`${label} 必须是 -2147483648 至 2147483647 之间的整数。`);
  }
  return value;
}

export function WolfVariableDebugger({ visible, gameId, gameTitle, frameRef, onClose }: PanelProps) {
  const pending = useRef(new Map<string, PendingRequest>());
  const [capabilities, setCapabilities] = useState<DebugResponse["capabilities"]>();
  const [catalog, setCatalog] = useState<WolfVariableCatalog | null>(null);
  const [group, setGroup] = useState<ActiveGroup>("sys");
  const [sysBase, setSysBase] = useState<number | null>(null);
  const [sysRows, setSysRows] = useState<DebugRow[]>([]);
  const [vBase, setVBase] = useState<number | null>(null);
  const [vRows, setVRows] = useState<DebugRow[]>([]);
  const [v16, setV16] = useState("0");
  const [v17, setV17] = useState("");
  const [v18, setV18] = useState("-1");
  const [v19, setV19] = useState("57");
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [frozen, setFrozen] = useState<Record<string, true>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const request = useCallback((command: DebugCommand, args: Record<string, unknown> = {}) => {
    const target = frameRef.current?.contentWindow;
    if (!target) return Promise.reject(new Error("游戏画面尚未就绪。"));
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise<DebugResponse>((resolve, reject) => {
      const longCommand = command === "variable-catalog" || command === "sys-time-feature-scan" || command === "wolf-variable-base-detect";
      const timeout = window.setTimeout(() => {
        pending.current.delete(requestId);
        reject(new Error("游戏运行时没有响应；请确认游戏仍在运行。"));
      }, longCommand ? 180000 : 12000);
      pending.current.set(requestId, { resolve, reject, timeout });
      try {
        target.postMessage({ type: "aetherplay-debug-command", requestId, gameId, command, ...args }, window.location.origin);
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
      else item.reject(new Error(response.error || "变量操作失败。"));
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      for (const item of pending.current.values()) {
        window.clearTimeout(item.timeout);
        item.reject(new Error("调试面板已关闭。"));
      }
      pending.current.clear();
    };
  }, [frameRef, gameId]);

  const loadCatalog = useCallback(async () => {
    const response = await request("variable-catalog");
    setCatalog(response.variableCatalog ?? null);
  }, [request]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setBusy("连接游戏…");
    setError("");
    Promise.all([request("probe"), loadCatalog()]).then(([probe]) => {
      if (cancelled) return;
      setCapabilities(probe.capabilities);
      setNotice("已连接。选择 Sys 或 V，定位后即可修改数值。");
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (!cancelled) setBusy(""); });
    return () => { cancelled = true; };
  }, [visible, request, loadCatalog]);

  const locateSys = async () => {
    setBusy("自动定位 Sys 表：采集时间特征…"); setError(""); setNotice("");
    setSysBase(null); setSysRows([]);
    try {
      const first = await request("sys-time-feature-scan", { sysTimePhase: "baseline" });
      const baseline = first.sysTimeFeatureScan;
      if (!baseline || baseline.baselineCandidateCount === 0) {
        throw new Error("没有发现 Sys28–Sys30 时间特征。请进入实际游戏场景，运行几秒后再试。");
      }
      if (baseline.truncated) {
        throw new Error("候选过多，无法完整验证；为避免选错地址，本次不自动定位。");
      }
      setBusy(`初筛完成（${baseline.baselineCandidateCount} 个候选），等待游戏时间推进…`);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 2200));
      setBusy("复核 Sys28–Sys30 的帧数与时钟变化…");
      const second = await request("sys-time-feature-scan", { sysTimePhase: "compare" });
      const comparison = second.sysTimeFeatureScan;
      if (!comparison || comparison.candidateCount !== 1 || comparison.truncated || comparison.candidates.length !== 1) {
        throw new Error(`时间差分验证未得到唯一候选（通过 ${comparison?.candidateCount ?? 0} 个）。没有读取或修改任何变量。`);
      }
      const base = comparison.candidates[0].base;
      const read = await request("sys-variable-range-read", { sysVariableBase: base, sysVariableCount: WOLF_SYSTEM_VARIABLE_COUNT });
      if (!read.sysVariables) throw new Error("Sys 基址已定位，但运行时没有返回完整变量表。");
      setSysBase(base);
      setSysRows(read.sysVariables.rows);
      setGroup("sys");
      setNotice(`已定位 Sys0–Sys163；基址 0x${base.toString(16).toUpperCase()}。只读变量已自动保护。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(""); }
  };

  const locateV = async () => {
    setBusy("正在定位 V0–V64…"); setError(""); setNotice("");
    setVBase(null); setVRows([]);
    try {
      const values = [parseInt32(v16, "V16"), parseInt32(v17, "V17"), parseInt32(v18, "V18"), parseInt32(v19, "V19")];
      const response = await request("wolf-variable-base-detect", {
        anchorValue: values[1], v16Value: values[0], v18Value: values[2], v19Value: values[3],
      });
      const detection = response.wolfVariableBaseDetection;
      if (!detection || detection.candidateCount !== 1 || detection.truncated || detection.candidates.length !== 1) {
        throw new Error(`V 表定位需要唯一候选；当前找到 ${detection?.candidateCount ?? 0} 个。请核对 V16–V19 的当前值。`);
      }
      const base = detection.candidates[0].base;
      const read = await request("wolf-variable-range-read", { variableBase: base, variableCount: 65 });
      if (!read.wolfVariables) throw new Error("V 表候选通过扫描，但范围复读失败。");
      setVBase(base);
      setVRows(read.wolfVariables.rows);
      setGroup("v");
      setNotice(`已定位 V0–V64；基址 0x${base.toString(16).toUpperCase()}。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(""); }
  };

  const refresh = async () => {
    setBusy("正在刷新变量…"); setError("");
    try {
      if (group === "sys") {
        if (sysBase === null) throw new Error("请先自动定位 Sys 表。");
        const response = await request("sys-variable-range-read", { sysVariableBase: sysBase, sysVariableCount: WOLF_SYSTEM_VARIABLE_COUNT });
        if (!response.sysVariables) throw new Error("Sys 表读取失败。");
        setSysRows(response.sysVariables.rows);
      } else {
        if (vBase === null) throw new Error("请先定位 V 表。");
        const response = await request("wolf-variable-range-read", { variableBase: vBase, variableCount: 65 });
        if (!response.wolfVariables) throw new Error("V 表读取失败。");
        setVRows(response.wolfVariables.rows);
      }
      setNotice("已刷新当前值。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  };

  const writeValue = async (row: DisplayRow) => {
    const raw = edits[row.key] ?? String(row.value);
    let value: number;
    try { value = parseInt32(raw, row.key); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
    setBusy(`正在写入 ${row.key}…`); setError(""); setNotice("");
    try {
      let actual = value;
      if (group === "sys") {
        if (sysBase === null) throw new Error("Sys 表尚未定位。");
        const response = await request("sys-variable-write", {
          sysVariableBase: sysBase, sysVariableCount: WOLF_SYSTEM_VARIABLE_COUNT,
          variableId: row.id, expectedValue: row.value, value,
        });
        if (!response.sysVariableWrite) throw new Error("运行时没有返回 Sys 写入复读结果。");
        actual = response.sysVariableWrite.immediateValue;
        setSysRows((old) => old.map((item) => item.id === row.id ? { ...item, value: actual } : item));
      } else {
        if (vBase === null) throw new Error("V 表尚未定位。");
        const response = await request("wolf-variable-write", {
          variableBase: vBase, variableCount: 65, variableId: row.id,
          expectedValue: row.value, value,
        });
        if (!response.wolfVariableWrite) throw new Error("运行时没有返回 V 写入复读结果。");
        actual = response.wolfVariableWrite.immediateValue;
        setVRows((old) => old.map((item) => item.id === row.id ? { ...item, value: actual } : item));
      }
      setEdits((old) => ({ ...old, [row.key]: String(actual) }));
      setNotice(`${row.key} 已写入并立即复读：${actual}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  };

  const toggleFreeze = async (row: DisplayRow) => {
    const exists = Boolean(frozen[row.key]);
    setBusy(exists ? `解除 ${row.key} 锁定…` : `锁定 ${row.key}…`); setError("");
    try {
      if (exists) {
        await request("freeze-remove", { scanType: "i32", offset: row.address });
        setFrozen((old) => { const next = { ...old }; delete next[row.key]; return next; });
        setNotice(`${row.key} 已解除锁定。`);
      } else {
        await request("freeze-add", { scanType: "i32", offset: row.address, value: row.value });
        setFrozen((old) => ({ ...old, [row.key]: true }));
        setNotice(`${row.key} 已锁定为 ${row.value}。`);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  };

  const allRows = useMemo<DisplayRow[]>(() => {
    if (group === "sys") {
      return sysRows.flatMap((row) => {
        const definition = WOLF_SYSTEM_VARIABLE_BY_ID.get(row.id);
        return definition ? [{ key: `Sys${row.id}`, id: row.id, label: definition.name, value: row.value, address: row.address, readOnly: definition.readOnly }] : [];
      });
    }
    const names = new Map<number, string>();
    const normalGroup = catalog?.groups.find((item) => item.id === "normal");
    for (const item of normalGroup?.variables ?? []) {
      const match = item.id.match(/^V(\d+)$/i);
      if (match) names.set(Number(match[1]), item.name || item.displayName);
    }
    return vRows.map((row) => ({
      key: `V${row.id}`, id: row.id, label: names.get(row.id) ?? `V${row.id}`,
      value: row.value, address: row.address, readOnly: false,
    }));
  }, [group, sysRows, vRows, catalog]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return allRows;
    return allRows.filter((row) => row.key.toLocaleLowerCase().includes(query) || row.label.toLocaleLowerCase().includes(query));
  }, [allRows, search]);

  return (
    <div style={{ ...panel, display: visible ? "flex" : "none" }} role="dialog" aria-label="变量调试">
      <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid #263449" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>变量调试</div>
          <div style={muted}>{gameTitle} · {capabilities?.memoryAvailable ? `${Math.round((capabilities.heapBytes ?? 0) / 1048576)} MiB WASM` : "等待运行时"}</div>
        </div>
        <button type="button" style={button} onClick={onClose}>关闭</button>
      </header>

      <div style={{ display: "flex", gap: 8, padding: 10, borderBottom: "1px solid #263449" }}>
        <button type="button" style={{ ...button, flex: 1, background: group === "sys" ? "#28543f" : button.background }} onClick={() => setGroup("sys")}>系统变量 Sys</button>
        <button type="button" style={{ ...button, flex: 1, background: group === "v" ? "#28543f" : button.background }} onClick={() => setGroup("v")}>常规变量 V</button>
      </div>

      <div style={{ padding: 12, overflowY: "auto", flex: 1 }}>
        {group === "sys" ? (
          <section style={{ padding: 11, background: "#111a27", border: "1px solid #2a3a50", borderRadius: 11, marginBottom: 11 }}>
            <div style={{ fontWeight: 750, fontSize: 14 }}>Sys 自动定位</div>
            <p style={{ ...muted, margin: "5px 0 9px" }}>利用 Sys28 帧数、Sys29 秒数、Sys30 毫秒数的连续变化定位。只接受唯一候选；无法确认时不会开放写入。</p>
            <button type="button" style={{ ...button, width: "100%", background: "#28543f" }} disabled={Boolean(busy) || !capabilities?.memoryAvailable} onClick={() => void locateSys()}>
              {sysBase === null ? "自动定位并读取 Sys0–Sys163" : "重新定位 Sys 表"}
            </button>
            {sysBase !== null ? <div style={{ ...muted, marginTop: 6 }}>基址：0x{sysBase.toString(16).toUpperCase().padStart(8, "0")} · {sysRows.length} 个槽位</div> : null}
          </section>
        ) : (
          <section style={{ padding: 11, background: "#111a27", border: "1px solid #2a3a50", borderRadius: 11, marginBottom: 11 }}>
            <div style={{ fontWeight: 750, fontSize: 14 }}>V 表定位</div>
            <p style={{ ...muted, margin: "5px 0 8px" }}>输入当前游戏中 V16–V19 的实际值。定位成功并复读后才允许写入。</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
              <label style={muted}>V16<input style={input} inputMode="numeric" value={v16} onChange={(e) => setV16(e.target.value)} /></label>
              <label style={muted}>V17<input style={input} inputMode="numeric" value={v17} onChange={(e) => setV17(e.target.value)} placeholder="当前值" /></label>
              <label style={muted}>V18<input style={input} inputMode="numeric" value={v18} onChange={(e) => setV18(e.target.value)} /></label>
              <label style={muted}>V19<input style={input} inputMode="numeric" value={v19} onChange={(e) => setV19(e.target.value)} /></label>
            </div>
            <button type="button" style={{ ...button, width: "100%", marginTop: 9, background: "#28543f" }} disabled={Boolean(busy) || !capabilities?.memoryAvailable} onClick={() => void locateV()}>
              {vBase === null ? "定位并读取 V0–V64" : "重新定位 V 表"}
            </button>
            {vBase !== null ? <div style={{ ...muted, marginTop: 6 }}>基址：0x{vBase.toString(16).toUpperCase().padStart(8, "0")} · {vRows.length} 个槽位</div> : null}
          </section>
        )}

        <div style={{ display: "flex", gap: 7, marginBottom: 9 }}>
          <input style={{ ...input, flex: 1 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索变量编号或名称" />
          <button type="button" style={button} disabled={Boolean(busy) || (group === "sys" ? sysBase === null : vBase === null)} onClick={() => void refresh()}>刷新</button>
        </div>

        {busy ? <div style={{ ...muted, padding: "5px 1px" }}>{busy}</div> : null}
        {error ? <div role="alert" style={{ padding: 9, marginBottom: 9, color: "#fecaca", background: "#431d24", borderRadius: 8, fontSize: 12 }}>{error}</div> : null}
        {notice ? <div style={{ padding: 8, marginBottom: 9, color: "#bbf7d0", background: "#142c23", borderRadius: 8, fontSize: 12 }}>{notice}</div> : null}

        {allRows.length === 0 ? (
          <div style={{ ...muted, padding: 18, textAlign: "center" }}>{group === "sys" ? "尚未定位 Sys 表。" : "尚未定位 V 表，或当前游戏没有可读取的 V 变量目录。"}</div>
        ) : visibleRows.length === 0 ? (
          <div style={{ ...muted, padding: 18, textAlign: "center" }}>没有匹配的变量。</div>
        ) : visibleRows.map((row) => {
          const locked = Boolean(frozen[row.key]);
          return (
            <div key={row.key} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(82px, 112px) auto auto", alignItems: "center", gap: 6, padding: "8px 0", borderBottom: "1px solid #1e2a3b" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 750 }}>{row.key}{row.readOnly ? <span style={{ color: "#9eacc1", fontWeight: 500 }}> · 只读</span> : null}</div>
                <div style={{ ...muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.label}</div>
              </div>
              <input
                style={{ ...input, padding: "7px 6px", textAlign: "right" }}
                inputMode="numeric"
                disabled={row.readOnly}
                value={edits[row.key] ?? String(row.value)}
                onChange={(event) => setEdits((old) => ({ ...old, [row.key]: event.target.value }))}
              />
              <button type="button" style={{ ...button, padding: "7px 8px" }} disabled={Boolean(busy) || row.readOnly || (group === "sys" ? sysBase === null : vBase === null)} onClick={() => void writeValue(row)}>写入</button>
              <button type="button" style={{ ...button, padding: "7px 8px", background: locked ? "#59451c" : button.background }} disabled={Boolean(busy) || row.readOnly} onClick={() => void toggleFreeze(row)}>{locked ? "解锁" : "锁定"}</button>
            </div>
          );
        })}
        <p style={{ ...muted, marginTop: 12 }}>当前面板专注数值型 Sys / V。系统变量只读状态来自 WOLF 官方变量说明；未明确标记可写的编号不会开放修改。SysS、Self、CSelf 和字符串内存表将在确认其运行时布局后接入。</p>
      </div>
    </div>
  );
}
