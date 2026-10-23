import { describe, expect, it } from "vitest";
import { buildWolfVariableCatalog, parseCommonEventVariableGroups, parseWolfDatabaseProject } from "./variableCatalog";

function u32(value: number): number[] {
  return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
}
function tstr(value: string): number[] {
  const bytes = [...new TextEncoder().encode(value), 0];
  return [...u32(bytes.length), ...bytes];
}
function tstrBytes(bytes: number[]): number[] {
  return [...u32(bytes.length + 1), ...bytes, 0];
}
function commonEvent(shiftJisVariableName = false): Uint8Array {
  const out: number[] = [0x00, 0x57, 0x00, 0x00, 0x4f, 0x4c, 0x55, 0x46, 0x43, 0x00, 0x01, ...u32(1)];
  out.push(0x8e, ...u32(500001), 0x00, ...u32(0), ...u32(0), 0, 0);
  out.push(...tstr("Test common event"), ...u32(0)); // title, command count
  out.push(1, 0, 0, 0, 0, ...tstr(""), 0x8f); // fixed marker, memo, separator
  out.push(...u32(0), ...u32(0), ...u32(0), ...u32(0), ...u32(0)); // arguments / option pages
  out.push(0x90, ...u32(0)); // separator, colour
  for (let index = 0; index < 100; index += 1) {
    if (index === 5 && shiftJisVariableName) out.push(...tstrBytes([0x96, 0xbc, 0x91, 0x4f])); // 名前 in CP932
    else out.push(...tstr(index === 5 ? "Potion label" : ""));
  }
  out.push(0x91, 1, 0, 0, 0, 0, 0x92, ...tstr(""), ...u32(0), 0x92, 0x8f);
  return Uint8Array.from(out);
}
function newProject(shiftJisVariableName = false): Uint8Array {
  const out: number[] = [...u32(24)];
  const titlesByType: Record<number, string[]> = {
    4: ["姓名", "台词"], 5: ["系统提示"], 6: ["所持金"], 14: ["HP", "MP"], 15: ["金钱预备"],
  };
  for (let type = 0; type < 24; type += 1) {
    const titles = titlesByType[type] ?? [];
    out.push(...tstr(`类型${type}`));
    out.push(...u32(0)); // property count
    out.push(...u32(titles.length));
    for (const title of titles) {
      if (shiftJisVariableName && type === 14 && title === "HP") out.push(...tstrBytes([0x96, 0xbc, 0x91, 0x4f])); // 名前 in CP932
      else out.push(...tstr(title));
    }
    out.push(...tstr("")); // memo
    out.push(...u32(100), ...new Array(100).fill(0));
    out.push(...u32(0)); // common string table
    out.push(...u32(0)); // special strings length == properties
    out.push(...u32(0)); // special values length == properties
    out.push(...u32(0)); // default value length == properties
  }
  return Uint8Array.from(out);
}

describe("WOLF variable catalog metadata", () => {
  it("maps SysDataBase project types to stable WOLF variable categories", () => {
    const parsed = parseWolfDatabaseProject(newProject());
    expect(parsed.types).toHaveLength(24);
    const source = "Data/BasicData/SysDataBase.project";
    const catalog = buildWolfVariableCatalog([source], (path) => path === source ? newProject() : undefined);
    const get = (id: string) => catalog.groups.find((group) => group.id === id);
    expect(get("string")?.variables.map((v) => [v.id, v.name, v.valueType])).toEqual([
      ["S0", "姓名", "string"], ["S1", "台词", "string"],
    ]);
    expect(get("system-string")?.variables[0]).toMatchObject({ id: "SysS1", name: "系统提示", valueType: "string" });
    expect(get("system-number")?.variables[0]).toMatchObject({ id: "Sys0", name: "所持金", valueType: "number" });
    expect(get("normal")?.variables[0]).toMatchObject({ id: "V0", name: "HP", valueType: "number" });
    expect(get("spare-1")?.variables[0]).toMatchObject({ id: "V1-0", name: "金钱预备", valueType: "number" });
  });

  it("parses CommonEvent CSelf names and the special string slots", () => {
    const groups = parseCommonEventVariableGroups(commonEvent(), "Data/BasicData/CommonEvent.dat");
    expect(groups).toHaveLength(1);
    expect(groups[0].commonEventId).toBe(500001);
    expect(groups[0].variables).toContainEqual(expect.objectContaining({ id: "CSelf5", name: "Potion label", valueType: "string" }));
  });

  it("decodes Shift-JIS CSelf names instead of displaying mojibake", () => {
    const groups = parseCommonEventVariableGroups(commonEvent(true), "Data/BasicData/CommonEvent.dat");
    expect(groups[0].variables).toContainEqual(expect.objectContaining({ id: "CSelf5", name: "名前", valueType: "string" }));
  });

  it("detects Shift-JIS database project names and preserves Japanese characters", () => {
    const parsed = parseWolfDatabaseProject(newProject(true));
    expect(parsed.encoding).toBe("shift_jis");
    expect(parsed.types[14].dataTitles[0]).toBe("名前");
    const source = "Data/BasicData/SysDataBase.project";
    const catalog = buildWolfVariableCatalog([source], (path) => path === source ? newProject(true) : undefined);
    expect(catalog.groups.find((group) => group.id === "normal")?.variables[0].name).toBe("名前");
  });

  it("keeps map Self slots contextual and exposes CSelf string slots correctly", () => {
    const source = "Data/BasicData/SysDataBase.project";
    const catalog = buildWolfVariableCatalog([source], (path) => path === source ? newProject() : undefined);
    const mapSelf = catalog.groups.find((group) => group.id === "map-self");
    const commonSelf = catalog.groups.find((group) => group.id === "common-self-template");
    expect(mapSelf?.variables).toHaveLength(10);
    expect(mapSelf?.variables.every((v) => v.valueType === "number")).toBe(true);
    expect(commonSelf?.variables[5].valueType).toBe("string");
    expect(commonSelf?.variables[9].valueType).toBe("string");
    expect(commonSelf?.variables[10].valueType).toBe("number");
  });
});
