import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataGridProvider, useDataGridActions, type ColumnDef, type FilterNode } from "../data-grid";
import { useDataGridSelector } from "../data-grid-sdk";

type Row = { id: string; city: string; code: string };

const data: Row[] = [
  { id: "1", city: "Bonn", code: "A" },
  { id: "2", city: "bonn", code: "a" },
];
const columns: ColumnDef<Row, unknown>[] = [
  { id: "city", header: "City", accessorKey: "city", filter: { matchCase: true } },
  { id: "code", header: "Code", accessorKey: "code" },
];

afterEach(cleanup);

function setup(props: { filterMode?: "client" | "server"; filterState?: FilterNode[]; onFilterChange?: (next: FilterNode[]) => void } = {}) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DataGridProvider data={data} columns={columns} getRowId={(row: Row) => row.id} {...props}>
      {children}
    </DataGridProvider>
  );
  return renderHook(() => ({ actions: useDataGridActions(), filters: useDataGridSelector((s) => s.filterState), view: useDataGridSelector((s) => s.viewIndex) }), { wrapper }).result;
}

describe("filter matchCase on the spec", () => {
  it.each(["client", "server"] as const)("marks the spec of a matchCase column in %s filter mode, so a server applies the same rule", (filterMode) => {
    const onFilterChange = vi.fn();
    const result = setup({ filterMode, onFilterChange });
    act(() => result.current.actions.setFilters([{ columnId: "city", operator: "isAnyOf", value: ["Bonn"] }, { columnId: "code", operator: "equals", value: "a", matchCase: true }]));
    const emitted = onFilterChange.mock.calls.at(-1)![0] as FilterNode[];
    expect(emitted.map((node) => ("matchCase" in node ? node.matchCase : undefined))).toEqual([true, undefined]);
  });

  it("evaluates the client filter with the column rule", () => {
    const result = setup();
    act(() => result.current.actions.setFilters([{ columnId: "city", operator: "isAnyOf", value: ["Bonn"] }]));
    expect(result.current.view).toEqual([0]);
  });

  it("keeps a controlled filterState without the mark in sync, with no rebuild loop", () => {
    const result = setup({ filterState: [{ filterId: "f", columnId: "city", operator: "contains", value: "B" }] });
    expect(result.current.filters).toEqual([{ filterId: "f", columnId: "city", operator: "contains", value: "B", matchCase: true }]);
  });
});
