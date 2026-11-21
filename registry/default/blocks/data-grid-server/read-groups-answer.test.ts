import { describe, expect, it, vi } from "vitest";
import { assertRowIdsNotReserved, readGroupsAnswer } from "./read-groups-answer";

const range = { start: 0, end: 10 };
const top = { topLevel: true, aggregates: [{ columnId: "qty", reducer: "sum" as const }] };
const reducers = { topLevel: true, aggregates: [...top.aggregates, { columnId: "name", reducer: "min" as const }, { columnId: "createdAt", reducer: "max" as const }] };
const group = (extra: object = {}) => ({ key: "EU", childCount: 2, totalRowCount: 5, ...extra });
const read = (answer: unknown, options: Parameters<typeof readGroupsAnswer>[2] = top, warn = vi.fn()) => ({ out: readGroupsAnswer(answer, range, options, warn), warn });

describe("readGroupsAnswer", () => {
  it("reads a valid answer", () => {
    const { out } = read({ groups: [group({ label: "Europe", aggregates: { qty: 7 } }), group({ key: null })], groupCount: 2, totalRowCount: 9 });
    expect(out.groupCount).toBe(2);
    expect(out.totalRowCount).toBe(9);
    expect(out.groups[0]).toMatchObject({ key: "EU", label: "Europe", childCount: 2, totalRowCount: 5 });
    expect(out.groups[0]!.aggregates).toEqual({ qty: 7 });
  });

  it("fails an answer of the wrong kind", () => {
    expect(() => read({ rows: [] })).toThrow(/answered rows/);
    expect(() => read(null)).toThrow(/groups/);
    expect(() => read({ groups: "x", groupCount: 0, totalRowCount: 0 })).toThrow(/groups/);
  });

  it("cuts the groups to the requested size with one warning", () => {
    const { out, warn } = read({ groups: Array.from({ length: 12 }, (_, i) => group({ key: `k${i}` })), groupCount: 12, totalRowCount: 1 });
    expect(out.groups).toHaveLength(10);
    expect(warn).toHaveBeenCalledWith("long", expect.stringContaining("12 groups"));
  });

  it("rejects a key that is an object, a long string, or not finite", () => {
    for (const key of [{ a: 1 }, [1], "x".repeat(1025), Number.NaN, Number.POSITIVE_INFINITY, undefined, 1n]) {
      expect(() => read({ groups: [group({ key })], groupCount: 1, totalRowCount: 1 }), String(key)).toThrow(/groups\[0\]\.key/);
    }
  });

  it("rejects a key that repeats, also across types and the empty group", () => {
    for (const keys of [["a", "a"], [1, "1"], [null, ""], [true, "true"]]) {
      expect(() => read({ groups: keys.map((key) => group({ key })), groupCount: 2, totalRowCount: 1 })).toThrow(/groups\[1\]\.key/);
    }
  });

  it("rejects counts that are not safe non-negative integers and clamps the large ones", () => {
    for (const bad of [-1, 1.5, Number.NaN, "3", null, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => read({ groups: [group({ childCount: bad })], groupCount: 1, totalRowCount: 1 })).toThrow(/childCount/);
      expect(() => read({ groups: [group({ totalRowCount: bad })], groupCount: 1, totalRowCount: 1 })).toThrow(/totalRowCount/);
      expect(() => read({ groups: [group()], groupCount: bad, totalRowCount: 1 })).toThrow(/groupCount/);
    }
    const { out, warn } = read({ groups: [group({ childCount: 20_000_000 })], groupCount: 1, totalRowCount: 20_000_000 });
    expect(out.groups[0]!.childCount).toBe(10_000_000);
    expect(out.totalRowCount).toBe(10_000_000);
    expect(warn).toHaveBeenCalled();
  });

  it("requires totalRowCount at the top level only", () => {
    expect(() => read({ groups: [group()], groupCount: 1 })).toThrow(/totalRowCount/);
    expect(read({ groups: [group()], groupCount: 1 }, { topLevel: false, aggregates: [] }).out.totalRowCount).toBeUndefined();
  });

  it("cuts a long label", () => {
    const { out, warn } = read({ groups: [group({ label: "x".repeat(2000) })], groupCount: 1, totalRowCount: 1 });
    expect(out.groups[0]!.label).toHaveLength(1024);
    expect(warn).toHaveBeenCalledWith("label", expect.any(String));
  });

  it("reads only the requested aggregate ids and turns a bad value into null", () => {
    const aggregates = JSON.parse('{"qty":"seven","other":1,"__proto__":{"qty":5}}');
    const { out, warn } = read({ groups: [group({ aggregates })], groupCount: 1, totalRowCount: 1 });
    expect(out.groups[0]!.aggregates).toEqual({ qty: null });
    expect(Object.getPrototypeOf(out.groups[0]!.aggregates)).toBeNull();
    expect(warn).toHaveBeenCalledWith("aggregate qty", expect.any(String));
  });

  it("does not read an aggregate id from the prototype chain", () => {
    const { out } = read({ groups: [group({ aggregates: Object.create({ qty: 3 }) })], groupCount: 1, totalRowCount: 1 });
    expect(out.groups[0]!.aggregates).toEqual({});
  });

  it("keeps the null aggregate without a warning", () => {
    const { out, warn } = read({ groups: [group({ aggregates: { qty: null } })], groupCount: 1, totalRowCount: 1 });
    expect(out.groups[0]!.aggregates).toEqual({ qty: null });
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps a string min or max of a text or date column", () => {
    const { out, warn } = read({ groups: [group({ aggregates: { name: "alpha", createdAt: "2024-03-10T07:00:00.000Z" } })], groupCount: 1, totalRowCount: 1 }, reducers);
    expect(out.groups[0]!.aggregates).toEqual({ name: "alpha", createdAt: "2024-03-10T07:00:00.000Z" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps a numeric string sum digit for digit", () => {
    for (const qty of ["12345678901234567.89", "-9007199254740993", "0.10"]) {
      expect(read({ groups: [group({ aggregates: { qty } })], groupCount: 1, totalRowCount: 1 }, reducers).out.groups[0]!.aggregates).toEqual({ qty });
    }
  });

  it("drops a non-numeric string for a sum as null, never NaN", () => {
    for (const qty of ["abc", "NaN", "Infinity", "1e5", "", " 1", "1.", "0x10"]) {
      const { out, warn } = read({ groups: [group({ aggregates: { qty } })], groupCount: 1, totalRowCount: 1 }, reducers);
      expect(out.groups[0]!.aggregates, qty).toEqual({ qty: null });
      expect(warn).toHaveBeenCalledWith("aggregate qty", expect.any(String));
    }
  });

  it("drops an over-long string and keeps hostile text as plain text", () => {
    const long = read({ groups: [group({ aggregates: { name: "x".repeat(1025), qty: "1".repeat(1025) } })], groupCount: 1, totalRowCount: 1 }, reducers);
    expect(long.out.groups[0]!.aggregates).toEqual({ name: null, qty: null });
    expect(long.warn).toHaveBeenCalledTimes(2);
    const aggregates = JSON.parse(String.raw`{"name":"__proto__","createdAt":"a\u0000b\u001b[31m"}`);
    const { out } = read({ groups: [group({ aggregates })], groupCount: 1, totalRowCount: 1 }, reducers);
    expect(out.groups[0]!.aggregates).toEqual({ name: "__proto__", createdAt: "a\u0000b\u001b[31m" });
    expect(Object.getPrototypeOf(out.groups[0]!.aggregates)).toBeNull();
  });
});

describe("assertRowIdsNotReserved", () => {
  it("fails a row id with a reserved prefix", () => {
    for (const id of ["__group:region=EU", "__pinned-top-0", "__lazy-unloaded-4"]) expect(() => assertRowIdsNotReserved(["a", id])).toThrow(/reserves/);
  });

  it("accepts every other id", () => {
    expect(() => assertRowIdsNotReserved(["a", "_group:x", "group:x", ""])).not.toThrow();
  });
});
