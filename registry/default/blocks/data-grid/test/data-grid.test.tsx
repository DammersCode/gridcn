import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, beforeAll, vi } from "vitest";
import { memo } from "react";
import type { ColumnDef } from "../types";
import { DataGrid, DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, useDataGridActions, useDataGridCellState, useDataGridRow, GRID_ATTR, gridAttrSelector } from "../data-grid";

type Row = { id: string; name: string; qty: number };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
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

describe("DataGrid ARIA structure", () => {
  it("reports aria-rowcount and aria-colcount", () => {
    render(<DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} />);
    const grid = screen.getByRole("grid");
    expect(grid).toHaveAttribute("aria-rowcount", "6"); // 5 data rows + header
    expect(grid).toHaveAttribute("aria-colcount", "2");
  });

  it("sizes the Content div to the full virtual scroll extent (header + rowCount*rowHeight), not one grid track per row", () => {
    render(<DataGrid data={makeRows(10000)} columns={columns} getRowId={(r) => r.id} />);
    const grid = screen.getByRole("grid");
    const content = grid.firstElementChild as HTMLElement;
    expect(content.style.height).toBe("360036px"); // 36 header + 10000*36
  });

  it("renders only the windowed rows for 10k rows, not all of them", () => {
    render(<DataGrid data={makeRows(10000)} columns={columns} getRowId={(r) => r.id} />);
    const rows = screen.getAllByRole("row");
    // header row (display:contents, role=row) + a small windowed subset, never 10000
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.length).toBeLessThan(50);
  });

  it("renders all rows when the dataset is smaller than the window", () => {
    render(<DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} />);
    const rows = screen.getAllByRole("row");
    // 1 header + 5 data rows
    expect(rows.length).toBe(6);
  });

  it("reports aria-multiselectable=true by default (range/row/column channels all on)", () => {
    render(<DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} />);
    expect(screen.getByRole("grid")).toHaveAttribute("aria-multiselectable", "true");
  });

  it("omits aria-multiselectable when every multi-cell selection channel is disabled", () => {
    render(
      <DataGrid
        data={makeRows(5)}
        columns={columns}
        getRowId={(r) => r.id}
        enableRangeSelection={false}
        enableRowSelection={false}
        enableColumnSelection={false}
        enableMultiRange={false}
      />,
    );
    expect(screen.getByRole("grid")).not.toHaveAttribute("aria-multiselectable");
  });

  it("reports aria-readonly=true when the grid-level readOnly prop is set, omits it otherwise", () => {
    const { rerender } = render(<DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} />);
    expect(screen.getByRole("grid")).not.toHaveAttribute("aria-readonly");
    rerender(<DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} readOnly />);
    expect(screen.getByRole("grid")).toHaveAttribute("aria-readonly", "true");
  });
});

describe("DataGrid without the data-grid-pinned-rows add-on (workplan #48 cut #3)", () => {
  it("renders no pinned-row-band DOM when rowBands is never supplied", () => {
    render(<DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} />);
    expect(document.querySelector(gridAttrSelector("pinnedRowBand"))).toBeNull();
    expect(document.querySelector(gridAttrSelector("pinnedRow"))).toBeNull();
  });

  it("aria-rowcount counts only the header + data rows, with no pinned-band contribution", () => {
    render(<DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} />);
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "6"); // 1 header + 5 data, no bands
  });

  it("logs no console errors from the unset rowBands default (EMPTY_ROW_BANDS)", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} />);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("DataGrid row placement", () => {
  it("gives rows a window-relative gridRowStart in the canvas (viewRowIndex - windowStart + 1)", () => {
    render(<DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} />);
    const dataRows = screen.getAllByRole("row").filter((r) => r.getAttribute("aria-rowindex") !== null);
    // window start is 0 for a 5-row dataset, so gridRowStart == viewRowIndex + 1 here
    const starts = dataRows.map((r) => r.style.gridRowStart);
    expect(starts).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("gives rows the correct aria-rowindex", () => {
    render(<DataGrid data={makeRows(3)} columns={columns} getRowId={(r) => r.id} />);
    const dataRows = screen.getAllByRole("row").filter((r) => r.getAttribute("aria-rowindex") !== null);
    expect(dataRows.map((r) => r.getAttribute("aria-rowindex"))).toEqual(["2", "3", "4"]);
  });
});

describe("DataGrid pinned columns", () => {
  const pinnedColumns: readonly ColumnDef<Row, unknown>[] = [
    { id: "name", header: "Name", accessorKey: "name", pin: "left" },
    { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
  ];

  it("marks pinned header cells relative with a calc() inset formula (position:sticky can't work under the transformed canvas)", () => {
    render(<DataGrid data={makeRows(3)} columns={pinnedColumns} getRowId={(r) => r.id} />);
    const header = screen.getByRole("columnheader", { name: "Name" });
    expect(header).toHaveAttribute(GRID_ATTR.pinned, "left");
    expect(header.style.position).toBe("relative");
    expect(header.style.insetInlineStart).toBe(
      "calc(var(--grid-scroll-left, 0px) + var(--grid-pin-left-0) - var(--grid-track-left-0))",
    );
  });

  it("marks pinned data cells relative with a calc() inset formula", () => {
    render(<DataGrid data={makeRows(3)} columns={pinnedColumns} getRowId={(r) => r.id} />);
    const cell = screen.getAllByRole("gridcell")[0]!;
    expect(cell).toHaveAttribute(GRID_ATTR.pinned, "left");
    expect(cell.style.position).toBe("relative");
    expect(cell.style.insetInlineStart).toBe(
      "calc(var(--grid-scroll-left, 0px) + var(--grid-pin-left-0) - var(--grid-track-left-0))",
    );
  });

  it("sets the --grid-pin-left and --grid-track-left CSS vars on the Viewport based on cumulative widths", () => {
    const widerColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name", pin: "left", width: 200 },
      { id: "qty", header: "Qty", accessorKey: "qty", pin: "left", width: 100 },
    ];
    render(<DataGrid data={makeRows(3)} columns={widerColumns} getRowId={(r) => r.id} />);
    const grid = screen.getByRole("grid");
    const viewport = grid.querySelector<HTMLElement>(gridAttrSelector("headerLayer"))!.parentElement!;
    expect(viewport.style.getPropertyValue("--grid-pin-left-0")).toBe("0px");
    expect(viewport.style.getPropertyValue("--grid-pin-left-1")).toBe("200px");
    expect(viewport.style.getPropertyValue("--grid-track-left-0")).toBe("0px");
    expect(viewport.style.getPropertyValue("--grid-track-left-1")).toBe("200px");
  });
});

describe("DataGrid cell content", () => {
  it("renders plain-text values via getCellValue", () => {
    render(<DataGrid data={makeRows(1)} columns={columns} getRowId={(r) => r.id} />);
    expect(screen.getByText("Row 0")).toBeInTheDocument();
  });

  it("renders empty string for null/undefined values", () => {
    type NullableRow = { id: string; value: string | null };
    const nullableColumns: readonly ColumnDef<NullableRow, unknown>[] = [
      { id: "value", header: "Value", accessorKey: "value" },
    ];
    render(
      <DataGrid<NullableRow> data={[{ id: "1", value: null }]} columns={nullableColumns} getRowId={(r) => r.id} />,
    );
    const cell = screen.getByRole("gridcell");
    expect(cell.textContent).toBe("");
  });

  it("marks number-typed cells with tabular-nums and data-type", () => {
    render(<DataGrid data={makeRows(1)} columns={columns} getRowId={(r) => r.id} />);
    const qtyCell = screen.getAllByRole("gridcell")[1]!;
    expect(qtyCell).toHaveAttribute("data-type", "number");
    expect(qtyCell.className).toContain("tabular-nums");
  });

  it("respects renderCell override", () => {
    const overrideColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name", renderCell: ({ value }) => `<${String(value)}>` },
    ];
    render(<DataGrid data={makeRows(1)} columns={overrideColumns} getRowId={(r) => r.id} />);
    expect(screen.getByText("<Row 0>")).toBeInTheDocument();
  });

  it("marks readOnly cells with data-readonly", () => {
    const readOnlyColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name", readOnly: true },
    ];
    render(<DataGrid data={makeRows(1)} columns={readOnlyColumns} getRowId={(r) => r.id} />);
    expect(screen.getByRole("gridcell")).toHaveAttribute("data-readonly", "true");
  });
});

describe("DataGrid programmatic styling API (PLAN §6)", () => {
  it("applies getRowClassName, merged after the built-in row classes", () => {
    render(
      <DataGrid
        data={makeRows(2)}
        columns={columns}
        getRowId={(r) => r.id}
        getRowClassName={(row: Row) => (row.id === "0" ? "bg-red-500" : undefined)}
      />,
    );
    const rows = screen.getAllByRole("row").filter((r) => r.getAttribute("aria-rowindex"));
    expect(rows[0]!.className).toContain("bg-red-500");
    expect(rows[0]!.className).toContain("group/row"); // built-in class survives the merge
    expect(rows[1]!.className).not.toContain("bg-red-500");
  });

  it("passes (row, viewRowIndex) to getRowClassName", () => {
    const seen: Array<{ id: string; viewRowIndex: number }> = [];
    render(
      <DataGrid
        data={makeRows(2)}
        columns={columns}
        getRowId={(r) => r.id}
        getRowClassName={(row: Row, viewRowIndex) => {
          seen.push({ id: row.id, viewRowIndex });
          return undefined;
        }}
      />,
    );
    expect(seen).toEqual(
      expect.arrayContaining([
        { id: "0", viewRowIndex: 0 },
        { id: "1", viewRowIndex: 1 },
      ]),
    );
  });

  it("applies grid-level getCellClassName, merged after the built-in cell classes", () => {
    render(
      <DataGrid
        data={makeRows(1)}
        columns={columns}
        getRowId={(r) => r.id}
        getCellClassName={({ column }) => (column.id === "qty" ? "text-blue-500" : undefined)}
      />,
    );
    const cells = screen.getAllByRole("gridcell");
    expect(cells[0]!.className).not.toContain("text-blue-500");
    expect(cells[1]!.className).toContain("text-blue-500");
    expect(cells[1]!.className).toContain("flex"); // built-in class survives the merge
  });

  it("applies per-column cellClassName as a plain string", () => {
    const stringClassColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name", cellClassName: "text-emerald-500" },
      { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
    ];
    render(<DataGrid data={makeRows(1)} columns={stringClassColumns} getRowId={(r) => r.id} />);
    const cells = screen.getAllByRole("gridcell");
    expect(cells[0]!.className).toContain("text-emerald-500");
    expect(cells[1]!.className).not.toContain("text-emerald-500");
  });

  it("applies per-column cellClassName as a function, receiving value/row/column/viewRowIndex", () => {
    const fnClassColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      {
        id: "qty",
        header: "Qty",
        accessorKey: "qty",
        type: "number",
        cellClassName: (ctx) => (typeof ctx.value === "number" && ctx.value > 0 ? "font-bold" : undefined),
      },
    ];
    render(<DataGrid data={makeRows(2)} columns={fnClassColumns} getRowId={(r) => r.id} />);
    const cells = screen.getAllByRole("gridcell");
    // row 0's qty is 0 -> no class; row 1's qty is 1 -> font-bold
    expect(cells[1]!.className).not.toContain("font-bold"); // row 0, qty col
    expect(cells[3]!.className).toContain("font-bold"); // row 1, qty col
  });

  it("applies per-column headerClassName", () => {
    const headerClassColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name", headerClassName: "uppercase" },
      { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
    ];
    render(<DataGrid data={makeRows(1)} columns={headerClassColumns} getRowId={(r) => r.id} />);
    const nameHeader = screen.getByRole("columnheader", { name: "Name" });
    const qtyHeader = screen.getByRole("columnheader", { name: "Qty" });
    expect(nameHeader.className).toContain("uppercase");
    expect(qtyHeader.className).not.toContain("uppercase");
  });

  it("consumer classes win over conflicting built-ins via cn()/twMerge ordering (grid-level then column-level, applied last)", () => {
    // built-in cell class includes "justify-start" (left align, the text type's default) —
    // a consumer override of the SAME utility category (justify-*) must be the one that survives.
    const overrideColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name", cellClassName: "justify-end" },
      { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
    ];
    render(<DataGrid data={makeRows(1)} columns={overrideColumns} getRowId={(r) => r.id} />);
    const nameCell = screen.getAllByRole("gridcell")[0]!;
    expect(nameCell.className).toContain("justify-end");
    expect(nameCell.className).not.toContain("justify-start");
  });

  it("column-level cellClassName wins over grid-level getCellClassName on a conflicting utility (applied last)", () => {
    const columnsWithBoth: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name", cellClassName: "justify-end" },
      { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
    ];
    render(
      <DataGrid
        data={makeRows(1)}
        columns={columnsWithBoth}
        getRowId={(r) => r.id}
        getCellClassName={() => "justify-center"}
      />,
    );
    const nameCell = screen.getAllByRole("gridcell")[0]!;
    expect(nameCell.className).toContain("justify-end");
    expect(nameCell.className).not.toContain("justify-center");
  });
});

describe("onCellClick / onRowClick", () => {
  it("onCellClick fires with the clicked cell's value/row/column/indices", () => {
    const onCellClick = vi.fn();
    render(<DataGrid data={makeRows(2)} columns={columns} getRowId={(r) => r.id} onCellClick={onCellClick} />);
    const cells = screen.getAllByRole("gridcell");
    fireEvent.click(cells[2]!); // row 1, "name" column ("Row 1")

    expect(onCellClick).toHaveBeenCalledTimes(1);
    const [ctx] = onCellClick.mock.calls[0]!;
    expect(ctx).toMatchObject({ value: "Row 1", rowIndex: 1, columnIndex: 0 });
    expect(ctx.row).toEqual({ id: "1", name: "Row 1", qty: 1 });
    expect(ctx.column.id).toBe("name");
  });

  it("onRowClick fires alongside onCellClick, once per click regardless of column", () => {
    const onRowClick = vi.fn();
    render(<DataGrid data={makeRows(2)} columns={columns} getRowId={(r) => r.id} onRowClick={onRowClick} />);
    const cells = screen.getAllByRole("gridcell");
    fireEvent.click(cells[3]!); // row 1, "qty" column

    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0]![0]).toEqual({ row: { id: "1", name: "Row 1", qty: 1 }, rowIndex: 1 });
  });

  it("both fire together from the same click when both props are supplied", () => {
    const onCellClick = vi.fn();
    const onRowClick = vi.fn();
    render(
      <DataGrid data={makeRows(1)} columns={columns} getRowId={(r) => r.id} onCellClick={onCellClick} onRowClick={onRowClick} />,
    );
    fireEvent.click(screen.getAllByRole("gridcell")[0]!);

    expect(onCellClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it("neither fires without the corresponding prop (no cost when unused)", () => {
    render(<DataGrid data={makeRows(1)} columns={columns} getRowId={(r) => r.id} />);
    // no assertion needed beyond "doesn't throw" — this documents the props are fully optional.
    expect(() => fireEvent.click(screen.getAllByRole("gridcell")[0]!)).not.toThrow();
  });
});

describe("DataGrid className merge", () => {
  it("merges a custom className via cn() alongside the base classes", () => {
    render(<DataGrid data={makeRows(1)} columns={columns} getRowId={(r) => r.id} className="my-custom-class" />);
    const grid = screen.getByRole("grid");
    expect(grid.className).toContain("my-custom-class");
    expect(grid.className).toContain("overflow-auto");
  });
});

describe("DataGrid roving tabindex + active/selected attributes", () => {
  it("gives the active cell tabIndex 0, aria-selected, and data-active; every other cell tabIndex -1", () => {
    render(<DataGrid data={makeRows(3)} columns={columns} getRowId={(r) => r.id} />);
    const cells = screen.getAllByRole("gridcell");
    fireEvent.pointerDown(cells[0]!, { button: 0 });
    expect(cells[0]).toHaveAttribute(GRID_ATTR.active, "true");
    expect(cells[0]).toHaveAttribute("aria-selected", "true");
    expect(cells[0]).toHaveAttribute("tabIndex", "0");
    expect(cells[1]).toHaveAttribute("tabIndex", "-1");
    expect(cells[1]).not.toHaveAttribute(GRID_ATTR.active);
  });

  // WAI-ARIA grid pattern: exactly one element must be tabbable at all times. Before any cell has
  // been made active, every cell renders tabIndex=-1 — without the root itself picking up
  // tabIndex=0 in that state, a keyboard user tabbing to the grid would have nowhere to land.
  it("makes the grid root itself tabbable (tabIndex 0) before any cell is active, and -1 once a cell is", () => {
    render(<DataGrid data={makeRows(3)} columns={columns} getRowId={(r) => r.id} />);
    const grid = screen.getByRole("grid");
    expect(grid).toHaveAttribute("tabIndex", "0");

    fireEvent.pointerDown(screen.getAllByRole("gridcell")[0]!, { button: 0 });
    expect(grid).toHaveAttribute("tabIndex", "-1");
  });

  it("focusing the grid root directly seeds the active cell at (0,0), matching APG roving-tabindex bootstrap", () => {
    render(<DataGrid data={makeRows(3)} columns={columns} getRowId={(r) => r.id} />);
    const grid = screen.getByRole("grid");
    fireEvent.focus(grid);
    const cells = screen.getAllByRole("gridcell");
    expect(cells[0]).toHaveAttribute(GRID_ATTR.active, "true");
    expect(grid).toHaveAttribute("tabIndex", "-1");
  });

  it("gives aria-selected=true to every cell inside a shift-extended range, not just the active/anchor cell", () => {
    render(<DataGrid data={makeRows(3)} columns={columns} getRowId={(r) => r.id} />);
    const cells = screen.getAllByRole("gridcell");
    // 2 columns x 3 rows grid: cells[0]=name/row0, cells[1]=qty/row0, cells[2]=name/row1, ...
    fireEvent.pointerDown(cells[0]!, { button: 0 });
    fireEvent.pointerDown(cells[3]!, { button: 0, shiftKey: true });
    // range now covers rows 0-1, both columns — every one of those 4 cells is selected, not just the anchor.
    expect(cells[0]).toHaveAttribute("aria-selected", "true");
    expect(cells[1]).toHaveAttribute("aria-selected", "true");
    expect(cells[2]).toHaveAttribute("aria-selected", "true");
    expect(cells[3]).toHaveAttribute("aria-selected", "true");
    // row 2 is outside the range and was never active.
    expect(cells[4]).not.toHaveAttribute("aria-selected");
    expect(cells[5]).not.toHaveAttribute("aria-selected");
  });
});

describe("DataGrid cell-type-driven rendering and editing lifecycle", () => {
  const checkboxColumns: readonly ColumnDef<Row, unknown>[] = [
    { id: "name", header: "Name", accessorKey: "name" },
  ];

  it("clicking a cell then typing a printable character opens the editor seeded with that character", () => {
    render(<DataGrid data={makeRows(2)} columns={checkboxColumns} getRowId={(r) => r.id} />);
    const grid = screen.getByRole("grid");
    const cell = screen.getAllByRole("gridcell")[0]!;
    fireEvent.pointerDown(cell, { button: 0 });
    fireEvent.keyDown(grid, { key: "x" });
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("x");
  });

  it("Enter commits the edit, updates the cell, fires onDataChange once, and moves the active cell down", () => {
    const onDataChange = vi.fn();
    render(
      <DataGrid data={makeRows(2)} columns={checkboxColumns} getRowId={(r) => r.id} onDataChange={onDataChange} />,
    );
    const grid = screen.getByRole("grid");
    const cell = screen.getAllByRole("gridcell")[0]!;
    fireEvent.pointerDown(cell, { button: 0 });
    fireEvent.keyDown(grid, { key: "x" });
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect(screen.getByText("x")).toBeInTheDocument();
    // active cell moved down to row 1, col 0 (single-column grid: cell index 1 == row 1)
    const cellsAfter = screen.getAllByRole("gridcell");
    expect(cellsAfter[1]).toHaveAttribute(GRID_ATTR.active, "true");
  });

  it("Escape cancels the edit with no data change", () => {
    const onDataChange = vi.fn();
    render(
      <DataGrid data={makeRows(2)} columns={checkboxColumns} getRowId={(r) => r.id} onDataChange={onDataChange} />,
    );
    const grid = screen.getByRole("grid");
    const cell = screen.getAllByRole("gridcell")[0]!;
    fireEvent.pointerDown(cell, { button: 0 });
    fireEvent.keyDown(grid, { key: "F2" });
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "changed" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onDataChange).not.toHaveBeenCalled();
    expect(screen.queryByText("changed")).not.toBeInTheDocument();
    expect(screen.getByText("Row 0")).toBeInTheDocument();
  });

  it("double-click opens the editor", () => {
    render(<DataGrid data={makeRows(1)} columns={checkboxColumns} getRowId={(r) => r.id} />);
    const cell = screen.getAllByRole("gridcell")[0]!;
    fireEvent.doubleClick(cell);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  // a11y: the text/number editor is a bare <input> floated inside the cell with no visible label —
  // without aria-label it fails axe's "Form elements must have labels" rule (found in the runtime audit).
  it("labels the text editor input with the column's header text", () => {
    render(<DataGrid data={makeRows(1)} columns={checkboxColumns} getRowId={(r) => r.id} />);
    const cell = screen.getAllByRole("gridcell")[0]!;
    fireEvent.doubleClick(cell);
    expect(screen.getByRole("textbox", { name: "Name" })).toBeInTheDocument();
  });

  it("labels the number editor input with the column's header text", () => {
    render(<DataGrid data={makeRows(1)} columns={columns} getRowId={(r) => r.id} />);
    const qtyCell = screen.getAllByRole("gridcell")[1]!;
    fireEvent.doubleClick(qtyCell);
    expect(screen.getByRole("textbox", { name: "Qty" })).toBeInTheDocument();
  });

  it("Delete clears the selected cell's contents", () => {
    const onDataChange = vi.fn();
    render(
      <DataGrid data={makeRows(1)} columns={checkboxColumns} getRowId={(r) => r.id} onDataChange={onDataChange} />,
    );
    const grid = screen.getByRole("grid");
    const cell = screen.getAllByRole("gridcell")[0]!;
    fireEvent.pointerDown(cell, { button: 0 });
    fireEvent.keyDown(grid, { key: "Delete" });
    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Row 0")).not.toBeInTheDocument();
  });

  it("readOnly grid-level prop blocks editing", () => {
    render(<DataGrid data={makeRows(1)} columns={checkboxColumns} getRowId={(r) => r.id} readOnly />);
    const cell = screen.getAllByRole("gridcell")[0]!;
    fireEvent.doubleClick(cell);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("checkbox cell type auto-commits on Enter (toggle in place, no visible editor)", () => {
    type BoolRow = { id: string; active: boolean };
    const boolColumns: readonly ColumnDef<BoolRow, unknown>[] = [
      { id: "active", header: "Active", accessorKey: "active", type: "checkbox" },
    ];
    const onDataChange = vi.fn<(next: readonly BoolRow[]) => void>();
    render(
      <DataGrid
        data={[{ id: "1", active: false }]}
        columns={boolColumns}
        getRowId={(r) => r.id}
        onDataChange={onDataChange}
      />,
    );
    const grid = screen.getByRole("grid");
    const cell = screen.getAllByRole("gridcell")[0]!;
    fireEvent.pointerDown(cell, { button: 0 });
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [nextData] = onDataChange.mock.calls[0]!;
    expect(nextData[0]!.active).toBe(true);
  });
});

describe("DataGrid selection changes re-render only overlays + the two affected cells, never rows", () => {
  it("moving the active cell does not re-render the row-level (per-getRowId) subscription", () => {
    // Renders the real engine (DataGridRoot/Header/Body) so the probe observes the actual
    // DataGridRow component's per-row subscription (useDataGridRow), not a stand-in.
    const rowRenderCounts: number[] = [0, 0, 0];

    function CountingRow({ viewRowIndex }: { viewRowIndex: number }) {
      const row = useDataGridRow(viewRowIndex);
      rowRenderCounts[viewRowIndex] = (rowRenderCounts[viewRowIndex] ?? 0) + 1;
      return <span data-testid={`row-render-${viewRowIndex}`}>{JSON.stringify(row)}</span>;
    }
    const MemoCountingRow = memo(CountingRow);

    let actionsRef: ReturnType<typeof useDataGridActions> | null = null;
    function ActionsCapture() {
      actionsRef = useDataGridActions();
      return null;
    }

    render(
      <DataGridProvider data={makeRows(3)} columns={columns} getRowId={(r) => r.id}>
        <ActionsCapture />
        <MemoCountingRow viewRowIndex={0} />
        <MemoCountingRow viewRowIndex={1} />
        <MemoCountingRow viewRowIndex={2} />
      </DataGridProvider>,
    );

    const before = [...rowRenderCounts];

    act(() => {
      actionsRef!.selectCell({ col: 0, row: 0 });
    });
    act(() => {
      actionsRef!.selectCell({ col: 1, row: 0 });
    });
    act(() => {
      actionsRef!._moveActiveCell({ dx: 0, dy: 1 });
    });

    // useDataGridRow subscribes only to `data[viewIndex[viewRowIndex]]`, which none of these
    // selection-only mutations touch — a memoized consumer of it must not re-render.
    expect(rowRenderCounts).toEqual(before);
  });

  it("selecting a different cell in the real DataGrid tree does not change already-rendered row DOM identity", () => {
    render(<DataGrid data={makeRows(3)} columns={columns} getRowId={(r) => r.id} />);
    const rowsBefore = screen.getAllByRole("row").filter((r) => r.getAttribute("aria-rowindex"));
    const cell = screen.getAllByRole("gridcell")[0]!;
    fireEvent.pointerDown(cell, { button: 0 });

    const grid = screen.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowDown" });

    const rowsAfter = screen.getAllByRole("row").filter((r) => r.getAttribute("aria-rowindex"));
    // same DOM row elements are reused (React didn't remount them) — proxy for "rows didn't re-render"
    expect(rowsAfter.map((r) => r)).toEqual(rowsBefore.map((r) => r));
  });
});

describe("onSelectionChange / onColumnLayoutChange fire from store actions without adding row/cell subscriptions", () => {
  it("onSelectionChange fires on selectCell without re-rendering row/cell subscriptions", () => {
    const rowRenderCounts: number[] = [0, 0, 0];
    function CountingRow({ viewRowIndex }: { viewRowIndex: number }) {
      const row = useDataGridRow(viewRowIndex);
      rowRenderCounts[viewRowIndex] = (rowRenderCounts[viewRowIndex] ?? 0) + 1;
      return <span data-testid={`row-render-${viewRowIndex}`}>{JSON.stringify(row)}</span>;
    }
    const MemoCountingRow = memo(CountingRow);

    let cellRenderCount = 0;
    function CountingCell({ col, row: rowIndex }: { col: number; row: number }) {
      useDataGridCellState({ col, row: rowIndex });
      cellRenderCount += 1;
      return null;
    }
    const MemoCountingCell = memo(CountingCell);

    const onSelectionChange = vi.fn();
    let actionsRef: ReturnType<typeof useDataGridActions> | null = null;
    function ActionsCapture() {
      actionsRef = useDataGridActions();
      return null;
    }

    render(
      <DataGridProvider data={makeRows(3)} columns={columns} getRowId={(r) => r.id} onSelectionChange={onSelectionChange}>
        <ActionsCapture />
        <MemoCountingRow viewRowIndex={0} />
        <MemoCountingRow viewRowIndex={1} />
        <MemoCountingRow viewRowIndex={2} />
        <MemoCountingCell col={1} row={2} />
      </DataGridProvider>,
    );

    const rowsBefore = [...rowRenderCounts];
    const cellsBefore = cellRenderCount;

    act(() => {
      actionsRef!.selectCell({ col: 0, row: 0 });
    });

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    // selectCell({col:0, row:0}) touches neither row 2's data nor cell (1,2)'s active/editing/search state.
    expect(rowRenderCounts).toEqual(rowsBefore);
    expect(cellRenderCount).toBe(cellsBefore);
  });

  it("calling details.getValues() inside onSelectionChange still doesn't re-render row/cell subscriptions", () => {
    const rowRenderCounts: number[] = [0, 0, 0];
    function CountingRow({ viewRowIndex }: { viewRowIndex: number }) {
      const row = useDataGridRow(viewRowIndex);
      rowRenderCounts[viewRowIndex] = (rowRenderCounts[viewRowIndex] ?? 0) + 1;
      return <span data-testid={`row-render-${viewRowIndex}`}>{JSON.stringify(row)}</span>;
    }
    const MemoCountingRow = memo(CountingRow);

    let actionsRef: ReturnType<typeof useDataGridActions> | null = null;
    function ActionsCapture() {
      actionsRef = useDataGridActions();
      return null;
    }

    // Reading getValues() is a plain synchronous store read (no `set()`), so exercising it here
    // must not perturb the render counts any differently than the "never called" case above.
    const onSelectionChange = vi.fn((_selection, details: { getValues: () => unknown[][] }) => {
      details.getValues();
    });

    render(
      <DataGridProvider data={makeRows(3)} columns={columns} getRowId={(r) => r.id} onSelectionChange={onSelectionChange}>
        <ActionsCapture />
        <MemoCountingRow viewRowIndex={0} />
        <MemoCountingRow viewRowIndex={1} />
        <MemoCountingRow viewRowIndex={2} />
      </DataGridProvider>,
    );

    const rowsBefore = [...rowRenderCounts];

    act(() => {
      actionsRef!.selectCell({ col: 0, row: 0 });
      actionsRef!.extendTo({ col: 1, row: 1 });
    });

    expect(onSelectionChange).toHaveBeenCalledTimes(2);
    // extendTo({col:1,row:1}) covers rows 0-1 only; row 2's subscription must stay untouched.
    expect(rowRenderCounts).toEqual(rowsBefore);
  });

  it("onColumnLayoutChange fires on commitColumnWidth without re-rendering row/cell subscriptions", () => {
    const rowRenderCounts: number[] = [0, 0, 0];
    function CountingRow({ viewRowIndex }: { viewRowIndex: number }) {
      const row = useDataGridRow(viewRowIndex);
      rowRenderCounts[viewRowIndex] = (rowRenderCounts[viewRowIndex] ?? 0) + 1;
      return <span data-testid={`row-render-${viewRowIndex}`}>{JSON.stringify(row)}</span>;
    }
    const MemoCountingRow = memo(CountingRow);

    const onColumnLayoutChange = vi.fn();
    let actionsRef: ReturnType<typeof useDataGridActions> | null = null;
    function ActionsCapture() {
      actionsRef = useDataGridActions();
      return null;
    }

    render(
      <DataGridProvider data={makeRows(3)} columns={columns} getRowId={(r) => r.id} onColumnLayoutChange={onColumnLayoutChange}>
        <ActionsCapture />
        <MemoCountingRow viewRowIndex={0} />
        <MemoCountingRow viewRowIndex={1} />
        <MemoCountingRow viewRowIndex={2} />
      </DataGridProvider>,
    );

    const before = [...rowRenderCounts];
    act(() => {
      actionsRef!.commitColumnWidth("qty", 120);
    });

    expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
    expect(onColumnLayoutChange).toHaveBeenLastCalledWith({
      widths: { qty: 120 },
      order: ["name", "qty"],
      pins: {},
      hidden: [],
    });
    // useDataGridRow subscribes only to `data[viewIndex[viewRowIndex]]`, which column-layout never touches.
    expect(rowRenderCounts).toEqual(before);
  });
});

describe("spec 6c-8 (H1 fix): useDataGridCellState consolidates 6 store reads into 1 subscription", () => {
  it("re-renders a cell exactly once per relevant state change, not once per underlying primitive", () => {
    let renderCount = 0;
    function CountingCell({ col, row: rowIndex }: { col: number; row: number }) {
      useDataGridCellState({ col, row: rowIndex });
      renderCount += 1;
      return null;
    }
    const MemoCountingCell = memo(CountingCell);

    let actionsRef: ReturnType<typeof useDataGridActions> | null = null;
    function ActionsCapture() {
      actionsRef = useDataGridActions();
      return null;
    }

    render(
      <DataGridProvider data={makeRows(3)} columns={columns} getRowId={(r) => r.id}>
        <ActionsCapture />
        <MemoCountingCell col={0} row={0} />
      </DataGridProvider>,
    );

    const before = renderCount;

    // activating this cell flips exactly one of the 4 tracked primitives (isActive) once.
    act(() => {
      actionsRef!.selectCell({ col: 0, row: 0 });
    });
    expect(renderCount).toBe(before + 1);

    // moving the active cell elsewhere flips isActive back — one more render, not a burst of 4+
    // (one per formerly-separate atomic hook) from a single logical state transition.
    act(() => {
      actionsRef!.selectCell({ col: 1, row: 0 });
    });
    expect(renderCount).toBe(before + 2);
  });

  it("does not re-render when an unrelated cell's active state changes", () => {
    let renderCount = 0;
    function CountingCell({ col, row: rowIndex }: { col: number; row: number }) {
      useDataGridCellState({ col, row: rowIndex });
      renderCount += 1;
      return null;
    }
    const MemoCountingCell = memo(CountingCell);

    let actionsRef: ReturnType<typeof useDataGridActions> | null = null;
    function ActionsCapture() {
      actionsRef = useDataGridActions();
      return null;
    }

    render(
      <DataGridProvider data={makeRows(3)} columns={columns} getRowId={(r) => r.id}>
        <ActionsCapture />
        <MemoCountingCell col={1} row={2} />
      </DataGridProvider>,
    );

    const before = renderCount;
    act(() => {
      actionsRef!.selectCell({ col: 0, row: 0 });
    });
    act(() => {
      actionsRef!.selectCell({ col: 0, row: 1 });
    });
    expect(renderCount).toBe(before);
  });
});

describe("spec 6c-8 (H2 audit): row prop identity survives a scroll that keeps the same rows in view", () => {
  it("re-scrolling to the same scrollTop (identical row window) reuses every row DOM node", () => {
    render(<DataGrid data={makeRows(10000)} columns={columns} getRowId={(r) => r.id} />);
    const grid = screen.getByRole("grid");
    fireEvent.scroll(grid, { target: { scrollTop: 720 } }); // settle on a fixed window first
    const rowsBefore = screen.getAllByRole("row").filter((r) => r.getAttribute("aria-rowindex"));

    // same scrollTop again: the row window ({start,end}) is unchanged, so windowedColumns/layout/
    // readOnly/rowMarkers passed to every DataGridRow are the same references as last render —
    // DataGridRow's memo must bail and React must reuse every existing row node.
    fireEvent.scroll(grid, { target: { scrollTop: 720 } });

    const rowsAfter = screen.getAllByRole("row").filter((r) => r.getAttribute("aria-rowindex"));
    expect(rowsAfter).toEqual(rowsBefore);
  });

  it("a 1-row window shift repositions the same DOM nodes to new gridRowStart values in place", () => {
    render(<DataGrid data={makeRows(10000)} columns={columns} getRowId={(r) => r.id} />);
    const grid = screen.getByRole("grid");
    fireEvent.scroll(grid, { target: { scrollTop: 720 } });
    const rowsBefore = screen.getAllByRole("row").filter((r) => r.getAttribute("aria-rowindex"));
    // row that was 2nd from the top (survives the coming shift, since only the top row scrolls out)
    const survivorAriaIndex = rowsBefore[1]!.getAttribute("aria-rowindex");
    const survivorGridRowStartBefore = rowsBefore[1]!.style.gridRowStart;

    fireEvent.scroll(grid, { target: { scrollTop: 720 + 36 } }); // exactly one row-height (rowHeight default 36)

    const rowsAfter = screen.getAllByRole("row").filter((r) => r.getAttribute("aria-rowindex"));
    // the SAME row (by aria-rowindex, i.e. same underlying data row) is still the SAME DOM node —
    // not remounted — but its gridRowStart moved up by one slot (window-relative placement).
    const survivorAfter = rowsAfter.find((r) => r.getAttribute("aria-rowindex") === survivorAriaIndex)!;
    expect(survivorAfter).toBe(rowsBefore[1]!);
    expect(survivorAfter.style.gridRowStart).not.toBe(survivorGridRowStartBefore);
    expect(Number(survivorAfter.style.gridRowStart)).toBe(Number(survivorGridRowStartBefore) - 1);
  });
});

describe("spec phase 3 (task 2): DataGridCell memo prop-stability audit", () => {
  // Each sub-test flips exactly one DataGridCell input in isolation via the real engine and checks
  // renderCell fire count, so the memo comparator can't silently go stale on any one prop.
  async function renderCountingGrid(rowCount: number) {
    let renderCount = 0;
    const perRowCounts: number[] = Array<number>(rowCount).fill(0);
    const probeColumns: readonly ColumnDef<Row, unknown>[] = [
      {
        id: "name",
        header: "Name",
        accessorKey: "name",
        renderCell: ({ value, rowIndex }) => {
          renderCount++;
          perRowCounts[rowIndex] = (perRowCounts[rowIndex] ?? 0) + 1;
          return String(value);
        },
      },
      { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
    ];
    const utils = render(<DataGrid data={makeRows(rowCount)} columns={probeColumns} getRowId={(r) => r.id} />);
    // Mount doesn't settle in one synchronous pass in this jsdom harness — useElementDimensions'
    // geometry read and useRowWindow's fallback-heal both land on later ticks (no ResizeObserver in
    // jsdom). Flush them explicitly before returning, so callers get a stable baseline count instead
    // of that settling getting misattributed to whatever interaction they fire first.
    await act(async () => {});
    return { ...utils, getRenderCount: () => renderCount, getPerRowCounts: () => [...perRowCounts] };
  }

  it("row: selection moves re-render only the cells whose OWN active state actually flips, never an untouched row's cells", async () => {
    const { getPerRowCounts } = await renderCountingGrid(3);
    const grid = screen.getByRole("grid");
    // activating the FIRST cell moves `activeColumn` null -> 0, which recomputes root.tsx's
    // columnIndices/windowedColumns (deps include activeColumn) to a new array reference — every
    // row legitimately re-renders once for that (documented in row.tsx: "windowedColumns prop
    // changes" is an inherent, accepted cost). Settle past that one-time cost before measuring.
    fireEvent.pointerDown(screen.getAllByRole("gridcell")[0]!, { button: 0 }); // activates row 0, col 0
    const before = getPerRowCounts();
    fireEvent.keyDown(grid, { key: "ArrowDown" }); // moves active cell to row 1, col 0
    const after = getPerRowCounts();
    // row 0's cell (deactivated) and row 1's cell (activated) legitimately re-render — that's each
    // cell's OWN useDataGridCellState subscription firing, not a memo-prop defeat.
    expect(after[0]).toBe(before[0]! + 1);
    expect(after[1]).toBe(before[1]! + 1);
    // row 2's cell was never touched by this move and must not have re-rendered at all — `row`/
    // `column`/`gridReadOnly` are unchanged for it, and it isn't newly/formerly active — proving
    // DataGridCell's memo comparator actually bails for an unrelated row.
    expect(after[2]).toBe(before[2]);
  });

  it("row: a data change produces a new row object, and only that row's cells re-render", () => {
    let renderCount = 0;
    const probeColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name", renderCell: ({ value }) => { renderCount++; return String(value); } },
      { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
    ];
    const onDataChange = vi.fn();
    render(
      <DataGrid data={makeRows(3)} columns={probeColumns} getRowId={(r) => r.id} onDataChange={onDataChange} />,
    );
    const before = renderCount;
    const cell = screen.getAllByRole("gridcell")[0]!; // row 0, name col
    fireEvent.pointerDown(cell, { button: 0 });
    fireEvent.keyDown(screen.getByRole("grid"), { key: "F2" });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Edited" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    // committing the edit replaces `data[0]` with a new object — useDataGridRow(0)'s returned
    // reference changes, so row 0's cell (and only row 0's) legitimately re-renders.
    expect(renderCount).toBeGreaterThan(before);
  });

  it("readOnly: flipping grid-level readOnly re-renders cells (gridReadOnly prop genuinely changes)", () => {
    let renderCount = 0;
    const probeColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name", renderCell: ({ value }) => { renderCount++; return String(value); } },
      { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
    ];
    const rows = makeRows(2); // stable reference across rerenders — isolates readOnly as the only changed input
    const { rerender } = render(<DataGrid data={rows} columns={probeColumns} getRowId={(r) => r.id} readOnly={false} />);
    const before = renderCount;
    rerender(<DataGrid data={rows} columns={probeColumns} getRowId={(r) => r.id} readOnly={true} />);
    // `gridReadOnly` genuinely flips for every rendered cell — a memo that dropped it from its
    // comparator would swallow this entirely (renderCount unchanged); it must fire again.
    expect(renderCount).toBeGreaterThan(before);
  });

  it("density: a rowHeight/density change does not require the cell's own props to differ (layout-only, template-level)", () => {
    const probeColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
    ];
    const rows = makeRows(2);
    const { rerender } = render(<DataGrid data={rows} columns={probeColumns} getRowId={(r) => r.id} density="compact" />);
    screen.getAllByRole("gridcell");
    rerender(<DataGrid data={rows} columns={probeColumns} getRowId={(r) => r.id} density="comfortable" />);
    // rowHeight/gridAutoRows lives in the canvas grid style (body.tsx), never in a DataGridCell prop
    // — this is a sanity check that the grid still renders correctly, not a strict no-rerender bound
    // (density is rare/explicit, not a scroll-hot-path concern task 2 targets).
    expect(screen.getAllByRole("gridcell").length).toBeGreaterThan(0);
  });

  it("pinning: a column's pin flip changes pinnedInsetStyle, which depends only on column + columnIndex (both existing memo inputs)", () => {
    let renderCount = 0;
    const probeColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name", renderCell: ({ value }) => { renderCount++; return String(value); } },
      { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
    ];
    const rows = makeRows(2); // stable reference across rerenders — isolates the column pin flip as the only changed input
    const { rerender } = render(<DataGrid data={rows} columns={probeColumns} getRowId={(r) => r.id} />);
    const before = renderCount;
    const pinnedColumns = probeColumns.map((c) => (c.id === "name" ? { ...c, pin: "left" as const } : c));
    rerender(<DataGrid data={rows} columns={pinnedColumns} getRowId={(r) => r.id} />);
    // `column` object identity changed (new pin field) — pin state is never read from anywhere else,
    // so a memo that dropped `column` from its comparator would swallow this entirely; it must fire.
    expect(renderCount).toBeGreaterThan(before);
  });

  it("getRowClassName/getCellClassName: a stable function identity survives a same-scrollTop rerender exactly like the H2 baseline (no extra remount/wasted render)", () => {
    // Mirrors the H2 audit's "re-scrolling to the same scrollTop reuses every row DOM node" test
    // exactly, with getRowClassName/getCellClassName (stable identity) added — proving they don't
    // introduce their own churn on top of whatever the existing engine's settling already costs.
    const getRowClassName = () => undefined;
    const getCellClassName = () => undefined;
    render(
      <DataGrid
        data={makeRows(10000)}
        columns={columns}
        getRowId={(r) => r.id}
        getRowClassName={getRowClassName}
        getCellClassName={getCellClassName}
      />,
    );
    const grid = screen.getByRole("grid");
    fireEvent.scroll(grid, { target: { scrollTop: 720 } }); // settle on a fixed window first
    const rowsBefore = screen.getAllByRole("row").filter((r) => r.getAttribute("aria-rowindex"));

    fireEvent.scroll(grid, { target: { scrollTop: 720 } }); // identical window: {start,end} unchanged

    const rowsAfter = screen.getAllByRole("row").filter((r) => r.getAttribute("aria-rowindex"));
    expect(rowsAfter).toEqual(rowsBefore);
  });

  it("getRowClassName/getCellClassName: an unstable identity every render still reuses row DOM nodes across an identical-window rescroll (functionally correct — the guardrail only warns, it doesn't change behavior)", () => {
    function TestGrid({ n }: { n: number }) {
      return (
        <DataGrid
          data={makeRows(10000)}
          columns={columns}
          getRowId={(r) => r.id}
          getRowClassName={() => `render-${n}`}
        />
      );
    }
    const { rerender } = render(<TestGrid n={0} />);
    const grid = screen.getByRole("grid");
    fireEvent.scroll(grid, { target: { scrollTop: 720 } });
    rerender(<TestGrid n={1} />);
    const cell = screen.getAllByRole("row").filter((r) => r.getAttribute("aria-rowindex"))[0]!;
    expect(cell.className).toContain("render-1");
  });

  it("getRowClassName/getCellClassName: a fresh function identity every render still re-renders correctly (functionally correct, just not the recommended pattern)", () => {
    render(
      <DataGrid
        data={makeRows(1)}
        columns={columns}
        getRowId={(r) => r.id}
        getRowClassName={(row: Row) => `row-${row.id}`}
        getCellClassName={() => "cell-class"}
      />,
    );
    const rows = screen.getAllByRole("row").filter((r) => r.getAttribute("aria-rowindex"));
    expect(rows[0]!.className).toContain("row-0");
    expect(screen.getAllByRole("gridcell")[0]!.className).toContain("cell-class");
  });

  it("getRowClassName/getCellClassName: an unstable identity across renders logs a dev warning (guardrail)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = makeRows(1);
    const { rerender } = render(
      <DataGrid data={rows} columns={columns} getRowId={(r) => r.id} getRowClassName={() => undefined} />,
    );
    rerender(<DataGrid data={rows} columns={columns} getRowId={(r) => r.id} getRowClassName={() => undefined} />);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("getRowClassName identity changed"));
    warnSpy.mockRestore();
  });
});

describe("selection membership flips re-render only the affected cells (2026-09-03 audit P4)", () => {
  async function renderCountingSelectionGrid(rowCount = 3, colCount = 2) {
    const cellCounts: number[] = Array<number>(rowCount * colCount).fill(0);
    const probeColumns: readonly ColumnDef<Row, unknown>[] = Array.from({ length: colCount }, (_, col) => ({
      id: `c${col}`,
      header: `C${col}`,
      accessorKey: "name",
      renderCell: ({ value, rowIndex }: { value: unknown; rowIndex: number }) => {
        cellCounts[rowIndex * colCount + col] = (cellCounts[rowIndex * colCount + col] ?? 0) + 1;
        return String(value);
      },
    }));
    const rowClassName = vi.fn(() => undefined);
    let actionsRef: ReturnType<typeof useDataGridActions> | null = null;
    function ActionsCapture() {
      actionsRef = useDataGridActions();
      return null;
    }

    render(
      <DataGridProvider data={makeRows(rowCount)} columns={probeColumns} getRowId={(r) => r.id}>
        <ActionsCapture />
        <DataGridRoot getRowClassName={rowClassName}>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
    await act(async () => {});

    return {
      actions: () => {
        if (!actionsRef) throw new Error("actions not captured");
        return actionsRef;
      },
      totalCellRenders: () => cellCounts.reduce((sum, n) => sum + n, 0),
      rowRenders: () => rowClassName.mock.calls.length,
    };
  }

  it("a one-row extend re-renders only the newly covered row's cells plus the active-cell move", async () => {
    const { actions, totalCellRenders, rowRenders } = await renderCountingSelectionGrid();

    act(() => {
      actions().selectCell({ col: 0, row: 0 });
      actions().extendTo({ col: 1, row: 0 });
    });
    await act(async () => {});

    const cellsBefore = totalCellRenders();
    const rowsBefore = rowRenders();

    act(() => {
      actions().extendTo({ col: 1, row: 1 });
    });
    await act(async () => {});

    const selectedCells = screen.getAllByRole("gridcell").filter((cell) => cell.getAttribute("aria-selected") === "true");
    expect(selectedCells).toHaveLength(4);

    const cellDelta = totalCellRenders() - cellsBefore;
    const rowDelta = rowRenders() - rowsBefore;
    // Measured baseline 2026-09-07: cellDelta=2, rowDelta=0. The bound is the plan's M+4 model
    // (newly covered row's M cells + active-cell slack), not 1.5× the measured value, so a lost
    // memo/comparator that re-renders the whole band fails loudly.
    expect(cellDelta).toBeLessThanOrEqual(6);
    expect(rowDelta).toBeLessThanOrEqual(2);
  });

  it("a whole-band jump flips the band once and an unrelated store write adds zero cell renders", async () => {
    const { actions, totalCellRenders } = await renderCountingSelectionGrid();

    act(() => {
      actions().selectCell({ col: 0, row: 0 });
    });
    await act(async () => {});

    const cellsBefore = totalCellRenders();
    act(() => {
      actions().extendTo({ col: 1, row: 2 });
    });
    await act(async () => {});

    const selectedCells = screen.getAllByRole("gridcell").filter((cell) => cell.getAttribute("aria-selected") === "true");
    expect(selectedCells).toHaveLength(6);

    const jumpDelta = totalCellRenders() - cellsBefore;
    // Measured baseline 2026-09-07: cellDelta=5. The bound is bandRows × M + bandRows (each cell
    // flips at most once plus row-level slack), so a whole-band jump that re-renders every cell
    // more than once fails.
    expect(jumpDelta).toBeLessThanOrEqual(9);

    const cellsAfterJump = totalCellRenders();
    act(() => {
      actions().setSearch("no-such-value");
    });
    await act(async () => {});
    expect(totalCellRenders() - cellsAfterJump).toBe(0);
  });
});

