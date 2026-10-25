export function matchesInt32Sequence(view: DataView, byteOffset: number, values: readonly number[]): boolean {
  if (!Number.isSafeInteger(byteOffset) || byteOffset < 0 || byteOffset % 4 !== 0) return false;
  if (values.length < 4 || values.length > 8 || byteOffset + values.length * 4 > view.byteLength) return false;
  for (let index = 0; index < values.length; index += 1) {
    const expected = values[index];
    if (!Number.isInteger(expected) || expected < -2147483648 || expected > 2147483647) return false;
    if (view.getInt32(byteOffset + index * 4, true) !== expected) return false;
  }
  return true;
}
