import { describe, expect, it } from "vitest";
import type { SelectionChangeDetails, SelectionState } from "@/registry/default/blocks/data-grid/data-grid";
import { toPresenceEntries } from "./to-presence-entries";

const columnIds = ["a", "b", "c", "d"];
const cell = (rowId: string, columnId: string) => ({ rowId, columnId });
const empty: SelectionState = { anchor: null, range: null, rangeStack: [], rowIds: [], columnIds: [] };
const details = (rowIds: string[]): SelectionChangeDetails => ({ getValues: () => [], getRowIds: () => rowIds, phase: "end" });

describe("toPresenceEntries", () => {
  it("returns nothing for an empty selection", () => {
    expect(toPresenceEntries(empty, details([]), { id: "u", color: "red", columnIds })).toEqual([]);
  });

  it("spans the range columns in display order, whichever corner comes first", () => {
    const selection = { ...empty, range: { start: cell("r2", "c"), end: cell("r1", "a") } };
    const [entry] = toPresenceEntries(selection, details(["r1", "r2"]), { id: "u", color: "red", columnIds, label: "Ann" });
    expect(entry).toEqual({ id: "u", color: "red", rowIds: ["r1", "r2"], columnIds: ["a", "b", "c"], label: "Ann" });
  });

  it("follows a reordered column order", () => {
    const selection = { ...empty, range: { start: cell("r1", "d"), end: cell("r1", "a") } };
    const [entry] = toPresenceEntries(selection, details(["r1"]), { id: "u", color: "red", columnIds: ["d", "c", "a", "b"] });
    expect(entry!.columnIds).toEqual(["d", "c", "a"]);
  });

  it("unions several ranges and the column channel", () => {
    const selection = { ...empty, range: { start: cell("r1", "a"), end: cell("r1", "a") }, rangeStack: [{ start: cell("r2", "d"), end: cell("r2", "d") }], columnIds: ["b"] };
    const [entry] = toPresenceEntries(selection, details(["r1", "r2"]), { id: "u", color: "red", columnIds });
    expect(entry!.columnIds).toEqual(["a", "b", "d"]);
  });

  it("covers every column for checked rows", () => {
    const [entry] = toPresenceEntries({ ...empty, rowIds: ["r3"] }, details(["r3"]), { id: "u", color: "red", columnIds });
    expect(entry!.columnIds).toEqual(columnIds);
  });
});
