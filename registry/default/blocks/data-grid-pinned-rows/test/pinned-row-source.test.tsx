import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DataGrid, useDataGridActions, type ColumnDef, type DataGridActions } from "@/registry/default/blocks/data-grid/data-grid";
import { gridAttrSelector } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { aggregateRow, isPinnedRowSource, serverAggregateRow } from "../pinned-row-source";
import { useDataGridPinnedRows } from "../use-data-grid-pinned-rows";

type Row = { id: string; item: string; price: number };

// The accessor of "label" reads item; a source row still shows its value by column id.
const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "label", header: "Label", accessorKey: "item", width: 120 },
  { id: "price", header: "Price", accessorKey: "price", type: "number", width: 80 },
];
const data: Row[] = [
  { id: "a", item: "A", price: 10 },
  { id: "b", item: "B", price: 5 },
];

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 360 });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const bandText = (position: "top" | "bottom") => document.querySelector(gridAttrSelector("pinnedRowBand", position))?.textContent ?? "";
const flush = () => act(async () => {});

function Grid(props: { top?: readonly unknown[]; bottom?: readonly unknown[]; onSave?: () => Promise<undefined>; onActions?: (a: DataGridActions) => void }) {
  const { plugin } = useDataGridPinnedRows({ topRows: props.top, bottomRows: props.bottom });
  function Probe() {
    props.onActions?.(useDataGridActions());
    return null;
  }
  return (
    <DataGrid data={data} columns={columns} getRowId={(r) => r.id} plugins={[plugin]} onSave={props.onSave}>
      <Probe />
    </DataGrid>
  );
}

describe("aggregateRow", () => {
  it("is a frozen source", () => {
    const row = aggregateRow({ price: "sum" });
    expect(isPinnedRowSource(row)).toBe(true);
    expect(Object.isFrozen(row)).toBe(true);
    expect(isPinnedRowSource({ kind: "aggregate" })).toBe(false);
  });

  it("shows the reduced value and the fixed cells by column id", () => {
    render(<Grid bottom={[aggregateRow({ price: "sum" }, { cells: { id: "total", label: "Total" } })]} />);
    const text = bandText("bottom");
    expect(text).toContain("Total");
    expect(text).toContain("15");
  });

  it("counts one band row and keeps the band when declared inline", () => {
    render(<Grid top={[aggregateRow({ price: "max" })]} />);
    expect(document.querySelectorAll(`${gridAttrSelector("pinnedRowBand", "top")} [role="row"]`)).toHaveLength(1);
    expect(bandText("top")).toContain("10");
  });
});

describe("useDataGridPinnedRows entry identity", () => {
  it("keeps the plugin while the entries stay identical", () => {
    const TOTALS = aggregateRow({ price: "sum" });
    const { result, rerender } = renderHook(() => useDataGridPinnedRows({ bottomRows: [TOTALS] }));
    const first = result.current.plugin;
    rerender();
    expect(result.current.plugin).toBe(first);
  });

  it("builds a new plugin when an entry changes", () => {
    const { result, rerender } = renderHook(({ row }) => useDataGridPinnedRows({ bottomRows: [row] }), { initialProps: { row: aggregateRow({ price: "sum" }) } });
    const first = result.current.plugin;
    rerender({ row: aggregateRow({ price: "max" }) });
    expect(result.current.plugin).not.toBe(first);
  });
});

describe("serverAggregateRow", () => {
  function setup(extra: { refreshAfterSave?: false } = {}) {
    const calls: Array<(v: Record<string, unknown>) => void> = [];
    const source = serverAggregateRow({
      debounceMs: 0,
      cells: { label: "Server total" },
      fetchAggregates: () => new Promise((resolve) => calls.push(resolve)),
      ...extra,
    });
    return { calls, source };
  }

  it("dims the band while loading and shows the values when they land", async () => {
    const { calls, source } = setup();
    render(<Grid bottom={[source]} />);
    const band = () => document.querySelector(gridAttrSelector("pinnedRowBand", "bottom"))!;
    expect(band().getAttribute("data-status")).toBe("loading");
    await act(async () => calls[0]!({ price: 99 }));
    expect(band().getAttribute("data-status")).toBe("ready");
    expect(bandText("bottom")).toContain("99");
    expect(bandText("bottom")).toContain("Server total");
  });

  it("fetches again once the pending saves settle", async () => {
    const { calls, source } = setup();
    let actions!: DataGridActions;
    let finishSave!: () => void;
    const onSave = () => new Promise<undefined>((resolve) => (finishSave = () => resolve(undefined)));
    render(<Grid bottom={[source]} onSave={onSave} onActions={(a) => (actions = a)} />);
    await act(async () => calls[0]!({ price: 15 }));
    await act(async () => actions.commitCellValue({ rowId: "a", columnId: "price" }, 20));
    expect(calls).toHaveLength(1);
    await act(async () => finishSave());
    await flush();
    expect(calls).toHaveLength(2);
  });

  it("does not fetch after a save with refreshAfterSave false", async () => {
    const { calls, source } = setup({ refreshAfterSave: false });
    let actions!: DataGridActions;
    let finishSave!: () => void;
    const onSave = () => new Promise<undefined>((resolve) => (finishSave = () => resolve(undefined)));
    render(<Grid bottom={[source]} onSave={onSave} onActions={(a) => (actions = a)} />);
    await act(async () => calls[0]!({ price: 15 }));
    await act(async () => actions.commitCellValue({ rowId: "a", columnId: "price" }, 20));
    await act(async () => finishSave());
    await flush();
    expect(calls).toHaveLength(1);
  });

  it("warns once in development when one source sits in both bands", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { source } = setup();
    render(<Grid top={[source]} bottom={[source]} />);
    await flush();
    expect(warn.mock.calls.filter(([m]) => String(m).includes("serverAggregateRow"))).toHaveLength(1);
  });
});
