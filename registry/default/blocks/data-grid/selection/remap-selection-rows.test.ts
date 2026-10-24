import { describe, expect, it } from "vitest";
import { CompactSelection } from "./compact-selection";
import { remapSelectionRows } from "./remap-selection-rows";
import { emptySelection, extendTo, selectCell } from "./selection-ops";

const swapFirstTwo = Int32Array.from([1, 0, 2, 3, 4]);
const rotate = Int32Array.from([4, 0, 1, 2, 3]);

describe("remapSelectionRows", () => {
  it("moves the row channel and the cursor with their rows", () => {
    const selection = { ...selectCell({ col: 1, row: 0 }), rows: CompactSelection.fromArray([0, 3]) };
    const next = remapSelectionRows(selection, swapFirstTwo);
    expect(next.rows.toArray()).toEqual([1, 3]);
    expect(next.current?.cell).toEqual({ col: 1, row: 1 });
    expect(next.current?.range).toMatchObject({ x: 1, y: 1, width: 1, height: 1 });
  });

  it("keeps a range whose rows stay contiguous", () => {
    const selection = extendTo(selectCell({ col: 0, row: 1 }), { col: 0, row: 2 });
    const next = remapSelectionRows(selection, rotate);
    expect(next.current?.range).toMatchObject({ y: 0, height: 2 });
  });

  it("collapses a range whose rows scatter onto the cursor", () => {
    const selection = extendTo(selectCell({ col: 0, row: 0 }), { col: 0, row: 3 });
    const next = remapSelectionRows(selection, Int32Array.from([0, 4, 2, 3, 1]));
    expect(next.current?.range).toMatchObject({ y: next.current!.cell.row, height: 1 });
  });

  it("returns an empty selection unchanged in shape", () => {
    expect(remapSelectionRows(emptySelection(), rotate).current).toBeNull();
  });
});
