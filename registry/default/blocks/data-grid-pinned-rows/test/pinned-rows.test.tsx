import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGrid, gridAttrSelector } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridPinnedRows, type UseDataGridPinnedRowsOptions } from "../use-data-grid-pinned-rows";

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
  props: { columns?: readonly ColumnDef<Row, unknown>[]; data: readonly Row[] } & UseDataGridPinnedRowsOptions,
) {
  const { topRows, bottomRows, data, columns: cols = columns } = props;
  const { rowBands } = useDataGridPinnedRows({ topRows, bottomRows });
  return <DataGrid data={data} columns={cols} getRowId={(r) => r.id} rowBands={rowBands} />;
}

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
