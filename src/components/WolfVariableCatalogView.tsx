import { useState } from "react";
import type { CSSProperties } from "react";
import type { WolfVariableCatalog } from "@/player-runtime/engines/wolf/variableCatalog";

interface WolfVariableCatalogViewProps {
  catalog: WolfVariableCatalog | null;
  loading: boolean;
  onLoad: () => void;
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

export function WolfVariableCatalogView({ catalog, loading, onLoad }: WolfVariableCatalogViewProps) {
  const [selectedGroupId, setSelectedGroupId] = useState("normal");
  const [query, setQuery] = useState("");
  if (!catalog) {
    return (
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
                <span style={{ flexShrink: 0, border: "1px solid #354258", borderRadius: 7, padding: "4px 7px", fontSize: 11, color: item.valueType === "string" ? "#d6b7ff" : "#b8f3da" }}>
                  {item.valueType === "string" ? "字符串" : "数值"}
                </span>
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
