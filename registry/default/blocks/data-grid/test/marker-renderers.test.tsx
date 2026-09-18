import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ColumnDef } from "../types";
import {
  DataGrid,
  GRID_ATTR,
  gridAttrSelector,
  useDataGridActions,
  type MarkerCellRenderCtx,
  type MarkerHeaderRenderCtx,
} from "../data-grid";

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

/** A stable-identity test marker: presentational content that records the ctx it was called with. */
const renderMarker = ({ viewRowIndex, isRowChannelSelected, isCellSelected }: MarkerCellRenderCtx): ReactNode => (
  <span
    data-testid="custom-row-marker"
    data-row={viewRowIndex}
    data-marker-selected={isRowChannelSelected ? "true" : undefined}
    data-marker-cell-selected={isCellSelected ? "true" : undefined}
  />
);

/** The data (non-marker) gridcells of the rendered grid, in DOM order: index 2*i + col is row i. */
function dataCells(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[role="gridcell"]:not(${gridAttrSelector("markerCell")})`)];
}

/** A complete stationary press (pointerdown + pointerup): every press starts a potential drag,
 * so the pointerup is required to end the previous gesture before the next one starts. */
function press(el: HTMLElement, init: PointerEventInit = { button: 0 }): void {
  fireEvent.pointerDown(el, init);
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 0, button: 0 }));
}

/**
 * A test marker header that drives the rows channel through the grid's own action, exactly the
 * demo's shape (Button inside the provider calling setAllRowsSelected).
 */
function TestHeaderButton({ allSelected }: { allSelected: MarkerHeaderRenderCtx["allSelected"] }): ReactNode {
  const { setAllRowsSelected } = useDataGridActions();
  return (
    <button type="button" data-testid="custom-marker-header" data-all-selected={allSelected} onClick={() => setAllRowsSelected(true)}>
      select all
    </button>
  );
}

const renderMarkerHeader = ({ allSelected }: MarkerHeaderRenderCtx): ReactNode => (
  <TestHeaderButton allSelected={allSelected} />
);

/** The demo's own shape: toggles the rows channel (setAllRowsSelected(!checked)). */
function ToggleHeaderButton({ allSelected }: { allSelected: MarkerHeaderRenderCtx["allSelected"] }): ReactNode {
  const { setAllRowsSelected } = useDataGridActions();
  const checked = allSelected === "checked";
  return (
    <button type="button" data-testid="custom-marker-header" data-all-selected={allSelected} onClick={() => setAllRowsSelected(!checked)}>
      toggle all
    </button>
  );
}

const toggleRenderMarkerHeader = ({ allSelected }: MarkerHeaderRenderCtx): ReactNode => (
  <ToggleHeaderButton allSelected={allSelected} />
);

function markerCells(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(gridAttrSelector("markerCell"))];
}

describe("renderMarker (custom row marker cell content)", () => {
  it("renders the custom node, drops the built-in checkbox/number, and keeps the marker cell wrapper", () => {
    render(<DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} rowMarkers="checkbox" renderMarker={renderMarker} />);

    const markers = markerCells();
    expect(markers.length).toBe(5);
    // the wrapper keeps its chrome: role=gridcell + data-grid-marker-cell + the data-row-selected attr plumbing.
    expect(markers[0]).toHaveAttribute("role", "gridcell");
    expect(markers[0]).toHaveAttribute(GRID_ATTR.markerCell);

    // custom content present, built-in content absent.
    const customs = screen.getAllByTestId("custom-row-marker");
    expect(customs.length).toBe(5);
    expect(customs[0]).toHaveAttribute("data-row", "0");
    expect(document.querySelector(gridAttrSelector("markerNumber"))).toBeNull();
    expect(markers[0]!.querySelector('[role="checkbox"]')).toBeNull();
  });

  it("reflects isRowChannelSelected in the ctx as the row selection changes", () => {
    render(<DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} rowMarkers="checkbox" renderMarker={renderMarker} />);

    const markers = markerCells();
    expect(screen.getAllByTestId("custom-row-marker")[0]).not.toHaveAttribute("data-marker-selected");

    // the wrapper's own press gesture (onPointerDown) still selects the row with a custom renderer.
    fireEvent.pointerDown(markers[1]!, { button: 0 });
    expect(markerCells()[1]).toHaveAttribute(GRID_ATTR.selected, "true");
    expect(screen.getAllByTestId("custom-row-marker")[1]).toHaveAttribute("data-marker-selected", "true");
    expect(screen.getAllByTestId("custom-row-marker")[0]).not.toHaveAttribute("data-marker-selected");
    // a marker press opens the ROWS channel only: isCellSelected must not flip.
    expect(screen.getAllByTestId("custom-row-marker")[1]).not.toHaveAttribute("data-marker-cell-selected");
  });

  it("a cell selection flips isCellSelected but NOT isRowChannelSelected (rows channel only)", () => {
    render(<DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} rowMarkers="checkbox" renderMarker={renderMarker} />);

    // press a data cell in row 2: the cell channel opens on that row, the rows channel stays empty
    // (cell selection resolves on pointerdown, not on the click event).
    press(dataCells()[4]!);
    const markers = screen.getAllByTestId("custom-row-marker");
    expect(markers[2]).not.toHaveAttribute("data-marker-selected");
    expect(markers[2]).toHaveAttribute("data-marker-cell-selected", "true");
    expect(markers[0]).not.toHaveAttribute("data-marker-cell-selected");
    expect(markers[0]).not.toHaveAttribute("data-marker-selected");
  });

  it("a marker press takes over the selection: the rows channel is set and the cell range is cleared", () => {
    render(<DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} rowMarkers="checkbox" renderMarker={renderMarker} />);

    // a cell of row 2 via a plain press (cell channel) first, then row 1 via the marker gesture:
    // selectRow always resets the primary range (line-ops.ts), so the earlier cell range does not
    // survive, and only the rows channel reports back.
    press(dataCells()[4]!);
    press(markerCells()[1]!);
    const markers = screen.getAllByTestId("custom-row-marker");
    expect(markers[1]).toHaveAttribute("data-marker-selected", "true");
    expect(markers[1]).not.toHaveAttribute("data-marker-cell-selected");
    expect(markers[2]).not.toHaveAttribute("data-marker-cell-selected");
    expect(markers[2]).not.toHaveAttribute("data-marker-selected");
  });

  it("a column selection flips isCellSelected on every row (column channel), without touching the rows channel", () => {
    render(<DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} rowMarkers="checkbox" renderMarker={renderMarker} />);

    press(document.querySelector<HTMLElement>('[role="columnheader"][data-column-id="name"]')!);
    const markers = screen.getAllByTestId("custom-row-marker");
    expect(markers.every((m) => m.getAttribute("data-marker-cell-selected") === "true")).toBe(true);
    expect(markers.every((m) => m.getAttribute("data-marker-selected") === null)).toBe(true);
  });

  it("rows and column channels can be selected at once: the row in both shows both flags", () => {
    render(<DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} rowMarkers="checkbox" renderMarker={renderMarker} />);

    // a plain header press would clear the rows channel, so the column press is ctrl (additive).
    press(markerCells()[1]!);
    press(document.querySelector<HTMLElement>('[role="columnheader"][data-column-id="name"]')!, { button: 0, ctrlKey: true });
    const markers = screen.getAllByTestId("custom-row-marker");
    expect(markers[1]).toHaveAttribute("data-marker-selected", "true");
    expect(markers[1]).toHaveAttribute("data-marker-cell-selected", "true");
    expect(markers[0]).not.toHaveAttribute("data-marker-selected");
    expect(markers[0]).toHaveAttribute("data-marker-cell-selected", "true");
  });

  it("renders the built-in checkbox when no renderMarker is passed (regression guard)", () => {
    render(<DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} rowMarkers="checkbox" />);
    const markers = markerCells();
    expect(markers.length).toBe(5);
    const checkbox = markers[0]!.querySelector<HTMLElement>('[role="checkbox"]')!;
    expect(checkbox).not.toBeNull();
    expect(checkbox).toHaveAttribute("aria-label", "Select row 1");
  });

  it("renders the built-in row number when no renderMarker is passed (regression guard)", () => {
    render(<DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} rowMarkers="number" />);
    expect(markerCells()[0]!.querySelector(gridAttrSelector("markerNumber"))?.textContent).toBe("1");
    expect(markerCells()[0]!.querySelector('[role="checkbox"]')).toBeNull();
  });

  it("in number mode the custom renderer replaces the number cell and the (blank) header", () => {
    render(
      <DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} rowMarkers="number" renderMarker={renderMarker} renderMarkerHeader={renderMarkerHeader} />,
    );

    const markers = markerCells();
    expect(markers.length).toBe(5);
    expect(markers[0]!.querySelector(gridAttrSelector("markerNumber"))).toBeNull();
    expect(markers[0]!.querySelector('[role="checkbox"]')).toBeNull();
    expect(screen.getAllByTestId("custom-row-marker")[0]).toHaveAttribute("data-row", "0");

    const markerHeader = document.querySelector<HTMLElement>(gridAttrSelector("markerHeader"))!;
    expect(screen.getByTestId("custom-marker-header")).not.toBeNull();
    // number mode has no select-all to replace, but the custom node still mounts in the blank cell.
    expect(markerHeader.querySelector('[role="checkbox"]')).toBeNull();
  });
});

describe("renderMarkerHeader (custom marker header content)", () => {
  it("renders the custom header content and receives allSelected, updating through the store", () => {
    render(
      <DataGrid data={makeRows(3)} columns={columns} getRowId={(r) => r.id} rowMarkers="checkbox" renderMarker={renderMarker} renderMarkerHeader={renderMarkerHeader} />,
    );

    const header = screen.getByTestId("custom-marker-header");
    expect(header).toHaveAttribute("data-all-selected", "unchecked");
    // the built-in select-all checkbox is replaced, not stacked.
    const markerHeader = document.querySelector<HTMLElement>(gridAttrSelector("markerHeader"))!;
    expect(markerHeader).toHaveAttribute("role", "columnheader");
    // the marker header stays outside the DATA aria-colindex space: no colindex of its own, the
    // first DATA header still owns colindex 1.
    expect(markerHeader).not.toHaveAttribute("aria-colindex");
    expect(document.querySelector<HTMLElement>('[role="columnheader"][data-column-id="name"]')).toHaveAttribute("aria-colindex", "1");
    expect(markerHeader.querySelector('[role="checkbox"]')).toBeNull();

    fireEvent.click(header);
    expect(header).toHaveAttribute("data-all-selected", "checked");
    // the action took effect: every marker cell reports the row selected.
    expect(markerCells().every((cell) => cell.getAttribute(GRID_ATTR.selected) === "true")).toBe(true);
  });

  it("reports allSelected 'indeterminate' for a partial selection, and a toggle-off clears it", () => {
    render(
      <DataGrid data={makeRows(3)} columns={columns} getRowId={(r) => r.id} rowMarkers="checkbox" renderMarker={renderMarker} renderMarkerHeader={toggleRenderMarkerHeader} />,
    );

    const header = screen.getByTestId("custom-marker-header");
    fireEvent.pointerDown(markerCells()[0]!, { button: 0 });
    expect(header).toHaveAttribute("data-all-selected", "indeterminate");

    fireEvent.click(header);
    expect(header).toHaveAttribute("data-all-selected", "checked");
    // the toggle-off direction: setAllRowsSelected(false) through the same custom control.
    fireEvent.click(header);
    expect(header).toHaveAttribute("data-all-selected", "unchecked");
    expect(markerCells().every((cell) => cell.getAttribute(GRID_ATTR.selected) === null)).toBe(true);
  });

  it("a custom select-all is a no-op when enableRowSelection is off", () => {
    render(
      <DataGrid
        data={makeRows(3)}
        columns={columns}
        getRowId={(r) => r.id}
        rowMarkers="checkbox"
        enableRowSelection={false}
        renderMarker={renderMarker}
        renderMarkerHeader={toggleRenderMarkerHeader}
      />,
    );

    fireEvent.click(screen.getByTestId("custom-marker-header"));
    expect(screen.getByTestId("custom-marker-header")).toHaveAttribute("data-all-selected", "unchecked");
    expect(markerCells().every((cell) => cell.getAttribute(GRID_ATTR.selected) === null)).toBe(true);
  });
});

describe("rowMarkers='none' with renderers", () => {
  it("renders no marker column at all, and the renderers are never called", () => {
    const renderMarkerSpy = vi.fn(() => <span data-testid="custom-row-marker" />);
    const renderMarkerHeaderSpy = vi.fn(() => <span data-testid="custom-marker-header" />);
    render(
      <DataGrid
        data={makeRows(5)}
        columns={columns}
        getRowId={(r) => r.id}
        rowMarkers="none"
        renderMarker={renderMarkerSpy}
        renderMarkerHeader={renderMarkerHeaderSpy}
      />,
    );

    expect(document.querySelector(gridAttrSelector("markerCell"))).toBeNull();
    expect(document.querySelector(gridAttrSelector("markerHeader"))).toBeNull();
    expect(renderMarkerSpy).not.toHaveBeenCalled();
    expect(renderMarkerHeaderSpy).not.toHaveBeenCalled();
  });
});
