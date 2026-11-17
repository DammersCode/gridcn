import { describe, expect, it } from "vitest";
import type { DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import { groupSaveScope } from "./group-save-scope";

const spec = { sorts: [{ columnId: "city", direction: "asc" as const }], filters: [], searchText: "", groupBy: ["region"], aggregates: [{ columnId: "qty", reducer: "sum" as const }] };
const edit = (...columnIds: string[]) => ({ source: "edit", ops: [{ type: "update", rowId: "r1", row: {}, prev: {}, cells: columnIds.map((columnId) => ({ columnId, value: 1, prev: 0 })) }] }) as unknown as DataChange<unknown>;

describe("groupSaveScope", () => {
  it("reloads everything for a group column, a sort column, a whole-row update, or a non-update", () => {
    expect(groupSaveScope([edit("region")], spec)).toBe("all");
    expect(groupSaveScope([edit("city")], spec)).toBe("all");
    expect(groupSaveScope([{ source: "edit", ops: [{ type: "update", rowId: "r1", row: {}, prev: {} }] } as unknown as DataChange<unknown>], spec)).toBe("all");
    expect(groupSaveScope([{ source: "edit", ops: [{ type: "delete", rowId: "r1", row: {}, index: 0 }] } as unknown as DataChange<unknown>], spec)).toBe("all");
  });

  it("reloads everything while a filter or a search narrows the result", () => {
    expect(groupSaveScope([edit("qty")], { ...spec, searchText: "x" })).toBe("all");
    expect(groupSaveScope([edit("qty")], { ...spec, filters: [{ type: "condition" } as never] })).toBe("all");
  });

  it("names the rows of an aggregate column and skips other columns", () => {
    expect(groupSaveScope([edit("qty")], spec)).toEqual({ rowIds: ["r1"] });
    expect(groupSaveScope([edit("note")], spec)).toBe("none");
  });
});
