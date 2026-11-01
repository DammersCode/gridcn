import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnDef, FilterNode, SortSpec } from "../types";
import { holeRowId } from "../data-grid-sdk";
import { DataGridProvider } from ".";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const getRowId = (row: Row | undefined, index: number) => (row === undefined ? holeRowId(index) : row.id);
const nameFilter: FilterNode[] = [{ columnId: "name", operator: "contains", value: "A" }];
const asc: SortSpec[] = [{ columnId: "name", direction: "asc" }];

function sparse(): Row[] {
  const data = new Array<Row | undefined>(5);
  data[0] = { id: "a", name: "A" };
  return data as Row[];
}
const full = (): Row[] => [{ id: "a", name: "A" }];

type Controlled = { sortState: SortSpec[]; filterState: FilterNode[]; searchText: string };
const idle: Controlled = { sortState: [], filterState: [], searchText: "" };

function mount(data: Row[], modes: { sortMode?: "client" | "server"; filterMode?: "client" | "server" } = {}) {
  const tree = (state: Controlled) => (
    <DataGridProvider data={data} columns={columns} getRowId={getRowId} {...modes} {...state}>
      {null}
    </DataGridProvider>
  );
  const view = render(tree(idle));
  return (next: Partial<Controlled>) => act(() => view.rerender(tree({ ...idle, ...next })));
}

const spyWarn = () => vi.spyOn(console, "warn").mockImplementation(() => {});
const holeWarnings = (warn: ReturnType<typeof spyWarn>) => warn.mock.calls.filter((c) => String(c[0]).includes("unloaded rows"));

afterEach(() => vi.restoreAllMocks());

describe("client sort or filter over unloaded rows", () => {
  it("warns on a client sort change", () => {
    const warn = spyWarn();
    mount(sparse())({ sortState: asc });
    expect(holeWarnings(warn)).toHaveLength(1);
    expect(String(holeWarnings(warn)[0]![0])).toContain('sortMode="server"');
  });

  it("warns on a client filter change", () => {
    const warn = spyWarn();
    mount(sparse())({ filterState: nameFilter });
    expect(holeWarnings(warn)).toHaveLength(1);
  });

  it("warns once per grid across sort and filter changes", () => {
    const warn = spyWarn();
    const change = mount(sparse());
    change({ sortState: asc });
    change({ sortState: asc, filterState: nameFilter });
    change({});
    expect(holeWarnings(warn)).toHaveLength(1);
  });

  it("warns again for another grid", () => {
    const warn = spyWarn();
    mount(sparse())({ sortState: asc });
    mount(sparse())({ sortState: asc });
    expect(holeWarnings(warn)).toHaveLength(2);
  });

  it("stays silent under server sort and server filter", () => {
    const warn = spyWarn();
    mount(sparse(), { sortMode: "server", filterMode: "server" })({ sortState: asc, filterState: nameFilter });
    expect(holeWarnings(warn)).toHaveLength(0);
  });

  it("stays silent on a search change", () => {
    const warn = spyWarn();
    mount(sparse())({ searchText: "a" });
    expect(holeWarnings(warn)).toHaveLength(0);
  });

  it("stays silent when every row is loaded", () => {
    const warn = spyWarn();
    mount(full())({ sortState: asc, filterState: nameFilter });
    expect(holeWarnings(warn)).toHaveLength(0);
  });
});
