import { describe, expect, it } from "vitest";
import { buildImportedRows } from "@/registry/default/blocks/data-grid-io/build-imported-rows";
import { runImportCheck } from "@/registry/default/blocks/data-grid-io/import-check";
import { ALL_MODES, mountMode, type Row } from "./modes";

describe.each(ALL_MODES)("the import check in mode %s", (mode) => {
  it("reads the answer and leaves the grid data, the count, and the saves unchanged", async () => {
    const grid = await mountMode(mode);
    const before = { ids: grid.dataIds(), held: grid.held(), total: grid.state().totalRowCount };
    const state = grid.state();
    const built = await buildImportedRows<Row>({
      dataRows: [["Imported", "7"], ["Other", "8"]],
      mapping: [
        { importColumnIndex: 0, gridColumnId: "name" },
        { importColumnIndex: 1, gridColumnId: "n" },
      ],
      columns: state.visibleColumns as never,
      cellTypes: state.cellTypes as never,
      createRow: (index) => ({ id: `new-${index}`, name: "", n: 0 }),
    });
    const seen: Row[][] = [];
    const check = await runImportCheck<Row>(
      (rows) => {
        seen.push(rows);
        return { rejected: [{ rowIndex: 1, columnId: "n", message: "taken" }], summary: { created: 1, skipped: 1 } };
      },
      built.rows,
      { signal: new AbortController().signal, mapping: [], fileName: "people.csv", rejected: built.rejected },
      new Set(state.visibleColumns.map((column) => column.id)),
    );
    expect(seen[0]).toHaveLength(2);
    expect(check).toEqual({ status: "checked", refusals: [{ rowIndex: 1, columnId: "n", message: "taken" }], more: 0, summary: { created: 1, skipped: 1 } });
    await grid.settle();
    expect(grid.dataIds()).toEqual(before.ids);
    expect(grid.held()).toEqual(before.held);
    expect(grid.state().totalRowCount).toBe(before.total);
    expect(grid.changes).toHaveLength(0);
    expect(grid.saves).toHaveLength(0);
  });
});
