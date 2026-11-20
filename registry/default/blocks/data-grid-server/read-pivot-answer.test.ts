import { describe, expect, it, vi } from "vitest";
import { MAX_PIVOT_DESCRIPTORS, readPivotAnswer } from "./read-pivot-answer";

const values = [{ columnId: "amount", reducer: "sum" }] as const;
const options = { columnId: "year", values };
const columns = (keys: readonly unknown[]) => keys.map((key) => ({ path: [key], valueIndex: 0 }));
const answer = (keys: readonly unknown[], cells: readonly unknown[][], extra: object = {}) => ({ groups: cells.map((pivotCells) => ({ pivotCells })), pivotColumns: columns(keys), ...extra });
const read = (raw: unknown, groupCount = 1, held?: Parameters<typeof readPivotAnswer>[2]["held"], warn = vi.fn()) => readPivotAnswer(raw, groupCount, { ...options, ...(held ? { held } : null) }, warn);

describe("readPivotAnswer", () => {
  it("keeps the answer's columns as the held set and reads the cells in its order", () => {
    const result = read(answer([2024, 2025], [[1, null]]));
    expect(result.columns).toEqual(columns([2024, 2025]));
    expect(result.ids).toEqual(["__pivot:year=2024|amount=sum", "__pivot:year=2025|amount=sum"]);
    expect([...result.cells[0]!]).toEqual([1, NaN]);
    expect(result.omitted).toBe(0);
  });

  it("maps cells by id into a given held set and reads a missing id as NaN", () => {
    const held = [2023, 2025].map((key) => ({ path: [key], valueIndex: 0 }));
    const result = read(answer([2025, 2024], [[7, 8]], { pivotOmitted: 3 }), 1, held);
    expect(result.columns).toBe(held);
    expect([...result.cells[0]!]).toEqual([NaN, 7]);
    expect(result.omitted).toBe(4);
  });

  it("keeps 200 columns and counts the rest as omitted", () => {
    const keys = Array.from({ length: 250 }, (_, i) => i);
    const result = read(answer(keys, [keys]), 1);
    expect(result.ids).toHaveLength(200);
    expect(result.cells[0]![199]).toBe(199);
    expect(result.omitted).toBe(50);
  });

  it("fails before the walk with more than 5,000 descriptors", () => {
    const pivotColumns = new Array(MAX_PIVOT_DESCRIPTORS + 1);
    expect(() => read({ groups: [], pivotColumns }, 0)).toThrow(/5000/);
  });

  it("fails without pivotColumns, with a bad path, or with a valueIndex out of range", () => {
    expect(() => read({ groups: [{ pivotCells: [] }] })).toThrow(TypeError);
    expect(() => read({ groups: [{ pivotCells: [1] }], pivotColumns: [{ path: [1, 2], valueIndex: 0 }] })).toThrow(/path/);
    expect(() => read({ groups: [{ pivotCells: [1] }], pivotColumns: [{ path: [{}], valueIndex: 0 }] })).toThrow(/path/);
    expect(() => read({ groups: [{ pivotCells: [1] }], pivotColumns: [{ path: ["x".repeat(1025)], valueIndex: 0 }] })).toThrow(/path/);
    expect(() => read({ groups: [{ pivotCells: [1] }], pivotColumns: [{ path: [1], valueIndex: 1 }] })).toThrow(/valueIndex/);
    expect(() => read({ groups: [{ pivotCells: [1] }], pivotColumns: [{ path: [1], valueIndex: 0.5 }] })).toThrow(/valueIndex/);
  });

  it("fails on two entries with one generated id", () => {
    expect(() => read(answer([1, "1"], [[1, 2]]))).toThrow(/twice/);
    expect(() => read(answer([null, ""], [[1, 2]]))).toThrow(/twice/);
  });

  it("reads a __proto__ key as a plain column", () => {
    const result = read(answer(["__proto__", "constructor"], [[1, 2]]));
    expect(result.ids).toEqual(["__pivot:year=__proto__|amount=sum", "__pivot:year=constructor|amount=sum"]);
  });

  it("fails on a key with a lone surrogate", () => {
    expect(() => read(answer(["\uD800"], [[1]]))).toThrow(TypeError);
  });

  it("counts a generated id over 2,048 characters as omitted, with one warning", () => {
    const warn = vi.fn();
    const result = read(answer(["é".repeat(1000), "a"], [[1, 2]]), 1, undefined, warn);
    expect(result.ids).toEqual(["__pivot:year=a|amount=sum"]);
    expect([...result.cells[0]!]).toEqual([2]);
    expect(result.omitted).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("fails when a group's pivotCells is missing or misaligned", () => {
    expect(() => read({ groups: [{}], pivotColumns: columns([1]) })).toThrow(/pivotCells/);
    expect(() => read(answer([1, 2], [[1]]))).toThrow(/pivotCells/);
  });

  it("reads only the groups the grid kept", () => {
    const result = read(answer([1], [[1], ["bad"]]), 1);
    expect(result.cells).toHaveLength(1);
  });

  it("reads a cell that is not a finite number or null as NaN, with a warning", () => {
    const warn = vi.fn();
    const result = read(answer([1, 2, 3], [["5", Infinity, 0]]), 1, undefined, warn);
    expect([...result.cells[0]!]).toEqual([NaN, NaN, 0]);
    expect(warn).toHaveBeenCalledWith("pivot cell", expect.any(String));
  });

  it("reads a bad pivotOmitted as 0, with a warning", () => {
    const warn = vi.fn();
    expect(read(answer([1], [[1]], { pivotOmitted: -1 }), 1, undefined, warn).omitted).toBe(0);
    expect(read(answer([1], [[1]], { pivotOmitted: 1.5 }), 1, undefined, warn).omitted).toBe(0);
    expect(warn).toHaveBeenCalledWith("pivotOmitted", expect.any(String));
  });
});
