import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import type { CellType, ColumnDef } from "../types";
import { DataGridProvider, useDataGridActions, useDataGridViewIndex } from "../store";
import { cellTypes as builtinCellTypes } from "../cell-types/cell-types";

/**
 * Workplan #85: a cell type's `compare` is resolved into the sort path. Before this, every column
 * fell through to the collator over `String(value)`, which segments digit runs — so 1.5 sorted
 * before 1.25 and negatives sorted backwards.
 */

type Row = { id: string; price: number | null; when: string | null; untyped: number };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "price", header: "Price", accessorKey: "price", type: "number" },
  { id: "when", header: "When", accessorKey: "when", type: "date" },
  { id: "untyped", header: "Untyped", accessorKey: "untyped" },
];

function harness(data: Row[], overrides: { cellTypes?: Record<string, CellType> } = {}) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider
        data={data}
        columns={columns}
        getRowId={(r) => r.id}
        onDataChange={() => {}}
        {...(overrides.cellTypes ? { cellTypes: overrides.cellTypes as never } : {})}
      >
        {children}
      </DataGridProvider>
    );
  }
  return renderHook(() => ({ actions: useDataGridActions(), viewIndex: useDataGridViewIndex() }), { wrapper: Wrapper });
}

const decimals: Row[] = [
  { id: "a", price: 1.5, when: null, untyped: 0 },
  { id: "b", price: 1.25, when: null, untyped: 0 },
  { id: "c", price: 1.9, when: null, untyped: 0 },
  { id: "d", price: 10.1, when: null, untyped: 0 },
  { id: "e", price: 2, when: null, untyped: 0 },
];

describe("cell-type compare wired into sorting (#85)", () => {
  it("sorts a number column by true numeric order, not by collated digit runs", () => {
    const { result } = harness(decimals);
    act(() => result.current.actions.setSorts([{ columnId: "price", direction: "asc" }]));
    expect(result.current.viewIndex.map((row) => decimals[row]!.price)).toEqual([1.25, 1.5, 1.9, 2, 10.1]);
  });

  it("sorts negatives ascending, not by magnitude", () => {
    const negatives: Row[] = [
      { id: "a", price: -5, when: null, untyped: 0 },
      { id: "b", price: 3, when: null, untyped: 0 },
      { id: "c", price: -10, when: null, untyped: 0 },
      { id: "d", price: 0, when: null, untyped: 0 },
    ];
    const { result } = harness(negatives);
    act(() => result.current.actions.setSorts([{ columnId: "price", direction: "asc" }]));
    expect(result.current.viewIndex.map((row) => negatives[row]!.price)).toEqual([-10, -5, 0, 3]);
  });

  it("reverses on desc and keeps null cells last in BOTH directions", () => {
    const withNulls: Row[] = [
      { id: "a", price: 2, when: null, untyped: 0 },
      { id: "b", price: null, when: null, untyped: 0 },
      { id: "c", price: 1, when: null, untyped: 0 },
    ];
    const { result } = harness(withNulls);
    act(() => result.current.actions.setSorts([{ columnId: "price", direction: "asc" }]));
    expect(result.current.viewIndex.map((row) => withNulls[row]!.price)).toEqual([1, 2, null]);
    act(() => result.current.actions.setSorts([{ columnId: "price", direction: "desc" }]));
    expect(result.current.viewIndex.map((row) => withNulls[row]!.price)).toEqual([2, 1, null]);
  });

  it("sorts a date column chronologically with nulls last", () => {
    const dates: Row[] = [
      { id: "a", price: 0, when: "2026-12-31", untyped: 0 },
      { id: "b", price: 0, when: null, untyped: 0 },
      { id: "c", price: 0, when: "2026-01-02", untyped: 0 },
    ];
    const { result } = harness(dates);
    act(() => result.current.actions.setSorts([{ columnId: "when", direction: "asc" }]));
    expect(result.current.viewIndex.map((row) => dates[row]!.when)).toEqual(["2026-01-02", "2026-12-31", null]);
  });

  it("leaves a column with no declared type on the default text comparator", () => {
    // `textCellType.compare` is localeCompare, which throws on a number and is strictly worse than
    // the numeric-aware default — an undeclared column must not opt into it.
    const untyped: Row[] = [
      { id: "a", price: 0, when: null, untyped: 10 },
      { id: "b", price: 0, when: null, untyped: 2 },
    ];
    const { result } = harness(untyped);
    act(() => result.current.actions.setSorts([{ columnId: "untyped", direction: "asc" }]));
    expect(result.current.viewIndex.map((row) => untyped[row]!.untyped)).toEqual([2, 10]);
  });

  it("honours a consumer's own compare over the built-in one", () => {
    const reversed: Record<string, CellType> = {
      ...(builtinCellTypes as unknown as Record<string, CellType>),
      number: { ...(builtinCellTypes.number as unknown as CellType), compare: (a, b) => (b as number) - (a as number) },
    };
    const { result } = harness(decimals, { cellTypes: reversed });
    act(() => result.current.actions.setSorts([{ columnId: "price", direction: "asc" }]));
    expect(result.current.viewIndex.map((row) => decimals[row]!.price)).toEqual([10.1, 2, 1.9, 1.5, 1.25]);
  });

  // A comparator that meets a value of the wrong shape either returns NaN (`number`: `a - b`) or
  // throws outright (`text`: `a.localeCompare`). Neither may take the grid down or make the order
  // non-transitive — both degrade to the text ordering for that pair.
  it("survives a NaN-producing comparator on a mistyped value", () => {
    const mixed = [
      { id: "a", price: "oops" as unknown as number, when: null, untyped: 0 },
      { id: "b", price: 2, when: null, untyped: 0 },
      { id: "c", price: 1, when: null, untyped: 0 },
    ] as Row[];
    const { result } = harness(mixed);
    act(() => result.current.actions.setSorts([{ columnId: "price", direction: "asc" }]));
    expect([...result.current.viewIndex].sort()).toEqual([0, 1, 2]);
  });

  it("survives a throwing comparator on a mistyped value", () => {
    type TextRow = { id: string; label: number };
    const textColumns: readonly ColumnDef<TextRow, unknown>[] = [
      { id: "label", header: "Label", accessorKey: "label", type: "text" },
    ];
    // numbers in a `type: "text"` column — `textCellType.compare` calls localeCompare and throws.
    const numbersInText: TextRow[] = [
      { id: "a", label: 10 },
      { id: "b", label: 2 },
    ];
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <DataGridProvider data={numbersInText} columns={textColumns} getRowId={(r) => r.id} onDataChange={() => {}}>
          {children}
        </DataGridProvider>
      );
    }
    const { result } = renderHook(
      () => ({ actions: useDataGridActions(), viewIndex: useDataGridViewIndex() }),
      { wrapper: Wrapper },
    );
    act(() => result.current.actions.setSorts([{ columnId: "label", direction: "asc" }]));
    // the text fallback is numeric-aware, so 2 still precedes 10 instead of the grid crashing
    expect(result.current.viewIndex.map((row) => numbersInText[row]!.label)).toEqual([2, 10]);
  });
});
