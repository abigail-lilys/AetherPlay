import { describe, expect, it } from "vitest";
import {
  WOLF_SYSTEM_VARIABLE_BY_ID,
  WOLF_SYSTEM_VARIABLE_COUNT,
  WOLF_SYSTEM_VARIABLE_READ_ONLY_IDS,
  WOLF_SYSTEM_VARIABLE_WRITABLE_IDS,
} from "./systemVariables";

describe("WOLF built-in numeric system-variable metadata", () => {
  it("covers the documented Sys0..Sys163 address range without duplicate IDs", () => {
    expect(WOLF_SYSTEM_VARIABLE_COUNT).toBe(164);
    const ids = [...WOLF_SYSTEM_VARIABLE_BY_ID.keys()];
    expect(new Set(ids).size).toBe(ids.length);
    expect(Math.max(...ids)).toBe(163);
    expect(WOLF_SYSTEM_VARIABLE_BY_ID.get(0)?.name).toBe("面部图形编号");
  });

  it("keeps the clock signature partly writable and Sys30 read-only", () => {
    expect(WOLF_SYSTEM_VARIABLE_WRITABLE_IDS.has(28)).toBe(true);
    expect(WOLF_SYSTEM_VARIABLE_WRITABLE_IDS.has(29)).toBe(true);
    expect(WOLF_SYSTEM_VARIABLE_READ_ONLY_IDS.has(30)).toBe(true);
    expect(WOLF_SYSTEM_VARIABLE_WRITABLE_IDS.has(30)).toBe(false);
  });

  it("does not expose undocumented/reserved slots for writing", () => {
    expect(WOLF_SYSTEM_VARIABLE_WRITABLE_IDS.has(49)).toBe(false);
    expect(WOLF_SYSTEM_VARIABLE_WRITABLE_IDS.has(139)).toBe(false);
    expect(WOLF_SYSTEM_VARIABLE_WRITABLE_IDS.has(162)).toBe(false);
  });
});
