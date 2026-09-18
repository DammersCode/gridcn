import { describe, expect, it } from "vitest";
import type { ColumnDef } from "../types";
import { cellTypes } from "../cell-types/cell-types";
import { emptySelection } from "../selection";
import { CompactSelection } from "../selection/compact-selection";
import { MAX_COPY_CELLS, resolveCopyScope, serializeCopyScope } from "./use-grid-clipboard";
import type { DataGridStoreState } from "../store";

type Row = { id: string; name: string; qty: number };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
];

function bigRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: String(i), name: `row-${i}`, qty: i }));
}

/** Minimal fake store state — mirrors use-grid-clipboard.test.ts's fakeState. */
function fakeState(overrides: Partial<DataGridStoreState> = {}): DataGridStoreState {
  const data = overrides.data ?? bigRows(4);
  return {
    data,
    columns,
    visibleColumns: columns,
    viewIndex: data.map((_, i) => i),
    getRowId: (r: Row) => r.id,
    cellTypes: cellTypes as unknown as DataGridStoreState["cellTypes"],
    selection: emptySelection(),
    ...overrides,
  } as unknown as DataGridStoreState;
}

describe("serializeCopyScope cell-count cap", () => {
  it("leaves an uncapped rows-scope copy byte-identical to a per-row/per-cell reference build", () => {
    const data = bigRows(4);
    const s = fakeState({
      data,
      selection: { ...emptySelection(), rows: CompactSelection.fromArray([0, 2, 3]) },
    });
    const scope = resolveCopyScope(s)!;
    expect(scope).toEqual({ kind: "rows", rows: [0, 2, 3] });
    expect(serializeCopyScope(s, scope)).toEqual([
      ["row-0", "0"],
      ["row-2", "2"],
      ["row-3", "3"],
    ]);
  });

  it("leaves an uncapped columns-scope copy byte-identical to a per-row/per-cell reference build", () => {
    const data = bigRows(3);
    const s = fakeState({
      data,
      selection: { ...emptySelection(), columns: CompactSelection.fromArray([0]) },
    });
    const scope = resolveCopyScope(s)!;
    expect(scope).toEqual({ kind: "columns", columns: [0] });
    expect(serializeCopyScope(s, scope)).toEqual([["row-0"], ["row-1"], ["row-2"]]);
  });

  it("truncates a rows-scope copy that would exceed MAX_COPY_CELLS, keeping full-width rows up to the cap", () => {
    // 2 visible columns -> row cap is floor(MAX_COPY_CELLS / 2); pick a row count just over that.
    const rowCap = Math.floor(MAX_COPY_CELLS / columns.length);
    const totalRows = rowCap + 10;
    const data = bigRows(totalRows);
    const s = fakeState({
      data,
      selection: { ...emptySelection(), rows: CompactSelection.fromArray(Array.from({ length: totalRows }, (_, i) => i)) },
    });
    const scope = resolveCopyScope(s)!;
    const result = serializeCopyScope(s, scope);
    expect(result.length).toBe(rowCap);
    expect(result[0]).toEqual(["row-0", "0"]);
    expect(result[rowCap - 1]).toEqual([`row-${rowCap - 1}`, String(rowCap - 1)]);
  });

  it("truncates a columns-scope copy that would exceed MAX_COPY_CELLS, keeping full-width rows up to the cap", () => {
    const selectedCols = 3;
    const wideColumns: readonly ColumnDef<Row, unknown>[] = Array.from({ length: selectedCols }, (_, i) => ({
      id: `c${i}`,
      header: `C${i}`,
      accessorKey: "qty" as const,
    }));
    const rowCap = Math.floor(MAX_COPY_CELLS / selectedCols);
    const totalRows = rowCap + 25;
    const data = bigRows(totalRows);
    const s = fakeState({
      data,
      visibleColumns: wideColumns as unknown as DataGridStoreState["visibleColumns"],
      selection: { ...emptySelection(), columns: CompactSelection.fromArray([0, 1, 2]) },
    });
    const scope = resolveCopyScope(s)!;
    expect(scope).toEqual({ kind: "columns", columns: [0, 1, 2] });
    const result = serializeCopyScope(s, scope);
    expect(result.length).toBe(rowCap);
    expect(result.every((row) => row.length === selectedCols)).toBe(true);
  });

  it("leaves a below-cap rect-scope copy byte-identical", () => {
    const data = bigRows(5);
    const s = fakeState({ data });
    const result = serializeCopyScope(s, { kind: "rect", rect: { x: 0, y: 0, width: 2, height: 5 } });
    expect(result).toEqual([
      ["row-0", "0"],
      ["row-1", "1"],
      ["row-2", "2"],
      ["row-3", "3"],
      ["row-4", "4"],
    ]);
  });

  it("truncates a rect-scope copy above MAX_COPY_CELLS, keeping full-width rows top-down", () => {
    const width = 3;
    const wideColumns: readonly ColumnDef<Row, unknown>[] = Array.from({ length: width }, (_, i) => ({
      id: `c${i}`,
      header: `C${i}`,
      accessorKey: "qty" as const,
      type: "number",
    }));
    const rowCap = Math.max(1, Math.floor(MAX_COPY_CELLS / width));
    const totalRows = rowCap + 5;
    const data = bigRows(totalRows);
    const s = fakeState({
      data,
      visibleColumns: wideColumns as unknown as DataGridStoreState["visibleColumns"],
    });
    const result = serializeCopyScope(s, { kind: "rect", rect: { x: 0, y: 0, width, height: totalRows } });
    expect(result.length).toBe(rowCap);
    expect(result.every((row) => row.length === width)).toBe(true);
    expect(result[rowCap - 1]).toEqual([String(rowCap - 1), String(rowCap - 1), String(rowCap - 1)]);
  });

  it("caps a whole-grid rect from two-stage Ctrl+A at MAX_COPY_CELLS", () => {
    const rowCap = Math.max(1, Math.floor(MAX_COPY_CELLS / columns.length));
    const totalRows = rowCap + 1;
    const data = bigRows(totalRows);
    const s = fakeState({ data });
    const result = serializeCopyScope(s, { kind: "rect", rect: { x: 0, y: 0, width: columns.length, height: totalRows } });
    expect(result.length).toBe(rowCap);
    expect(result[0]).toEqual(["row-0", "0"]);
    expect(result[rowCap - 1]).toEqual([`row-${rowCap - 1}`, String(rowCap - 1)]);
  });
});
