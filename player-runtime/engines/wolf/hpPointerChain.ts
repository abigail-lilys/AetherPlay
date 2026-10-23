/** Verified live HP chain seen in Browser Woditor WASM memory. */
export const WOLF_HP_ROOT_POINTER_OFFSET = 0x0045e598;
const ROOT_TO_SLOT_OFFSET = 0x84;
const HP_FIELD_OFFSET = 0x08;

export interface WolfHpPointerChainSnapshot {
  rootOffset: number;
  p1: number;
  slotOffset: number;
  p2: number;
  p3: number;
  hpAddress: number;
  hpValue: number;
  memoryBytes: number;
  resolvedAt: string;
}

function formatAddress(value: number): string {
  return Number.isFinite(value) && value >= 0
    ? `0x${Math.trunc(value).toString(16).toUpperCase().padStart(8, "0")}`
    : String(value);
}
function assertRange(view: DataView, offset: number, bytes: number, label: string): void {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset % 4 !== 0
    || offset + bytes > view.byteLength) {
    throw new Error(`${label} 超出 WASM 内存范围或未对齐：${formatAddress(offset)}。`);
  }
}
function assertPointer(view: DataView, pointer: number, label: string): void {
  if (!Number.isSafeInteger(pointer) || pointer <= 0 || pointer > 0xffffffff
    || pointer % 4 !== 0 || pointer + 4 > view.byteLength) {
    throw new Error(`${label} 指针无效：${formatAddress(pointer)}；内存长度 ${view.byteLength} 字节。`);
  }
}
function readPointer(view: DataView, offset: number, label: string): number {
  assertRange(view, offset, 4, `${label} 读取位置`);
  const pointer = view.getUint32(offset, true);
  assertPointer(view, pointer, label);
  return pointer;
}
function assertInt32(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new Error(`${label}必须是 Int32 整数（-2147483648 至 2147483647）。`);
  }
}

/** 每次都重新解析 root -> p1+0x84 -> p2 -> p3+0x08。 */
export function resolveWolfHpPointerChain(view: DataView): WolfHpPointerChainSnapshot {
  assertRange(view, WOLF_HP_ROOT_POINTER_OFFSET, 4, "HP 根指针");
  const p1 = readPointer(view, WOLF_HP_ROOT_POINTER_OFFSET, "p1");
  const slotOffset = p1 + ROOT_TO_SLOT_OFFSET;
  assertRange(view, slotOffset, 4, "p1 + 0x84 指针槽");
  const p2 = readPointer(view, slotOffset, "p2");
  const p3 = readPointer(view, p2, "p3");
  const hpAddress = p3 + HP_FIELD_OFFSET;
  assertRange(view, hpAddress, 4, "HP 字段");
  return {
    rootOffset: WOLF_HP_ROOT_POINTER_OFFSET, p1, slotOffset, p2, p3, hpAddress,
    hpValue: view.getInt32(hpAddress, true),
    memoryBytes: view.byteLength,
    resolvedAt: new Date().toISOString(),
  };
}

/** 写入前重新解析并核对旧值，写入后重新解析并回读验证。 */
export function writeWolfHpPointerChain(
  view: DataView, expectedCurrentValue: number, nextValue: number
): WolfHpPointerChainSnapshot {
  assertInt32(expectedCurrentValue, "预期 HP");
  assertInt32(nextValue, "新 HP");
  const before = resolveWolfHpPointerChain(view);
  if (before.hpValue !== expectedCurrentValue) {
    throw new Error(
      `HP 已从记录值 ${expectedCurrentValue} 变成 ${before.hpValue}；写入已取消，请先刷新 HP。`
    );
  }
  view.setInt32(before.hpAddress, nextValue, true);
  const after = resolveWolfHpPointerChain(view);
  if (after.hpAddress !== before.hpAddress) {
    throw new Error("写入后 HP 指针地址发生变化，请重新读取。");
  }
  if (after.hpValue !== nextValue) {
    throw new Error(`HP 回读失败：预期 ${nextValue}，实际 ${after.hpValue}。`);
  }
  return after;
}
