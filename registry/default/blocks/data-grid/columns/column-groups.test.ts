import { describe, expect, it } from "vitest";
import type { ColumnGroupDef } from "../types";
import { MAX_GROUP_DEPTH, buildColumnGroupModel, columnGroupModelsEqual, computeHeaderRows, groupPathOf, repairGroupOrder } from "./column-groups";

const CI_FACTOR = process.env["CI"] ? 2 : 1;
const ids = (...list: string[]) => list;
const col = (id: string, pin?: "left" | "right") => ({ id, pin });

describe("buildColumnGroupModel", () => {
  it("returns null for no groups", () => {
    expect(buildColumnGroupModel(undefined, ids("a"))).toBeNull();
    expect(buildColumnGroupModel([], ids("a"))).toBeNull();
  });

  it("builds root-first paths for nested groups", () => {
    const model = buildColumnGroupModel(
      [{ id: "g", header: "G", children: ["a", { id: "h", header: "H", children: ["b", "c"] }] }],
      ids("a", "b", "c", "d"),
    )!;
    expect(groupPathOf(model, "a")).toEqual(["g"]);
    expect(groupPathOf(model, "b")).toEqual(["g", "h"]);
    expect(groupPathOf(model, "d")).toEqual([]);
    expect(model.depth).toBe(2);
  });

  it("drops unknown column ids and prunes groups left empty", () => {
    const model = buildColumnGroupModel([{ id: "g", header: "G", children: ["nope"] }, { id: "h", header: "H", children: ["a", "ghost"] }], ids("a"))!;
    expect(model.groups.has("g")).toBe(false);
    expect(groupPathOf(model, "a")).toEqual(["h"]);
    expect(model.issues.some((m) => m.includes("nope"))).toBe(true);
  });

  it("keeps the first group of a column listed twice", () => {
    const model = buildColumnGroupModel(
      [
        { id: "g1", header: "1", children: ["a"] },
        { id: "g2", header: "2", children: ["a", "b"] },
      ],
      ids("a", "b"),
    )!;
    expect(groupPathOf(model, "a")).toEqual(["g1"]);
    expect(groupPathOf(model, "b")).toEqual(["g2"]);
  });

  it("drops a group whose id repeats or collides with a column id", () => {
    const model = buildColumnGroupModel(
      [
        { id: "g", header: "1", children: ["a"] },
        { id: "g", header: "2", children: ["b"] },
        { id: "c", header: "3", children: ["c"] },
      ],
      ids("a", "b", "c"),
    )!;
    expect(groupPathOf(model, "a")).toEqual(["g"]);
    expect(groupPathOf(model, "b")).toEqual([]);
    expect(groupPathOf(model, "c")).toEqual([]);
    expect(model.issues.length).toBe(2);
  });

  it("truncates nesting above the depth cap", () => {
    let node: ColumnGroupDef = { id: "g0", header: "0", children: ["a"] };
    for (let i = 1; i < MAX_GROUP_DEPTH + 3; i++) node = { id: `g${i}`, header: String(i), children: [node] };
    const model = buildColumnGroupModel([node], ids("a"));
    expect(model).toBeNull();
  });

  it("survives a cyclic object graph", () => {
    const a: ColumnGroupDef = { id: "a", header: "A", children: [] };
    const b: ColumnGroupDef = { id: "b", header: "B", children: [a, "x"] };
    (a.children as unknown as unknown[]).push(b, "y");
    const model = buildColumnGroupModel([a], ids("x", "y"))!;
    expect(groupPathOf(model, "y")).toEqual(["a"]);
    expect(groupPathOf(model, "x")).toEqual(["a", "b"]);
  });

  it("ignores malformed definitions", () => {
    const bad = [null, 3, { id: 1, header: "x", children: [] }, { id: "g", header: "G", children: "a" }] as unknown as ColumnGroupDef[];
    expect(buildColumnGroupModel(bad, ids("a"))).toBeNull();
  });

  it("bounds the number of visited nodes", () => {
    const children = Array.from({ length: 50000 }, (_, i) => `c${i}`);
    const model = buildColumnGroupModel([{ id: "g", header: "G", children }], ids("c0", "c49999"))!;
    expect(groupPathOf(model, "c0")).toEqual(["g"]);
    expect(groupPathOf(model, "c49999")).toEqual([]);
  });
});

describe("columnGroupModelsEqual", () => {
  const defs = (header: string): ColumnGroupDef[] => [{ id: "g", header, children: ["a"] }];
  it("compares structure and header content, not array identity", () => {
    const a = buildColumnGroupModel(defs("G"), ids("a", "b"));
    expect(columnGroupModelsEqual(a, buildColumnGroupModel(defs("G"), ids("a", "b")))).toBe(true);
    expect(columnGroupModelsEqual(a, buildColumnGroupModel(defs("H"), ids("a", "b")))).toBe(false);
    expect(columnGroupModelsEqual(a, null)).toBe(false);
    expect(columnGroupModelsEqual(null, null)).toBe(true);
  });
});

describe("repairGroupOrder", () => {
  const model = buildColumnGroupModel(
    [
      { id: "g", header: "G", children: ["a", "b", { id: "h", header: "H", children: ["c", "d"] }] },
      { id: "k", header: "K", children: ["e", "f"] },
    ],
    ids("a", "b", "c", "d", "e", "f", "z"),
  )!;

  it("returns the same array when groups are already contiguous", () => {
    const order = ids("z", "a", "b", "c", "d", "e", "f");
    expect(repairGroupOrder(order, model)).toBe(order);
  });

  it("gathers split members at the first member's position", () => {
    expect(repairGroupOrder(ids("a", "z", "e", "b", "f", "c", "d"), model)).toEqual(ids("a", "b", "c", "d", "z", "e", "f"));
  });

  it("keeps a nested group contiguous inside its parent", () => {
    expect(repairGroupOrder(ids("c", "a", "d", "b", "e", "f", "z"), model)).toEqual(ids("c", "d", "a", "b", "e", "f", "z"));
  });

  it("returns the input without a model", () => {
    const order = ids("b", "a");
    expect(repairGroupOrder(order, null)).toBe(order);
  });
});

describe("computeHeaderRows", () => {
  it("is empty without a model", () => {
    expect(computeHeaderRows([col("a")], null)).toEqual([]);
  });

  it("builds one row per level with half-open ranges", () => {
    const model = buildColumnGroupModel(
      [{ id: "g", header: "G", children: ["a", { id: "h", header: "H", children: ["b", "c"] }] }],
      ids("a", "b", "c", "d"),
    );
    expect(computeHeaderRows([col("a"), col("b"), col("c"), col("d")], model)).toEqual([
      [{ groupId: "g", start: 0, end: 3, depth: 0 }],
      [{ groupId: "h", start: 1, end: 3, depth: 1 }],
    ]);
  });

  it("shrinks the span for hidden members and drops empty levels", () => {
    const model = buildColumnGroupModel([{ id: "g", header: "G", children: ["a", { id: "h", header: "H", children: ["b", "c"] }] }], ids("a", "b", "c"));
    expect(computeHeaderRows([col("a"), col("c")], model)).toEqual([[{ groupId: "g", start: 0, end: 2, depth: 0 }], [{ groupId: "h", start: 1, end: 2, depth: 1 }]]);
    expect(computeHeaderRows([col("a")], model)).toEqual([[{ groupId: "g", start: 0, end: 1, depth: 0 }]]);
  });

  it("splits a segment at a pin zone boundary and tags the pin", () => {
    const model = buildColumnGroupModel([{ id: "g", header: "G", children: ["a", "b", "c"] }], ids("a", "b", "c"));
    expect(computeHeaderRows([col("a", "left"), col("b"), col("c", "right")], model)).toEqual([
      [
        { groupId: "g", start: 0, end: 1, pin: "left", depth: 0 },
        { groupId: "g", start: 1, end: 2, depth: 0 },
        { groupId: "g", start: 2, end: 3, pin: "right", depth: 0 },
      ],
    ]);
  });

  it("splits two adjacent runs of different groups", () => {
    const model = buildColumnGroupModel(
      [
        { id: "g", header: "G", children: ["a", "b"] },
        { id: "k", header: "K", children: ["c"] },
      ],
      ids("a", "b", "c"),
    );
    const rows = computeHeaderRows([col("a"), col("b"), col("c")], model);
    expect(rows[0]!.map((s) => [s.groupId, s.start, s.end])).toEqual([["g", 0, 2], ["k", 2, 3]]);
  });

  it("stays within the 1 ms budget (about 8x the measured 0.12 ms) at 500 columns and depth 3", () => {
    const cols = Array.from({ length: 500 }, (_, i) => `c${i}`);
    const defs: ColumnGroupDef[] = [];
    for (let i = 0; i < 25; i++) {
      const outer: ColumnGroupDef = { id: `o${i}`, header: "o", children: [] };
      const kids = outer.children as (string | ColumnGroupDef)[];
      for (let j = 0; j < 5; j++) {
        const mid: ColumnGroupDef = { id: `m${i}-${j}`, header: "m", children: [] };
        const inner: ColumnGroupDef = { id: `n${i}-${j}`, header: "n", children: cols.slice(i * 20 + j * 4, i * 20 + j * 4 + 4) };
        (mid.children as ColumnGroupDef[]).push(inner);
        kids.push(mid);
      }
      defs.push(outer);
    }
    const model = buildColumnGroupModel(defs, cols);
    const visible = cols.map((id) => col(id));
    computeHeaderRows(visible, model);
    const start = performance.now();
    for (let i = 0; i < 20; i++) computeHeaderRows(visible, model);
    const perCall = (performance.now() - start) / 20;
    expect(model!.depth).toBe(3);
    expect(perCall).toBeLessThan(1 * CI_FACTOR);
  });
});
