export type WolfVariableValueType = "number" | "string";

export interface WolfVariableEntry {
  id: string;
  name: string;
  displayName: string;
  valueType: WolfVariableValueType;
  index: number;
  scope?: string;
  named: boolean;
}

export interface WolfVariableGroup {
  id: string;
  title: string;
  category: "variable" | "common-self" | "map-self";
  valueType: WolfVariableValueType | "mixed";
  sourcePath: string;
  variables: WolfVariableEntry[];
  count: number;
  note?: string;
}

export interface WolfVariableCatalog {
  groups: WolfVariableGroup[];
  sourceFiles: string[];
  warnings: string[];
  totalVariables: number;
}

export interface WolfDatabaseProjectType {
  index: number;
  name: string;
  fields: string[];
  dataTitles: string[];
  memo: string;
}

export interface WolfDatabaseProject {
  format: "database-project-v3" | "database-project-legacy";
  encoding: "utf-8" | "shift_jis";
  decrypted: boolean;
  types: WolfDatabaseProjectType[];
}

const MAX_PROJECT_TYPES = 256;
const MAX_FIELDS = 1000;
const MAX_DATA_TITLES = 100_000;
const MAX_STRING_BYTES = 4 * 1024 * 1024;
const MAX_COMMON_EVENTS = 3000;
const MAX_NAMED_COMMON_VARIABLES = 20_000;
const MAX_ASSET_BYTES = 32 * 1024 * 1024;

class BinaryReader {
  private readonly view: DataView;
  private pos = 0;
  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get offset(): number { return this.pos; }
  get remaining(): number { return this.bytes.byteLength - this.pos; }
  ensure(size: number): void {
    if (!Number.isSafeInteger(size) || size < 0 || size > this.remaining) {
      throw new Error(`WOLF 数据越界：偏移 ${this.pos}，请求 ${size} 字节，剩余 ${this.remaining} 字节。`);
    }
  }
  readU8(): number { this.ensure(1); return this.view.getUint8(this.pos++); }
  readU32(): number { this.ensure(4); const value = this.view.getUint32(this.pos, true); this.pos += 4; return value; }
  readI32(): number { this.ensure(4); const value = this.view.getInt32(this.pos, true); this.pos += 4; return value; }
  skip(size: number): void { this.ensure(size); this.pos += size; }
  readBytes(size: number): Uint8Array { this.ensure(size); const value = this.bytes.subarray(this.pos, this.pos + size); this.pos += size; return value; }
  readString(encoding: "utf-8" | "shift_jis"): string {
    const size = this.readU32();
    if (size > MAX_STRING_BYTES) throw new Error(`WOLF 字符串长度异常：${size} 字节。`);
    const bytes = this.readBytes(size);
    let decoded = "";
    try {
      decoded = new TextDecoder(encoding, { fatal: false }).decode(bytes);
    } catch {
      decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    }
    return decoded.replace(/\0+$/u, "");
  }
  readStringArray(encoding: "utf-8" | "shift_jis"): string[] {
    const count = this.readU32();
    if (count > MAX_DATA_TITLES) throw new Error(`WOLF 字符串数组数量异常：${count}。`);
    const values: string[] = [];
    for (let i = 0; i < count; i += 1) values.push(this.readString(encoding));
    return values;
  }
  readU32Array(): number[] {
    const count = this.readU32();
    if (count > MAX_DATA_TITLES) throw new Error(`WOLF 数值数组数量异常：${count}。`);
    const values: number[] = [];
    for (let i = 0; i < count; i += 1) values.push(this.readU32());
    return values;
  }
  readS32Array(): number[] {
    const count = this.readU32();
    if (count > MAX_FIELDS) throw new Error(`WOLF 默认值数量异常：${count}。`);
    const values: number[] = [];
    for (let i = 0; i < count; i += 1) values.push(this.readI32());
    return values;
  }
  trailingBytesAreZero(): boolean {
    for (let i = this.pos; i < this.bytes.byteLength; i += 1) if (this.bytes[i] !== 0) return false;
    return true;
  }
}

function validateCount(value: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`${label} 数量异常：${value}。`);
  return value;
}

function parseNewProject(bytes: Uint8Array): WolfDatabaseProject {
  const reader = new BinaryReader(bytes);
  const typeCount = validateCount(reader.readU32(), MAX_PROJECT_TYPES, "数据库类型");
  if (typeCount < 1) throw new Error("新版数据库 project 没有类型表。");
  const types: WolfDatabaseProjectType[] = [];
  for (let index = 0; index < typeCount; index += 1) {
    const name = reader.readString("utf-8");
    const propertyCount = validateCount(reader.readU32(), MAX_FIELDS, "数据库字段");
    const fields: string[] = [];
    for (let i = 0; i < propertyCount; i += 1) fields.push(reader.readString("utf-8"));
    const dataCount = validateCount(reader.readU32(), MAX_DATA_TITLES, "数据库数据名");
    const dataTitles: string[] = [];
    for (let i = 0; i < dataCount; i += 1) dataTitles.push(reader.readString("utf-8"));
    const memo = reader.readString("utf-8");
    const specialTypeCount = reader.readU32();
    if (specialTypeCount !== 100) throw new Error(`新版数据库类型 ${index} 的特殊函数表长度不是 100。`);
    reader.skip(specialTypeCount);
    reader.readStringArray("utf-8");
    const specialStringCount = reader.readU32();
    if (specialStringCount !== propertyCount) throw new Error(`新版数据库类型 ${index} 的特殊字符串字段数量不匹配。`);
    for (let i = 0; i < specialStringCount; i += 1) reader.readStringArray("utf-8");
    const specialValueCount = reader.readU32();
    if (specialValueCount !== propertyCount) throw new Error(`新版数据库类型 ${index} 的特殊数值字段数量不匹配。`);
    for (let i = 0; i < specialValueCount; i += 1) reader.readU32Array();
    const defaultValueCount = reader.readU32();
    if (defaultValueCount !== propertyCount) throw new Error(`新版数据库类型 ${index} 的默认值字段数量不匹配。`);
    for (let i = 0; i < defaultValueCount; i += 1) reader.readI32();
    types.push({ index, name, fields, dataTitles, memo });
  }
  if (reader.remaining > 0 && !reader.trailingBytesAreZero()) throw new Error("新版数据库 project 存在无法识别的尾部数据。");
  return { format: "database-project-v3", encoding: "utf-8", decrypted: false, types };
}

function parseLegacyProject(bytes: Uint8Array): WolfDatabaseProject {
  const reader = new BinaryReader(bytes);
  const typeCount = validateCount(reader.readU32(), MAX_PROJECT_TYPES, "旧版系统数据库类型");
  if (typeCount < 1) throw new Error("旧版数据库 project 没有类型表。");
  const types: WolfDatabaseProjectType[] = [];
  for (let index = 0; index < typeCount; index += 1) {
    const name = reader.readString("shift_jis");
    const propertyCount = validateCount(reader.readU32(), MAX_FIELDS, "旧版数据库字段");
    const fields: string[] = [];
    for (let i = 0; i < propertyCount; i += 1) fields.push(reader.readString("shift_jis"));
    const dataCount = validateCount(reader.readU32(), MAX_DATA_TITLES, "旧版数据库数据名");
    const dataTitles: string[] = [];
    for (let i = 0; i < dataCount; i += 1) dataTitles.push(reader.readString("shift_jis"));
    const memo = reader.readString("shift_jis");
    types.push({ index, name, fields, dataTitles, memo });
  }
  if (reader.remaining > 0 && !reader.trailingBytesAreZero()) throw new Error("旧版数据库 project 存在无法识别的尾部数据。");
  return { format: "database-project-legacy", encoding: "shift_jis", decrypted: false, types };
}

function parsePlainProject(bytes: Uint8Array): WolfDatabaseProject {
  const failures: string[] = [];
  for (const parser of [parseNewProject, parseLegacyProject]) {
    try { return parser(bytes); }
    catch (cause) { failures.push(cause instanceof Error ? cause.message : String(cause)); }
  }
  throw new Error(failures.join(" | "));
}

function decryptWithMsvcRand(input: Uint8Array, seedByte: number): Uint8Array {
  // WOLF's desktop database parser seeds the Microsoft CRT rand() with an int8 seed,
  // then XORs each byte with the low byte of rand().
  const signedSeed = seedByte < 128 ? seedByte : seedByte - 256;
  let state = signedSeed >>> 0;
  const output = new Uint8Array(input.byteLength);
  for (let i = 0; i < input.byteLength; i += 1) {
    state = (Math.imul(state, 214013) + 2531011) >>> 0;
    const randomByte = ((state >>> 16) & 0x7fff) & 0xff;
    output[i] = input[i] ^ randomByte;
  }
  return output;
}

export function parseWolfDatabaseProject(input: Uint8Array): WolfDatabaseProject {
  if (!(input instanceof Uint8Array) || input.byteLength < 8 || input.byteLength > MAX_ASSET_BYTES) {
    throw new Error("SysDataBase.project 大小无效或超过 32 MiB。");
  }
  try { return parsePlainProject(input); }
  catch { /* The project file may be WOLF-encrypted. */ }
  for (let seed = 0; seed < 256; seed += 1) {
    const probe = decryptWithMsvcRand(input.subarray(0, 4), seed);
    const count = new DataView(probe.buffer, probe.byteOffset, 4).getUint32(0, true);
    if (count < 1 || count > MAX_PROJECT_TYPES) continue;
    try {
      const decoded = decryptWithMsvcRand(input, seed);
      const project = parsePlainProject(decoded);
      return { ...project, decrypted: true };
    } catch { /* Try the next seed. */ }
  }
  throw new Error("无法解析数据库 project：文件可能采用未支持的 WOLF 版本或加密格式。");
}

function readByteString(reader: BinaryReader): string {
  return reader.readString("utf-8");
}
function readByteStringArray(reader: BinaryReader): string[] {
  const count = validateCount(reader.readU32(), MAX_DATA_TITLES, "字符串数组");
  const values: string[] = [];
  for (let i = 0; i < count; i += 1) values.push(readByteString(reader));
  return values;
}
function readU32Array(reader: BinaryReader): void { reader.readU32Array(); }
function readS32Array(reader: BinaryReader): void { reader.readS32Array(); }
function expectByte(reader: BinaryReader, expected: number, label: string): void {
  const actual = reader.readU8();
  if (actual !== expected) throw new Error(`CommonEvent.dat ${label} 不匹配：0x${actual.toString(16)}。`);
}

function skipEventCommand(reader: BinaryReader): void {
  const paramCount = reader.readU8();
  if (paramCount > 0) reader.skip(paramCount * 4);
  reader.readU8(); // branch depth
  const stringCount = reader.readU8();
  if (stringCount > 0) for (let i = 0; i < stringCount; i += 1) reader.readString("utf-8");
  const hasRoute = reader.readU8();
  if (hasRoute === 0) return;
  // Route header: animation/move/frequency/mode plus two 8-bit flag records.
  reader.skip(6);
  const routeCount = validateCount(reader.readU32(), 100_000, "移动路线命令");
  for (let i = 0; i < routeCount; i += 1) {
    reader.readU8(); // route command id
    const numberCount = validateCount(reader.readU8(), 64, "移动路线数值参数");
    reader.skip(numberCount * 4);
    const byteCount = validateCount(reader.readU8(), 64, "移动路线字节参数");
    reader.skip(byteCount);
  }
}

export interface WolfCommonEventVariableGroup extends WolfVariableGroup {
  category: "common-self";
  commonEventId: number;
}

export function parseCommonEventVariableGroups(input: Uint8Array, sourcePath: string): WolfCommonEventVariableGroup[] {
  const reader = new BinaryReader(input);
  const magic = [0x00, 0x57, 0x00, 0x00, 0x4f, 0x4c];
  for (const byte of magic) if (reader.readU8() !== byte) throw new Error("CommonEvent.dat 文件头不匹配。");
  const versionHeader = reader.readU8();
  if (versionHeader !== 0 && versionHeader !== 0x55) throw new Error("CommonEvent.dat 版本标记不受支持。");
  expectByte(reader, 0x46, "FC 标记"); expectByte(reader, 0x43, "FC 标记"); expectByte(reader, 0x00, "FC 标记");
  reader.readU8(); // format version
  const eventCount = validateCount(reader.readU32(), MAX_COMMON_EVENTS, "公共事件");
  const groups: WolfCommonEventVariableGroup[] = [];
  let namedCount = 0;
  for (let eventIndex = 0; eventIndex < eventCount; eventIndex += 1) {
    expectByte(reader, 0x8e, `公共事件 ${eventIndex} 头部`);
    const commonEventId = reader.readU32();
    reader.readU8(); // condition operator and run-condition nibbles
    reader.readU32(); // condition variable
    reader.readU32(); // condition value
    reader.readU8(); // number argument count
    reader.readU8(); // string argument count
    const title = reader.readString("utf-8");
    const lineCount = validateCount(reader.readU32(), 1_000_000, "公共事件命令");
    for (let line = 0; line < lineCount; line += 1) skipEventCommand(reader);
    reader.skip(5); // fixed unknown marker
    reader.readString("utf-8"); // memo
    expectByte(reader, 0x8f, "参数分隔符");
    readByteStringArray(reader); // argument names
    const modePageCount = validateCount(reader.readU32(), 100_000, "参数选项模式页");
    reader.skip(modePageCount);
    const stringPageCount = validateCount(reader.readU32(), 100_000, "参数选项字符串页");
    for (let i = 0; i < stringPageCount; i += 1) readByteStringArray(reader);
    const valuePageCount = validateCount(reader.readU32(), 100_000, "参数选项数值页");
    for (let i = 0; i < valuePageCount; i += 1) readU32Array(reader);
    readS32Array(reader); // numeric argument defaults
    expectByte(reader, 0x90, "颜色分隔符");
    const color = reader.readU32();
    const variables: WolfVariableEntry[] = [];
    for (let index = 0; index < 100; index += 1) {
      const name = reader.readString("utf-8").trim();
      if (!name) continue; // Unnamed CSelf slots are represented by the generic template group.
      const valueType: WolfVariableValueType = index >= 5 && index <= 9 ? "string" : "number";
      if (namedCount < MAX_NAMED_COMMON_VARIABLES) {
        variables.push({
          id: `CSelf${index}`, name, displayName: `CSelf${index} · ${name}`,
          valueType, index, scope: `CommonEvent ${commonEventId}`, named: true,
        });
      }
      namedCount += 1;
    }
    expectByte(reader, 0x91, "公共事件自定义变量分隔符");
    reader.skip(5);
    expectByte(reader, 0x92, "返回值分隔符");
    reader.readString("utf-8"); // return name
    reader.readU32(); // return value id
    expectByte(reader, 0x92, "公共事件结尾分隔符");
    if (variables.length > 0) {
      groups.push({
        id: `common-self-${commonEventId}`,
        title: `公共事件 ${commonEventId}${title ? ` · ${title}` : ""}`,
        category: "common-self", valueType: "mixed", sourcePath, variables,
        count: variables.length, commonEventId,
        note: `CommonEvent.dat · 配置颜色 ${color} · 只显示显式命名的 CSelf 槽位。`,
      });
    }
  }
  const footer = reader.readU8();
  if (footer !== 0x8f && footer !== 0x90 && footer !== 0x91) throw new Error("CommonEvent.dat 结尾标记不匹配。");
  return groups;
}

const SYSTEM_VARIABLE_TYPE_MAP: Record<number, { id: string; title: string; valueType: WolfVariableValueType; description: string }> = {
  4: { id: "string", title: "字符串变量 S", valueType: "string", description: "S? · 游戏定义的字符串变量" },
  5: { id: "system-string", title: "系统字符串变量 SysS", valueType: "string", description: "SysS? · 系统字符串变量" },
  6: { id: "system-number", title: "系统变量 Sys", valueType: "number", description: "Sys? · 系统数值变量" },
  14: { id: "normal", title: "常规变量 V", valueType: "number", description: "V? · 常规数值变量" },
  15: { id: "spare-1", title: "预备变量 V1", valueType: "number", description: "V1-? · 第 1 组预备数值变量" },
  16: { id: "spare-2", title: "预备变量 V2", valueType: "number", description: "V2-? · 第 2 组预备数值变量" },
  17: { id: "spare-3", title: "预备变量 V3", valueType: "number", description: "V3-? · 第 3 组预备数值变量" },
  18: { id: "spare-4", title: "预备变量 V4", valueType: "number", description: "V4-? · 第 4 组预备数值变量" },
  19: { id: "spare-5", title: "预备变量 V5", valueType: "number", description: "V5-? · 第 5 组预备数值变量" },
  20: { id: "spare-6", title: "预备变量 V6", valueType: "number", description: "V6-? · 第 6 组预备数值变量" },
  21: { id: "spare-7", title: "预备变量 V7", valueType: "number", description: "V7-? · 第 7 组预备数值变量" },
  22: { id: "spare-8", title: "预备变量 V8", valueType: "number", description: "V8-? · 第 8 组预备数值变量" },
  23: { id: "spare-9", title: "预备变量 V9", valueType: "number", description: "V9-? · 第 9 组预备数值变量" },
};

function variablePrefix(typeIndex: number): string {
  if (typeIndex === 4) return "S";
  if (typeIndex === 5) return "SysS";
  if (typeIndex === 6) return "Sys";
  if (typeIndex === 14) return "V";
  if (typeIndex >= 15 && typeIndex <= 23) return `V${typeIndex - 14}-`;
  return "Var";
}

function createVariableGroup(type: WolfDatabaseProjectType, sourcePath: string): WolfVariableGroup | undefined {
  const definition = SYSTEM_VARIABLE_TYPE_MAP[type.index];
  if (!definition) return undefined;
  const prefix = variablePrefix(type.index);
  const variables = type.dataTitles.map((rawName, index) => {
    const name = rawName.trim();
    // WOLF's system-string table is numbered from SysS1 (SysS0 is not a
    // regular editable user-visible system string); other tables are zero-based.
    const id = type.index === 5 ? `SysS${index + 1}` : `${prefix}${index}`;
    return {
      id, name: name || id,
      displayName: name ? `${id} · ${name}` : `${id} · 未命名`,
      valueType: definition.valueType, index, scope: type.name || definition.title,
      named: Boolean(name),
    } satisfies WolfVariableEntry;
  });
  return {
    id: definition.id, title: definition.title, category: "variable",
    valueType: definition.valueType, sourcePath, variables, count: variables.length,
    note: `${definition.description}；来源数据库类型 ${type.index}${type.name ? `（${type.name}）` : ""}。`,
  };
}

export function buildWolfVariableCatalog(
  assetPaths: string[],
  readAsset: (path: string) => Uint8Array | undefined,
): WolfVariableCatalog {
  const groups: WolfVariableGroup[] = [];
  const sourceFiles: string[] = [];
  const warnings: string[] = [];
  const normalize = (path: string) => path.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
  const paths = [...new Set(assetPaths)].sort((a, b) => {
    const aPriority = /\/basicdata\//iu.test(a) ? 0 : 1;
    const bPriority = /\/basicdata\//iu.test(b) ? 0 : 1;
    return aPriority - bPriority || a.localeCompare(b);
  });
  const systemProjects = paths.filter((path) => /(?:^|\/)(?:sysdatabase|sysdatabasebasic)\.project$/iu.test(normalize(path)));
  let systemProject: WolfDatabaseProject | undefined;
  let systemProjectPath = "";
  for (const path of systemProjects) {
    try {
      const bytes = readAsset(path);
      if (!bytes) continue;
      const project = parseWolfDatabaseProject(bytes);
      systemProject = project;
      systemProjectPath = path;
      sourceFiles.push(path);
      if (project.decrypted) warnings.push(`${path} 是加密的 project 文件，已尝试 WOLF 数据库解密。`);
      break;
    } catch (cause) {
      warnings.push(`${path} 无法解析：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  if (!systemProject) {
    warnings.push("没有成功读取 SysDataBase.project / SysDataBaseBasic.project。请确认游戏已启动且其 Data/BasicData 文件已被运行时加载。");
  } else {
    for (const typeIndex of Object.keys(SYSTEM_VARIABLE_TYPE_MAP).map(Number)) {
      const type = systemProject.types[typeIndex];
      if (!type) {
        warnings.push(`系统数据库缺少类型 ${typeIndex}（${SYSTEM_VARIABLE_TYPE_MAP[typeIndex].title}），可能是不同版本或简化版项目。`);
        continue;
      }
      const group = createVariableGroup(type, systemProjectPath);
      if (group) groups.push(group);
    }
  }

  groups.push({
    id: "map-self", title: "地图事件自定义变量 Self", category: "map-self", valueType: "number",
    sourcePath: "WOLF runtime context", count: 10,
    variables: Array.from({ length: 10 }, (_, index) => ({
      id: `Self${index}`, name: `Self${index}`, displayName: `Self${index}`,
      valueType: "number" as const, index, scope: "当前地图事件", named: false,
    })),
    note: "地图 Self 变量按当前地图事件隔离。WOLF 静态 project 不提供一份适用于所有地图事件的全局名称表；此处列出槽位与类型，不伪造事件名。",
  });
  groups.push({
    id: "common-self-template", title: "公共事件自定义变量 CSelf（通用槽位）", category: "common-self", valueType: "mixed",
    sourcePath: "WOLF runtime context", count: 100,
    variables: Array.from({ length: 100 }, (_, index) => ({
      id: `CSelf${index}`, name: `CSelf${index}`, displayName: `CSelf${index}`,
      valueType: index >= 5 && index <= 9 ? "string" as const : "number" as const,
      index, scope: "当前公共事件", named: false,
    })),
    note: "CSelf5–CSelf9 为字符串槽位，其余为数值槽位。公共事件的具体命名见下方逐事件名称组。",
  });

  const commonEventPath = paths.find((path) => /(?:^|\/)commonevent\.dat$/iu.test(normalize(path)));
  if (commonEventPath) {
    try {
      const bytes = readAsset(commonEventPath);
      if (bytes) {
        const commonGroups = parseCommonEventVariableGroups(bytes, commonEventPath);
        groups.push(...commonGroups);
        sourceFiles.push(commonEventPath);
        if (commonGroups.length === 0) warnings.push("CommonEvent.dat 可读取，但没有发现显式命名的 CSelf 槽位；已保留通用 CSelf 类型模板。");
      } else warnings.push(`未能读取 ${commonEventPath}。`);
    } catch (cause) {
      warnings.push(`${commonEventPath} 的 CSelf 名称解析失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  } else {
    warnings.push("未在可用资源清单中找到 CommonEvent.dat；公共事件 CSelf 目前仅显示通用槽位类型。");
  }

  return {
    groups,
    sourceFiles: [...new Set(sourceFiles)],
    warnings,
    totalVariables: groups.reduce((sum, group) => sum + group.count, 0),
  };
}
