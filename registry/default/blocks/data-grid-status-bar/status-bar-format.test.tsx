import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DataGridProvider, useDataGridActions, type ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridStatusBar } from "./status-bar";

afterEach(cleanup);

type Row = { id: string; age: number; score: number };

const rows: Row[] = [
  { id: "a", age: 20, score: 1000 },
  { id: "b", age: 21, score: 2000 },
  { id: "c", age: 23, score: 3000 },
];

let actions: ReturnType<typeof useDataGridActions> | null = null;
function Probe() {
  actions = useDataGridActions();
  return null;
}

function renderBar(columns: readonly ColumnDef<Row, unknown>[]) {
  render(
    <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
      <Probe />
      <DataGridStatusBar />
    </DataGridProvider>,
  );
}

function select(from: { row: number; col: number }, to: { row: number; col: number }) {
  act(() => {
    actions!.selectCellAt(from);
    actions!.extendToAt(to);
  });
  return screen.getByRole("status").textContent ?? "";
}

describe("DataGridStatusBar number formatting", () => {
  it("formats a plain number column with the Intl fallback", () => {
    renderBar([{ id: "age", header: "Age", accessorKey: "age", type: "number" }]);
    const text = select({ row: 0, col: 0 }, { row: 2, col: 0 });
    expect(text).toContain("Avg 21.3333");
    expect(text).not.toContain("21.33333");
  });

  it("rounds the aggregates of a number column to its decimals", () => {
    renderBar([{ id: "age", header: "Age", accessorKey: "age", type: "number", options: { decimals: 0 } }]);
    const text = select({ row: 0, col: 0 }, { row: 2, col: 0 });
    expect(text).toContain("Avg 21");
    expect(text).not.toContain("Avg 21.3");
  });

  it("keeps the format option of a single number column", () => {
    renderBar([{ id: "score", header: "Score", accessorKey: "score", type: "number", options: { format: { style: "currency", currency: "USD" } } }]);
    const text = select({ row: 0, col: 0 }, { row: 2, col: 0 });
    expect(text).toContain("Sum $6,000.00");
    expect(text).toContain("Min $1,000.00");
  });

  it("uses the Intl fallback when the numbers span several columns", () => {
    renderBar([
      { id: "age", header: "Age", accessorKey: "age", type: "number" },
      { id: "score", header: "Score", accessorKey: "score", type: "number", options: { format: { style: "currency", currency: "USD" } } },
    ]);
    const text = select({ row: 0, col: 0 }, { row: 0, col: 1 });
    expect(text).toContain("Sum 1,020");
  });
});
