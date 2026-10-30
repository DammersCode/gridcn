import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataGridLazyGuard } from "./lazy-guard";
import { DataGridProvider, type ColumnDef, type FilterNode, type SortSpec } from "@/registry/default/blocks/data-grid/data-grid";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const data: Row[] = [{ id: "a", name: "A" }];
const getRowId = (row: Row) => row.id;

function renderGuard(sortMode: "client" | "server", sortState: SortSpec[]) {
  const tree = (sorts: SortSpec[]) => (
    <DataGridProvider data={data} columns={columns} getRowId={getRowId} sortMode={sortMode} sortState={sorts}>
      <DataGridLazyGuard hasHoles />
    </DataGridProvider>
  );
  const view = render(tree(sortState));
  return (next: SortSpec[]) => act(() => view.rerender(tree(next)));
}

function renderFilterGuard(filterMode: "client" | "server", filterState: FilterNode[]) {
  const tree = (filters: FilterNode[]) => (
    <DataGridProvider data={data} columns={columns} getRowId={getRowId} filterMode={filterMode} filterState={filters}>
      <DataGridLazyGuard hasHoles />
    </DataGridProvider>
  );
  const view = render(tree(filterState));
  return (next: FilterNode[]) => act(() => view.rerender(tree(next)));
}

const nameFilter: FilterNode[] = [{ columnId: "name", operator: "contains", value: "A" }];

afterEach(() => vi.restoreAllMocks());

// the guard warns once per module, so the silent case runs before the warning case
describe("DataGridLazyGuard", () => {
  it("stays silent on a sort change under sortMode server", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rerender = renderGuard("server", []);
    rerender([{ columnId: "name", direction: "asc" }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent on a filter change under filterMode server", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rerender = renderFilterGuard("server", []);
    rerender(nameFilter);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns on a sort change under client sorting", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rerender = renderGuard("client", []);
    rerender([{ columnId: "name", direction: "asc" }]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain("sortMode=\"server\"");
    expect(warn.mock.calls[0]![0]).toContain("filterMode=\"server\"");
  });
});
