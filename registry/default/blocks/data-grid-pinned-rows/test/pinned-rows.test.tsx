import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGrid } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridPinnedRows, type UseDataGridPinnedRowsOptions } from "../use-data-grid-pinned-rows";
import { aggregateRow, serverAggregateRow } from "../pinned-row-source";
import { gridAttrSelector } from "@/registry/default/blocks/data-grid/data-grid-sdk";

type Row = { id: string; name: string; qty: number };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name", width: 120 },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", width: 80 },
];

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: String(i), name: `Row ${i}`, qty: i }));
}

afterEach(cleanup);

// jsdom performs no layout; drive useRowWindow's viewport math by stubbing clientHeight.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return 360; // 10 rows visible at rowHeight 36
    },
  });
});

const totals: Row = { id: "totals", name: "Total", qty: 45 };

/** Wires `useDataGridPinnedRows` into a plain `DataGrid` render — the add-on's one-line-swap
 * consumer shape (see the fill-handle.mdx/multiplayer-presence.mdx precedent), so every test below
 * exercises the real hook -> `rowBands` prop -> root.tsx arithmetic pipeline end to end. */
function PinnedGrid(
  props: {
    columns?: readonly ColumnDef<Row, unknown>[];
    data: readonly Row[];
    getRowId?: (row: Row, index: number) => string;
  } & UseDataGridPinnedRowsOptions,
) {
  const { topRows, bottomRows, data, columns: cols = columns, getRowId = (r: Row) => r.id } = props;
  const { plugin: pinnedPlugin } = useDataGridPinnedRows({ topRows, bottomRows });
  return <DataGrid data={data} columns={cols} getRowId={getRowId} plugins={[pinnedPlugin]} />;
}

describe("pinned rows — inline source identity", () => {
  function captureIdentity(build: () => UseDataGridPinnedRowsOptions) {
    const plugins: unknown[] = [];
    function Probe() {
      plugins.push(useDataGridPinnedRows(build()).plugin);
      return null;
    }
    const view = render(<Probe />);
    view.rerender(<Probe />);
    return plugins;
  }

  it("inline aggregateRow with equal specs keeps the plugin across a rerender", () => {
    const plugins = captureIdentity(() => ({ bottomRows: [aggregateRow({ qty: "sum" })] }));
    expect(plugins).toHaveLength(2);
    expect(plugins[1]).toBe(plugins[0]);
  });

  it("inline aggregateRow with different specs rebuilds the plugin", () => {
    const plugins: unknown[] = [];
    function Probe({ spec }: { spec: "sum" | "avg" }) {
      plugins.push(useDataGridPinnedRows({ bottomRows: [aggregateRow({ qty: spec })] }).plugin);
      return null;
    }
    const view = render(<Probe spec="sum" />);
    view.rerender(<Probe spec="avg" />);
    expect(plugins[1]).not.toBe(plugins[0]);
  });

  it("inline serverAggregateRow with the same fetch keeps the plugin", () => {
    const fetch = async () => ({});
    const plugins = captureIdentity(() => ({ bottomRows: [serverAggregateRow({ fetch } as never)] }));
    expect(plugins[1]).toBe(plugins[0]);
  });

  it("renders one band row for an inline aggregateRow across rerenders", () => {
    function Grid() {
      const { plugin } = useDataGridPinnedRows({ bottomRows: [aggregateRow({ qty: "sum" })] });
      return <DataGrid data={makeRows(3)} columns={columns} getRowId={(r) => r.id} plugins={[plugin]} />;
    }
    const view = render(<Grid />);
    view.rerender(<Grid />);
    view.rerender(<Grid />);
    expect(document.querySelector(gridAttrSelector("pinnedRowBand", "bottom"))!.querySelectorAll('[role="row"]')).toHaveLength(1);
  });
});

describe("pinned rows — inline plain row identity", () => {
  it("settles with an inline plain row object and keeps the plugin for equal values", () => {
    const { result, rerender } = renderHook(() => useDataGridPinnedRows({ topRows: [{ id: "totals", name: "Total", qty: 45 }] }));
    const first = result.current.plugin;
    rerender();
    rerender();
    expect(result.current.plugin).toBe(first);
  });

  it("rebuilds the plugin when an inline plain row changes a value", () => {
    let qty = 1;
    const { result, rerender } = renderHook(() => useDataGridPinnedRows({ topRows: [{ id: "totals", qty }] }));
    const first = result.current.plugin;
    qty = 2;
    rerender();
    expect(result.current.plugin).not.toBe(first);
    expect(result.current.plugin.rowBands?.top).toEqual([{ id: "totals", qty: 2 }]);
  });
});

describe("pinned rows — band rendering", () => {
  it("renders no pinned bands when the hook's options are omitted", () => {
    render(<DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} />);
    expect(document.querySelector(gridAttrSelector("pinnedRowBand"))).toBeNull();
  });

  it("renders a pinned-top band with one row per `top` entry", () => {
    render(<PinnedGrid data={makeRows(5)} topRows={[totals]} />);
    const band = document.querySelector(gridAttrSelector("pinnedRowBand", "top"));
    expect(band).not.toBeNull();
    expect(band!.querySelectorAll('[role="row"]').length).toBe(1);
  });

  it("renders a pinned-bottom band independently of pinned-top", () => {
    render(<PinnedGrid data={makeRows(5)} bottomRows={[totals, totals]} />);
    const topBand = document.querySelector(gridAttrSelector("pinnedRowBand", "top"));
    const bottomBand = document.querySelector(gridAttrSelector("pinnedRowBand", "bottom"));
    expect(topBand).toBeNull();
    expect(bottomBand).not.toBeNull();
    expect(bottomBand!.querySelectorAll('[role="row"]').length).toBe(2);
  });

  it("renders both bands together", () => {
    render(<PinnedGrid data={makeRows(5)} topRows={[totals]} bottomRows={[totals]} />);
    expect(document.querySelector(gridAttrSelector("pinnedRowBand", "top"))).not.toBeNull();
    expect(document.querySelector(gridAttrSelector("pinnedRowBand", "bottom"))).not.toBeNull();
  });

  it("pinned cells display the pinned row's own values via the same cell-type pipeline as data cells", () => {
    render(<PinnedGrid data={makeRows(5)} topRows={[totals]} />);
    const band = document.querySelector(gridAttrSelector("pinnedRowBand", "top"))!;
    expect(band.textContent).toContain("Total");
    expect(band.textContent).toContain("45");
  });

  it("resolves a pinned row's cell ctx rowId through the grid's getRowId", () => {
    const seenRowIds: (string | undefined)[] = [];
    const cols: readonly ColumnDef<Row, unknown>[] = [
      {
        id: "name",
        header: "Name",
        accessorKey: "name",
        width: 120,
        renderCell: (ctx) => {
          seenRowIds.push(ctx.rowId);
          return String(ctx.value);
        },
      },
      { id: "qty", header: "Qty", accessorKey: "qty", type: "number", width: 80 },
    ];
    render(<PinnedGrid data={makeRows(5)} columns={cols} topRows={[totals]} />);
    expect(seenRowIds).toContain("totals");
  });

  function rowIdRecordingColumns(seen: string[]): readonly ColumnDef<Row, unknown>[] {
    return [
      {
        id: "name",
        header: "Name",
        accessorKey: "name",
        width: 120,
        renderCell: (ctx) => {
          seen.push(ctx.rowId);
          return String(ctx.value);
        },
      },
    ];
  }

  it("gives a pinned row a band id when getRowId throws on it", () => {
    const seen: string[] = [];
    const aggregate = { qty: 45 } as unknown as Row;
    const getRowId = (r: Row) => r.id.toString();
    render(
      <PinnedGrid data={makeRows(2)} columns={rowIdRecordingColumns(seen)} getRowId={getRowId} topRows={[aggregate]} bottomRows={[totals, aggregate]} />,
    );
    expect(seen).toContain("__pinned-top-0");
    expect(seen).toContain("totals");
    expect(seen).toContain("__pinned-bottom-1");
  });

  it("resolves a pinned row's id through a swapped getRowId", () => {
    const seen: string[] = [];
    const cols = rowIdRecordingColumns(seen);
    const first = (r: Row) => `a-${r.id}`;
    const second = (r: Row) => `b-${r.id}`;
    const view = render(<PinnedGrid data={makeRows(2)} columns={cols} getRowId={first} topRows={[totals]} />);
    expect(seen).toContain("a-totals");
    view.rerender(<PinnedGrid data={makeRows(2)} columns={cols} getRowId={second} topRows={[totals]} />);
    expect(seen.filter((id) => id.endsWith("totals")).at(-1)).toBe("b-totals");
  });

  it("gives a pinned row a band id when getRowId returns an empty or non-string id", () => {
    const seen: string[] = [];
    const getRowId = (r: Row) => (r.id === "totals" ? "" : r.id === "count" ? (7 as unknown as string) : r.id);
    const count: Row = { id: "count", name: "Count", qty: 2 };
    render(
      <PinnedGrid data={makeRows(2)} columns={rowIdRecordingColumns(seen)} getRowId={getRowId} topRows={[totals]} bottomRows={[count]} />,
    );
    expect(seen).toContain("__pinned-top-0");
    expect(seen).toContain("__pinned-bottom-0");
    expect(seen).not.toContain("");
  });

  it("pinned-row cells align to the same column tracks as data cells (shared grid-template-columns)", () => {
    render(<PinnedGrid data={makeRows(5)} topRows={[totals]} />);
    const canvas = document.querySelector(gridAttrSelector("rowsCanvas")) as HTMLElement;
    const band = document.querySelector(gridAttrSelector("pinnedRowBand", "top")) as HTMLElement;
    expect(band.style.gridTemplateColumns).toBe(canvas.style.gridTemplateColumns);
  });
});

describe("pinned rows — readOnly default", () => {
  it("pinned cells are readOnly by default (data-readonly present) even though the grid itself is editable", () => {
    render(<PinnedGrid data={makeRows(5)} topRows={[totals]} />);
    const pinnedCells = document.querySelectorAll(gridAttrSelector("pinnedRow"));
    expect(pinnedCells.length).toBeGreaterThan(0);
    pinnedCells.forEach((cell) => expect(cell).toHaveAttribute("data-readonly"));
  });

  it("a column's own readOnly: false overrides the pinned-row default", () => {
    const editableColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name", width: 120, readOnly: false },
      { id: "qty", header: "Qty", accessorKey: "qty", type: "number", width: 80 },
    ];
    render(<PinnedGrid data={makeRows(5)} columns={editableColumns} topRows={[totals]} />);
    const nameCell = document.querySelector(`${gridAttrSelector("pinnedRow")}[data-column-id="name"]`);
    expect(nameCell).not.toHaveAttribute("data-readonly");
    const qtyCell = document.querySelector(`${gridAttrSelector("pinnedRow")}[data-column-id="qty"]`);
    expect(qtyCell).toHaveAttribute("data-readonly");
  });

  it("data rows stay editable (no data-readonly) when the grid isn't readOnly, unaffected by pinned rows existing", () => {
    render(<PinnedGrid data={makeRows(5)} topRows={[totals]} />);
    const dataCell = document.querySelector(`[role="gridcell"]:not(${gridAttrSelector("pinnedRow")})`);
    expect(dataCell).not.toHaveAttribute("data-readonly");
  });
});

describe("pinned rows — aria index layout", () => {
  it("aria-rowcount includes the header, data rows, and both pinned bands", () => {
    render(<PinnedGrid data={makeRows(5)} topRows={[totals]} bottomRows={[totals, totals]} />);
    // 1 header + 1 pinned-top + 5 data + 2 pinned-bottom = 9
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "9");
  });

  it("orders aria-rowindex as header=1, pinned-top next, then data rows, pinned-bottom last", () => {
    render(<PinnedGrid data={makeRows(3)} topRows={[totals]} bottomRows={[totals]} />);
    const topRow = document.querySelector(`${gridAttrSelector("pinnedRowBand", "top")} [role="row"]`);
    expect(topRow).toHaveAttribute("aria-rowindex", "2");

    const dataRows = screen
      .getAllByRole("row")
      .filter((r) => !r.closest(gridAttrSelector("pinnedRowBand")) && r.getAttribute("aria-rowindex") !== null);
    expect(dataRows.map((r) => r.getAttribute("aria-rowindex"))).toEqual(["3", "4", "5"]);

    const bottomRow = document.querySelector(`${gridAttrSelector("pinnedRowBand", "bottom")} [role="row"]`);
    expect(bottomRow).toHaveAttribute("aria-rowindex", "6");
  });

  it("data rows shift aria-rowindex by the pinned-top count even with no pinned-bottom band", () => {
    render(<PinnedGrid data={makeRows(2)} topRows={[totals, totals]} />);
    const dataRows = screen
      .getAllByRole("row")
      .filter((r) => !r.closest(gridAttrSelector("pinnedRowBand")) && r.getAttribute("aria-rowindex") !== null);
    // header=1, pinned-top=2,3, data starts at 4
    expect(dataRows.map((r) => r.getAttribute("aria-rowindex"))).toEqual(["4", "5"]);
  });
});

describe("pinned rows — not navigable", () => {
  it("pinned cells carry no tabIndex (excluded from roving-tabindex nav)", () => {
    render(<PinnedGrid data={makeRows(5)} topRows={[totals]} />);
    const pinnedCell = document.querySelector(gridAttrSelector("pinnedRow"))!;
    expect(pinnedCell).not.toHaveAttribute("tabindex");
  });
});
