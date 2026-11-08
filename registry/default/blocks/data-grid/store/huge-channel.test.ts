import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactSelection } from "../selection/compact-selection";
import { emptySelection } from "../selection";
import { remapColumnChannel, remapRowChannel } from "./compute";
import { followActiveRow } from "./data-write";
import { deriveColumnIds, deriveRowIds } from "./selection-state";
import type { AnyColumnDef, DataGridStoreState } from "./types";

const HUGE = 100_000;
const identity = (count: number) => Array.from({ length: count }, (_, i) => i);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("store channel walks over 100,000 checked rows", () => {
  it("remapRowChannel follows the records into a reversed view without listing the channel", () => {
    const toArray = vi.spyOn(CompactSelection.prototype, "toArray");
    const checked = CompactSelection.fromSingleSelection([0, HUGE / 2]);
    const prev = identity(HUGE);
    const next = remapRowChannel(checked, prev, prev.slice().reverse());
    expect(toArray).not.toHaveBeenCalled();
    expect(next.runs()).toEqual([[HUGE / 2, HUGE]]);
  });

  it("remapColumnChannel follows the columns by id without listing the channel", () => {
    const toArray = vi.spyOn(CompactSelection.prototype, "toArray");
    const columns = [{ id: "a" }, { id: "b" }, { id: "c" }] as unknown as AnyColumnDef[];
    const next = remapColumnChannel(CompactSelection.fromArray([0, 2]), columns, [columns[2]!, columns[0]!]);
    expect(toArray).not.toHaveBeenCalled();
    expect(next.runs()).toEqual([[0, 2]]);
  });

  it("deriveRowIds and deriveColumnIds list the ids without listing the channel", () => {
    const data = identity(HUGE).map((i) => ({ id: `r${i}` }));
    const s = {
      data,
      viewIndex: identity(HUGE),
      getRowId: (row: { id: string }) => row.id,
      visibleColumns: [{ id: "a" }, { id: "b" }],
      selection: { ...emptySelection(), rows: CompactSelection.fromSingleSelection([0, HUGE]), columns: CompactSelection.fromSingleSelection(1) },
    } as unknown as Parameters<typeof deriveRowIds>[0];
    const toArray = vi.spyOn(CompactSelection.prototype, "toArray");
    const rowIds = deriveRowIds(s);
    expect(deriveColumnIds(s)).toEqual(["b"]);
    expect(toArray).not.toHaveBeenCalled();
    expect(rowIds.length).toBe(HUGE);
    expect(rowIds[HUGE - 1]).toBe(`r${HUGE - 1}`);
  });

  it("followActiveRow keeps the checked records after an insert without listing the channel", () => {
    const data = identity(HUGE).map((i) => ({ id: i }));
    const nextData = [{ id: -1 }, ...data];
    const s = {
      data,
      viewIndex: identity(HUGE),
      activeCell: null,
      selection: { ...emptySelection(), rows: CompactSelection.fromSingleSelection([0, HUGE]) },
    } as unknown as DataGridStoreState;
    const toArray = vi.spyOn(CompactSelection.prototype, "toArray");
    const followed = followActiveRow(s, nextData, identity(HUGE + 1));
    expect(toArray).not.toHaveBeenCalled();
    expect(followed.selection.rows.runs()).toEqual([[1, HUGE + 1]]);
  });
});
