import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { DataGridProvider, DataGridRoot, defineColumns, type ServerSpec } from "../data-grid/data-grid";
import { useDataGridStoreApi, type DataGridReadState } from "../data-grid/data-grid-sdk";
import { useDataGridServerRows } from "../data-grid-server/data-grid-server";
import { fakeServer, rowsOf, type Row } from "../data-grid-server/group-fake-server.test-helper";
import { useDefaultHeaderMenuItems, type GridMenuItemSpec } from "./menu-items";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type ItemSpec = Exclude<GridMenuItemSpec, { separator: true }>;
const item = (specs: GridMenuItemSpec[], id: string) => specs.find((s): s is ItemSpec => !("separator" in s) && s.id === id);
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));

type Probe = { specs: (columnId: string) => GridMenuItemSpec[]; state: () => DataGridReadState };

function ColumnProbe({ columnId, byColumn }: { columnId: string; byColumn: Map<string, GridMenuItemSpec[]> }) {
  byColumn.set(columnId, useDefaultHeaderMenuItems({ columnId, scrollRoot: null }));
  return null;
}

function HeaderProbe({ probe, columnIds }: { probe: Partial<Probe>; columnIds: string[] }) {
  const store = useDataGridStoreApi();
  const byColumn = new Map<string, GridMenuItemSpec[]>();
  probe.state = store.getState;
  probe.specs = (columnId) => byColumn.get(columnId) ?? [];
  return columnIds.map((columnId) => <ColumnProbe key={columnId} columnId={columnId} byColumn={byColumn} />);
}

describe("the pivot items on a client grid", () => {
  type Sale = { id: string; region: string; year: number; amount: number };
  const columns = defineColumns<Sale>()([
    { id: "region", header: "Region", accessorKey: "region", type: "text" },
    { id: "year", header: "Year", accessorKey: "year", type: "number" },
    { id: "amount", header: "Amount", accessorKey: "amount", type: "number", aggregate: "sum" },
  ] as const);
  const sales: Sale[] = [
    { id: "s0", region: "EU", year: 2024, amount: 1 },
    { id: "s1", region: "US", year: 2025, amount: 2 },
  ];

  it("turns the pivot off with the last Ungroup, warns nothing, and a later Group by brings no pivot back", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onPivotChange = vi.fn();
    const probe: Partial<Probe> = {};
    render(
      <DataGridProvider data={sales} columns={columns} getRowId={(row) => row.id} defaultGroupBy={["region"]} defaultPivot={{ columnIds: ["year"] }} onPivotChange={onPivotChange}>
        <DataGridRoot>
          <HeaderProbe probe={probe} columnIds={["region"]} />
        </DataGridRoot>
      </DataGridProvider>,
    );
    act(() => item(probe.specs!("region"), "ungroup")!.onClick!());
    expect([probe.state!().groupBy, probe.state!().pivotColumnIds]).toEqual([[], []]);
    expect(onPivotChange).toHaveBeenCalledWith({ columnIds: [] });
    act(() => item(probe.specs!("region"), "group-by")!.onClick!());
    expect([probe.state!().groupBy, probe.state!().pivotColumnIds]).toEqual([["region"], []]);
    expect(warn.mock.calls.filter(([message]) => String(message).includes("pivot"))).toEqual([]);
  });
});

describe("the pivot items on a server grid", () => {
  const columns = defineColumns<Row>()([
    { id: "region", header: "Region", accessorKey: "region", type: "text" },
    { id: "city", header: "City", accessorKey: "city", type: "text" },
    { id: "id", header: "Id", accessorKey: "id", type: "text", sortable: false },
    { id: "qty", header: "Qty", accessorKey: "qty", type: "number", aggregate: "sum", groupable: false },
  ] as const);
  const SUM = { columnId: "qty", reducer: "sum" } as const;

  function mount(defaultSpec: Partial<ServerSpec>, wrapper: (children: ReactNode) => ReactNode = (children) => children) {
    const server = fakeServer(rowsOf({ A: 2, B: 2 }));
    const probe: Partial<Probe> = {};
    function Grid() {
      const rows = useDataGridServerRows<Row>({ mode: "scroll", fetchRows: server.fetchRows as never, overscan: 0, loadDelayMs: 0, defaultSpec });
      return (
        <DataGridProvider {...rows.providerProps} columns={columns}>
          <DataGridRoot>
            <HeaderProbe probe={probe} columnIds={["region", "city", "id"]} />
          </DataGridRoot>
        </DataGridProvider>
      );
    }
    render(wrapper(<Grid />));
    return { server, probe: probe as Probe };
  }

  it("hides Pivot by while the source cannot send a pivot, and keeps Turn off pivot while spec.pivot is set", async () => {
    const plain = mount({ groupBy: ["region"] });
    await waitFor(() => expect(plain.server.calls.length).toBeGreaterThan(0));
    expect(item(plain.probe.specs("city"), "pivot-by")).toBeUndefined();
    cleanup();
    const pivoted = mount({ groupBy: ["region"], pivot: { columnIds: ["city"] } });
    await waitFor(() => expect(pivoted.server.calls.length).toBeGreaterThan(0));
    expect(item(pivoted.probe.specs("region"), "pivot-off")).toBeDefined();
  });

  it("hides Pivot by on a column with sortable false", async () => {
    const { server, probe } = mount({ groupBy: ["region"], aggregates: [SUM] });
    await waitFor(() => expect(server.calls.length).toBeGreaterThan(0));
    expect(item(probe.specs("city"), "pivot-by")).toBeDefined();
    expect(item(probe.specs("id"), "pivot-by")).toBeUndefined();
  });

  it.each([
    ["", (children: ReactNode) => children],
    [" under StrictMode", (children: ReactNode) => <StrictMode>{children}</StrictMode>],
  ])("sends exactly one request with spec.pivot after a Pivot by click%s", async (_, wrapper) => {
    const { server, probe } = mount({ groupBy: ["region"], aggregates: [SUM] }, wrapper);
    await waitFor(() => expect(server.calls.length).toBeGreaterThan(0));
    await settle();
    const before = server.calls.length;
    act(() => item(probe.specs("city"), "pivot-by")!.onClick!());
    await settle();
    expect(server.calls.slice(before).map((call) => call.spec.pivot)).toEqual([{ columnIds: ["city"] }]);
    expect(probe.state().pivotColumnIds).toEqual(["city"]);
  });

  it("drops spec.pivot with the last Ungroup, and a later Group by sends no pivot", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { server, probe } = mount({ groupBy: ["region"], aggregates: [SUM], pivot: { columnIds: ["city"] } });
    await waitFor(() => expect(server.calls.length).toBeGreaterThan(0));
    act(() => item(probe.specs("region"), "ungroup")!.onClick!());
    await settle();
    // An ungrouped server grid sorts on the server, so its menu offers no Group by; the group panel calls the same action.
    act(() => probe.state().actions.toggleGroupBy("region"));
    await waitFor(() => expect(server.calls.at(-1)!.spec.groupBy).toEqual(["region"]));
    expect(server.calls.at(-1)!.spec.pivot).toBeUndefined();
    expect(probe.state().pivotColumnIds).toEqual([]);
    expect(warn.mock.calls.filter(([message]) => String(message).includes("pivot"))).toEqual([]);
  });
});
