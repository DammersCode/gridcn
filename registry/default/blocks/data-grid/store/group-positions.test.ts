import { describe, expect, it } from "vitest";
import type { ServerGroupLayout } from "../group-types";
import { groupPositionAt, groupRowMetaAt } from "./group-positions";
import { buildServerGroupView } from "./server-group-view";

const GROUP_BY = ["region"];
const slot = (viewRow: number) => ({ viewRow, path: [{ columnId: "region", key: `g${viewRow}` }], count: 1, childCount: 0 });

function stateOf(layout: ServerGroupLayout, dataLength: number) {
  const result = buildServerGroupView(layout, dataLength, GROUP_BY);
  if (!("view" in result)) throw new Error("no view");
  return { viewIndex: result.view.viewIndex, groupLayout: result.view.layout, expanded: { mode: "collapsed" as const, ids: [] } };
}

describe("positions of a sparse layout where no group opens", () => {
  it("places every view row, loaded or not, at its own top-level position in the whole result", () => {
    const s = stateOf({ rows: [slot(2), slot(3), slot(7)], leafCount: 10 }, 10);
    expect(groupRowMetaAt(s, 7)).toMatchObject({ level: 1, posInSet: 8, setSize: 10 });
    expect(groupPositionAt(s, 0)).toEqual({ level: 1, posInSet: 1, setSize: 10 });
    expect(groupPositionAt(s, 5)).toEqual({ level: 1, posInSet: 6, setSize: 10 });
  });

  it("keeps the node of a slot that a later layout passes again", () => {
    const kept = slot(2);
    const before = stateOf({ rows: [kept], leafCount: 10 }, 10);
    const after = stateOf({ rows: [kept, slot(7)], leafCount: 10 }, 10);
    expect(groupRowMetaAt(after, 2)!.node).toBe(groupRowMetaAt(before, 2)!.node);
    expect(groupRowMetaAt(after, 2)).toEqual(groupRowMetaAt(before, 2));
  });

  it("reports a pivot row closed even when its id is in the open ids", () => {
    const base = stateOf({ rows: [slot(2)], leafCount: 10 }, 10);
    const open = { ...base, expanded: { mode: "collapsed" as const, ids: [groupRowMetaAt(base, 2)!.node.id] } };
    expect(groupRowMetaAt(open, 2)!.expanded).toBe(true);
    expect(groupRowMetaAt({ ...open, pivot: { columnId: "city" } }, 2)!.expanded).toBe(false);
  });
});

describe("positions of a sparse nested server layout", () => {
  const BY = ["region", "city"];
  const at = (viewRow: number, keys: string[], childCount: number) => ({ viewRow, path: keys.map((key, level) => ({ columnId: BY[level]!, key })), count: 1, childCount });
  const EU = "__group:region=EU";

  function stateOfNested(layout: ServerGroupLayout, dataLength: number, ids: string[], pivot?: object) {
    const result = buildServerGroupView(layout, dataLength, BY);
    if (!("view" in result)) throw new Error("no view");
    return { viewIndex: result.view.viewIndex, groupLayout: result.view.layout, expanded: { mode: "collapsed" as const, ids }, groupBy: BY, ...(pivot ? { pivot } : null) };
  }

  for (const pivot of [undefined, { columnId: "qty" }]) {
    it(`sizes each set from the child counts, and an unloaded top-level row stays at level 1${pivot ? " (pivot)" : ""}`, () => {
      // Top level: EU (open, 2 cities: Paris loaded, Rome unloaded), 2 unloaded groups, US (closed), 1 unloaded group.
      const s = stateOfNested({ rows: [at(0, ["EU"], 2), at(1, ["EU", "Paris"], pivot ? 0 : 3), at(5, ["US"], 4)], leafCount: 20 }, 7, [EU], pivot);
      expect(Array.from({ length: 7 }, (_, row) => groupPositionAt(s, row))).toEqual([
        { level: 1, posInSet: 1, setSize: 5 },
        { level: 2, posInSet: 1, setSize: 2 },
        { level: 2, posInSet: 2, setSize: 2 },
        { level: 1, posInSet: 2, setSize: 5 },
        { level: 1, posInSet: 3, setSize: 5 },
        { level: 1, posInSet: 4, setSize: 5 },
        { level: 1, posInSet: 5, setSize: 5 },
      ]);
    });
  }

  it("reads a closed group with a child count as one row of its set, never as the parent of the rows after it", () => {
    const s = stateOfNested({ rows: [at(0, ["EU"], 2), at(3, ["US"], 4)], leafCount: 20 }, 5, []);
    expect(groupPositionAt(s, 1)).toEqual({ level: 1, posInSet: 2, setSize: 5 });
    expect(groupPositionAt(s, 3)).toEqual({ level: 1, posInSet: 4, setSize: 5 });
  });

  it("places the rows of an open innermost group under it", () => {
    const s = stateOfNested({ rows: [at(0, ["EU"], 1), at(1, ["EU", "Paris"], 2), at(4, ["US"], 4)], leafCount: 20 }, 5, [EU, "__group:region=EU/city=Paris"]);
    expect([2, 3, 4].map((row) => groupPositionAt(s, row))).toEqual([
      { level: 3, posInSet: 1, setSize: 2 },
      { level: 3, posInSet: 2, setSize: 2 },
      { level: 1, posInSet: 2, setSize: 2 },
    ]);
  });
});
