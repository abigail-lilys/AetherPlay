import { useState } from "react";
import type { CSSProperties } from "react";
import type { WolfVariableCatalog } from "@/player-runtime/engines/wolf/variableCatalog";
import type { WolfHpPointerChainSnapshot } from "@/player-runtime/engines/wolf/hpPointerChain";

export interface WolfVariableProbeTarget {
  id: string;
  name: string;
  displayName: string;
  index: number;
  scope?: string;
  groupId: string;
  groupTitle: string;
  valueType: "number" | "string";
}

interface ProbeScanSummary {
  scanType: string;
  count: number;
  scannedBytes: number;
  truncated: boolean;
  page: number;
  pageCount: number;
  unknownBaselinePending: boolean;
  scanStartOffset: number;
  scanEndOffset: number;
}

interface ProbeScanResult {
  offset: number;
  value: number;
}

interface SavedProbeSet {
  key: string;
  id: string;
  label: string;
  index: number;
  groupId: string;
  groupTitle: string;
  count: number;
  pageCount: number;
  pages: number[];
  offsets: number[];
  truncated: boolean;
}

interface WolfVariableCatalogViewProps {
  catalog: WolfVariableCatalog | null;
  loading: boolean;
  onLoad: () => void;
  hpChain: WolfHpPointerChainSnapshot | null;
  hpChainBusy: boolean;
  onRefreshHpChain: () => void;
  onWriteHpChain: (value: string) => void;
  probeTarget: WolfVariableProbeTarget | null;
  probeSummary: ProbeScanSummary | null;
  probeResults: ProbeScanResult[];
  onStartVariableProbe: (target: WolfVariableProbeTarget) => void;
  onFilterVariableChanges: () => void;
  onMatchVariableCurrentValue: (value: string) => void;
  onLoadProbePage: (page: number) => void;
  onExportProbePage: () => void;
}

const cardStyle: CSSProperties = {
  background: "#111a27", border: "1px solid #253247", borderRadius: 14, padding: 13,
};
const mutedStyle: CSSProperties = { color: "#9eacc1", fontSize: 12 };
const controlStyle: CSSProperties = {
  width: "100%", boxSizing: "border-box", border: "1px solid #354258", borderRadius: 9,
  padding: "9px 10px", background: "#080d14", color: "#edf3fc", fontSize: 13,
};
const buttonStyle: CSSProperties = {
  border: "1px solid #354258", borderRadius: 10, padding: "9px 12px", color: "#eaf1fc",
  background: "#182335", fontSize: 13, fontWeight: 650, cursor: "pointer",
};

function formatAddress(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(8, "0")}`;
}

export function WolfVariableCatalogView({
  catalog, loading, onLoad, hpChain, hpChainBusy, onRefreshHpChain, onWriteHpChain,
  probeTarget, probeSummary, probeResults,
  onStartVariableProbe, onFilterVariableChanges,
  onMatchVariableCurrentValue, onLoadProbePage, onExportProbePage,
}: WolfVariableCatalogViewProps) {
  const [selectedGroupId, setSelectedGroupId] = useState("normal");
  const [query, setQuery] = useState("");
  const [targetHp, setTargetHp] = useState("999");
  const [probeValue, setProbeValue] = useState("");
  const [savedProbeSets, setSavedProbeSets] = useState<SavedProbeSet[]>([]);
  const hpTargetNumber = Number(targetHp.trim());
  const hpTargetValid = /^-?\d+$/u.test(targetHp.trim())
    && Number.isSafeInteger(hpTargetNumber)
    && hpTargetNumber >= -2147483648 && hpTargetNumber <= 2147483647;

  const hpPanel = (
    <div style={{ ...cardStyle, borderColor: "#42618a" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 750 }}>实时变量：HP</div>
        <span style={{ ...mutedStyle, whiteSpace: "nowrap" }}>WOLF / Int32</span>
      </div>
      <p style={{ ...mutedStyle, lineHeight: 1.6, margin: "8px 0 10px" }}>
        动态指针链：0x0045E598 → p1 + 0x84 → p2 → p3 + 0x08。每次读取和写入都会重新解析指针。
      </p>
      {hpChain ? (
        <div style={{ border: "1px solid #253247", borderRadius: 10, padding: 10, marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <span style={mutedStyle}>当前 HP</span>
            <strong style={{ fontSize: 25, color: "#b8f3da" }}>{hpChain.hpValue}</strong>
          </div>
          <div style={{ ...mutedStyle, marginTop: 7, lineHeight: 1.7, overflowWrap: "anywhere" }}>
            根地址 {formatAddress(hpChain.rootOffset)} → p1 {formatAddress(hpChain.p1)}<br />
            指针槽 {formatAddress(hpChain.slotOffset)} → p2 {formatAddress(hpChain.p2)}<br />
            p3 {formatAddress(hpChain.p3)} → HP 地址 {formatAddress(hpChain.hpAddress)}
          </div>
          <div style={{ ...mutedStyle, marginTop: 6 }}>
            内存 {Math.round(hpChain.memoryBytes / 1048576)} MiB · {new Date(hpChain.resolvedAt).toLocaleTimeString()}
          </div>
        </div>
      ) : (
        <div style={{ ...mutedStyle, lineHeight: 1.6, marginBottom: 10 }}>
          尚未读取当前游戏的 HP。读取时会检查每级指针和内存边界。
        </div>
      )}
      <button type="button" disabled={hpChainBusy} onClick={onRefreshHpChain} style={{ ...buttonStyle, width: "100%" }}>
        {hpChainBusy ? "正在解析指针链…" : hpChain ? "重新读取实时 HP" : "读取实时 HP"}
      </button>
      <label style={{ ...mutedStyle, display: "flex", flexDirection: "column", gap: 5, marginTop: 10 }}>
        新 HP（Int32）
        <input type="number" step="1" value={targetHp}
          onChange={(event) => setTargetHp(event.target.value)} style={controlStyle} />
      </label>
      <button type="button" disabled={!hpChain || hpChainBusy || !hpTargetValid}
        onClick={() => onWriteHpChain(targetHp)}
        style={{ ...buttonStyle, width: "100%", marginTop: 8, borderColor: "#4b7a68" }}>
        写入 HP 并回读验证
      </button>
      <div style={{ ...mutedStyle, lineHeight: 1.6, marginTop: 8 }}>
        写入前会重新解析指针链，并确认 HP 仍等于记录值；旧值不匹配就取消写入。根址跨完整游戏重启的稳定性仍需实测。
      </div>
    </div>
  );
  const saveProbeCandidatePage = () => {
    if (!probeTarget || !probeSummary || probeResults.length === 0) return;

    const key = `${probeTarget.groupId}:${probeTarget.id}`;
    setSavedProbeSets((old) => {
      const current = old.find((item) => item.key === key);
      const offsets = [...new Set([
        ...(current?.offsets ?? []),
        ...probeResults.map((item) => item.offset),
      ])].slice(0, 5000);

      const pages = [...new Set([
        ...(current?.pages ?? []),
        probeSummary.page,
      ])].sort((a, b) => a - b);

      const saved: SavedProbeSet = {
        key,
        id: probeTarget.id,
        label: probeTarget.displayName,
        index: probeTarget.index,
        groupId: probeTarget.groupId,
        groupTitle: probeTarget.groupTitle,
        count: probeSummary.count,
        pageCount: probeSummary.pageCount,
        pages,
        offsets,
        truncated: probeSummary.truncated || probeSummary.count > offsets.length,
      };

      return current
        ? old.map((item) => item.key === key ? saved : item)
        : [...old, saved];
    });
  };

  const strideRelations: Array<{
    left: SavedProbeSet;
    right: SavedProbeSet;
    leftOffset: number;
    rightOffset: number;
    stride: number;
  }> = [];

  for (let i = 0; i < savedProbeSets.length; i += 1) {
    for (let j = i + 1; j < savedProbeSets.length; j += 1) {
      const left = savedProbeSets[i];
      const right = savedProbeSets[j];

      if (left.groupId !== right.groupId || left.index === right.index) continue;

      // Hypothesis under test: adjacent numeric variable slots are 4 bytes apart.
      const stride = (right.index - left.index) * 4;
      const rightOffsets = new Set(right.offsets);

      for (const leftOffset of left.offsets) {
        const rightOffset = leftOffset + stride;
        if (!rightOffsets.has(rightOffset)) continue;

        strideRelations.push({ left, right, leftOffset, rightOffset, stride });
        if (strideRelations.length >= 100) break;
      }
      if (strideRelations.length >= 100) break;
    }
    if (strideRelations.length >= 100) break;
  }

  const probePanel = (
    <div style={{ ...cardStyle, borderColor: "#42618a" }}>
      <div style={{ fontSize: 15, fontWeight: 750 }}>
        普通数值变量存储定位实验
      </div>
      <p style={{ ...mutedStyle, lineHeight: 1.65, margin: "8px 0 10px" }}>
        选择 V0、V1 等数值变量，在游戏中触发一次确定的变量变化，再筛选内存变化位置。首轮快照覆盖 WASM 内存前 64 MiB，以减少 Android 内存压力。
        候选地址不等于已确认的变量地址；本实验不会自动写入这些候选位置。
      </p>

      {probeTarget ? (
        <div style={{ border: "1px solid #354258", borderRadius: 10, padding: 10, marginBottom: 10 }}>
          <div style={{ fontWeight: 700 }}>{probeTarget.displayName}</div>
          <div style={{ ...mutedStyle, marginTop: 4 }}>
            类别：{probeTarget.groupTitle} · 索引：{probeTarget.index}
          </div>
          {probeSummary ? (
            <>
              <div style={{ ...mutedStyle, marginTop: 7 }}>
                扫描范围：0x{probeSummary.scanStartOffset.toString(16).toUpperCase().padStart(8, "0")}
                {" – "}
                0x{probeSummary.scanEndOffset.toString(16).toUpperCase().padStart(8, "0")}
              </div>
              <div style={{ ...mutedStyle, marginTop: 4 }}>
                候选数：{probeSummary.count.toLocaleString()} ·
                {" "}结果页：{probeSummary.page + 1}/{probeSummary.pageCount}
                {probeSummary.truncated ? " · 候选结果已截断" : ""}
              </div>
              <div style={{ ...mutedStyle, marginTop: 4 }}>
                {probeSummary.unknownBaselinePending
                  ? "第一步完成：基线快照已保存。返回游戏执行能改变该变量的操作，再回来筛选变化。"
                  : "基线已用于筛选。可继续改变同一变量，再筛选变化；也可用当前实际数值进一步收敛。"}
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <div style={{ ...mutedStyle, lineHeight: 1.6, marginBottom: 10 }}>
          尚未选择变量。请在下面的变量列表中选择一个数值变量并点击“定位试验”。
        </div>
      )}

      <button
        type="button"
        disabled={loading || !probeTarget || !probeSummary}
        onClick={onFilterVariableChanges}
        style={{ ...buttonStyle, width: "100%" }}
      >
        筛选本次变化
      </button>

      <label style={{ ...mutedStyle, display: "flex", flexDirection: "column", gap: 5, marginTop: 10 }}>
        该变量变化后的实际数值（Int32）
        <input
          type="number"
          step="1"
          value={probeValue}
          onChange={(event) => setProbeValue(event.target.value)}
          placeholder="例如游戏中当前显示的数值"
          style={controlStyle}
        />
      </label>
      <button
        type="button"
        disabled={
          loading || !probeTarget || !probeSummary ||
          probeSummary.unknownBaselinePending || probeSummary.count === 0 ||
          probeValue.trim() === "" ||
          !Number.isSafeInteger(Number(probeValue)) ||
          Number(probeValue) < -2147483648 ||
          Number(probeValue) > 2147483647
        }
        onClick={() => onMatchVariableCurrentValue(probeValue)}
        style={{ ...buttonStyle, width: "100%", marginTop: 8 }}
      >
        按当前数值收敛候选
      </button>

      {probeSummary && probeSummary.count > 0 ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>当前候选位置</div>
          {probeResults.slice(0, 30).map((item) => (
            <div key={item.offset} style={{
              display: "flex", justifyContent: "space-between", gap: 8,
              padding: "7px 0", borderBottom: "1px solid #202b3a",
              fontSize: 12,
            }}>
              <code style={{ color: "#9fc6ff" }}>{formatAddress(item.offset)}</code>
              <span>当前值：{item.value}</span>
            </div>
          ))}
          {probeResults.length > 30 ? (
            <div style={{ ...mutedStyle, marginTop: 5 }}>
              当前页共有 {probeResults.length} 项，仅展示前 30 项。
            </div>
          ) : null}

          {probeSummary.pageCount > 1 ? (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button
                type="button"
                disabled={loading || probeSummary.page <= 0}
                onClick={() => onLoadProbePage(probeSummary.page - 1)}
                style={{ ...buttonStyle, flex: 1 }}
              >上一页</button>
              <button
                type="button"
                disabled={loading || probeSummary.page + 1 >= probeSummary.pageCount}
                onClick={() => onLoadProbePage(probeSummary.page + 1)}
                style={{ ...buttonStyle, flex: 1 }}
              >下一页</button>
            </div>
          ) : null}

          <button
            type="button"
            disabled={loading}
            onClick={saveProbeCandidatePage}
            style={{ ...buttonStyle, width: "100%", marginTop: 10 }}
          >
            保存本页候选，用于跨变量比较
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onExportProbePage}
            style={{ ...buttonStyle, width: "100%", marginTop: 8 }}
          >
            导出本页定位 JSON
          </button>
        </div>
      ) : null}

      {savedProbeSets.length > 0 ? (
        <div style={{ marginTop: 14, borderTop: "1px solid #354258", paddingTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>已保存的变量候选集</div>
          <div style={{ ...mutedStyle, lineHeight: 1.6, marginTop: 5 }}>
            分别对不同变量进行定位并保存结果页。比较编号差值与地址差值是否一致，可以检验它们是否可能属于同一连续数值数组。
          </div>
          {savedProbeSets.map((item) => (
            <div key={item.key} style={{
              border: "1px solid #253247", borderRadius: 8,
              padding: 9, marginTop: 8, overflowWrap: "anywhere",
            }}>
              <div style={{ fontSize: 12, fontWeight: 650 }}>{item.label}</div>
              <div style={{ ...mutedStyle, marginTop: 4 }}>
                候选：{item.offsets.length}/{item.count} · 已保存页：{item.pages.length}/{item.pageCount}
                {item.truncated ? " · 不完整候选集" : ""}
              </div>
            </div>
          ))}

          {strideRelations.length > 0 ? (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>发现可能的固定间距关系</div>
              {strideRelations.map((item, i) => (
                <div key={`${item.left.key}:${item.right.key}:${item.leftOffset}:${i}`}
                  style={{ ...mutedStyle, borderBottom: "1px solid #253247", padding: "8px 0", lineHeight: 1.6 }}>
                  {item.left.id} {formatAddress(item.leftOffset)}
                  {" → "}
                  {item.right.id} {formatAddress(item.rightOffset)}
                  {" · 地址差 "}
                  {item.stride > 0 ? "+" : ""}
                  {item.stride}
                  {" bytes"}
                </div>
              ))}
              <div style={{ ...mutedStyle, marginTop: 7 }}>
                这些只是与 4 字节索引间距吻合的候选关系，还需要第三个变量或实际修改验证，不能直接认定为真实变量数组。
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  if (!catalog) {
    return (
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {hpPanel}
        <div style={cardStyle}>
          <div style={{ fontSize: 15, fontWeight: 750 }}>WOLF 变量目录</div>
          <p style={{ ...mutedStyle, lineHeight: 1.6, margin: "8px 0 12px" }}>
            从游戏自带的 SysDataBase.project 和 CommonEvent.dat 读取变量名称与类型，并按 WOLF 的变量类别整理。首次读取可能需要从当前游戏资源加载元数据文件。
          </p>
          <button type="button" disabled={loading} onClick={onLoad} style={{ ...buttonStyle, width: "100%" }}>
            {loading ? "正在读取变量表…" : "读取游戏变量表"}
          </button>
        </div>
        <div style={{ ...cardStyle, ...mutedStyle, lineHeight: 1.6 }}>
          说明：变量定义中的名称/类型可以直接读取；当前变量值和 WASM 内存地址尚未一一关联，所以本页不会把猜测的地址伪装成变量。
        </div>
      </section>
    );
  }

  const validGroupId = catalog.groups.some((group) => group.id === selectedGroupId)
    ? selectedGroupId
    : catalog.groups[0]?.id ?? "all";
  const selectedGroup = catalog.groups.find((group) => group.id === validGroupId);
  const needle = query.trim().toLocaleLowerCase();
  const variables = (selectedGroup?.variables ?? []).filter((item) => {
    if (!needle) return true;
    return `${item.id} ${item.name} ${item.displayName} ${item.scope ?? ""}`.toLocaleLowerCase().includes(needle);
  });
  const displayed = variables.slice(0, 500);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {hpPanel}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 750 }}>WOLF 变量目录</div>
          <button type="button" disabled={loading} onClick={onLoad} style={buttonStyle}>{loading ? "读取中…" : "重新读取"}</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8, marginTop: 12 }}>
          <label style={{ ...mutedStyle, display: "flex", flexDirection: "column", gap: 5 }}>
            变量类别（{catalog.groups.length} 组）
            <select value={validGroupId} onChange={(event) => setSelectedGroupId(event.target.value)} style={controlStyle}>
              {catalog.groups.map((group) => <option key={group.id} value={group.id}>{group.title}（{group.count}）</option>)}
            </select>
          </label>
          <label style={{ ...mutedStyle, display: "flex", flexDirection: "column", gap: 5 }}>
            搜索名称或编号
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：HP、所持金、Sys8、CSelf5" style={controlStyle} />
          </label>
        </div>
        <div style={{ ...mutedStyle, marginTop: 10, lineHeight: 1.55 }}>
          来源：{catalog.sourceFiles.length ? catalog.sourceFiles.join("；") : "未找到变量元数据文件"}
          <div>共整理 {catalog.totalVariables.toLocaleString()} 个目录项；当前类别匹配 {variables.length.toLocaleString()} 项。</div>
        </div>
      </div>

      {probePanel}

      {catalog.warnings.length > 0 ? (
        <div style={{ ...cardStyle, color: "#ffd28a", fontSize: 12, lineHeight: 1.6 }}>
          {catalog.warnings.map((warning, index) => <div key={`${index}:${warning}`}>• {warning}</div>)}
        </div>
      ) : null}

      {selectedGroup ? (
        <div style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 750 }}>{selectedGroup.title}</div>
          {selectedGroup.note ? <div style={{ ...mutedStyle, marginTop: 5, lineHeight: 1.5 }}>{selectedGroup.note}</div> : null}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 10, ...mutedStyle }}>
            <span>变量编号 / 名称</span><span>类型</span>
          </div>
          <div style={{ borderTop: "1px solid #253247", marginTop: 6 }}>
            {displayed.map((item) => (
              <div key={`${selectedGroup.id}:${item.id}:${item.index}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, borderBottom: "1px solid #202b3a", padding: "10px 0" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <code style={{ color: "#9fc6ff", fontSize: 12 }}>{item.id}</code>
                  <div style={{ fontSize: 13, marginTop: 2, overflowWrap: "anywhere" }}>{item.name}</div>
                  {item.scope ? <div style={{ ...mutedStyle, marginTop: 2 }}>{item.scope}</div> : null}
                </div>
                <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                  <span style={{ border: "1px solid #354258", borderRadius: 7, padding: "4px 7px", fontSize: 11, color: item.valueType === "string" ? "#d6b7ff" : "#b8f3da" }}>
                    {item.valueType === "string" ? "字符串" : "数值"}
                  </span>
                  {selectedGroup.category === "variable" && item.valueType === "number" ? (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => onStartVariableProbe({
                        id: item.id,
                        name: item.name,
                        displayName: item.displayName,
                        index: item.index,
                        scope: item.scope,
                        groupId: selectedGroup.id,
                        groupTitle: selectedGroup.title,
                        valueType: item.valueType,
                      })}
                      style={{ ...buttonStyle, padding: "5px 7px", fontSize: 11, whiteSpace: "nowrap" }}
                    >定位试验</button>
                  ) : null}
                </div>
              </div>
            ))}
            {displayed.length === 0 ? <div style={{ ...mutedStyle, padding: 12 }}>这个类别没有匹配项。</div> : null}
            {variables.length > displayed.length ? <div style={{ ...mutedStyle, padding: 10 }}>为保证手机浏览流畅，仅展示前 500 项；请继续输入名称缩小结果。</div> : null}
          </div>
        </div>
      ) : null}

      <div style={{ ...cardStyle, ...mutedStyle, lineHeight: 1.6 }}>
        当前版本已读取静态名称和类型元数据。实时值/内存地址需要下一步从 WOLF 的变量访问路径或 WASM 内部存储建立映射；不能仅根据数值相同就认定地址对应某个变量。
      </div>
    </section>
  );
}
