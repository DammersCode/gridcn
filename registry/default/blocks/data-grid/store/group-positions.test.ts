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
