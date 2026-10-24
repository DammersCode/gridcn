import { trackRenders } from "./render-counter.test-helper";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import type { ColumnDef } from "../types";
import { DataGrid, type DataGridApi } from "../data-grid";
import "@/app/global.css";

type Row = { id: string; name: string; qty: number };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
];
const rows: Row[] = Array.from({ length: 5 }, (_, i) => ({ id: String(i), name: `Row ${i}`, qty: i }));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("trackRenders", () => {
  it("counts row and cell renders after one cell edit", async () => {
    const tracker = trackRenders();
    const ref = { current: null as DataGridApi<Row> | null };
    await render(<DataGrid ref={(api) => { ref.current = api; }} data={rows} columns={columns} getRowId={(r) => r.id} />);
    await wait(100);
    const mountCells = tracker.count("DataGridCellImpl");
    expect(mountCells).toBeGreaterThanOrEqual(rows.length * columns.length);

    tracker.reset();
    ref.current!.startEditing({ rowId: "0", columnId: "name" });
    await wait(100);
    ref.current!.actions.commitCellEdit("Edited");
    await wait(100);
    const cells = tracker.count("DataGridCellImpl");
    const rowRenders = tracker.count("DataGridRow");
    console.info(`render-counter: mount cells=${mountCells}; edit+commit cells=${cells} rows=${rowRenders}`, JSON.stringify(tracker.snapshot()));
    expect(cells).toBeGreaterThan(0);
    expect(cells).toBeLessThan(mountCells);
    expect(rowRenders).toBeLessThan(rows.length * 2);
  });
});
