import { act, cleanup, render } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "../types";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot } from "../data-grid";

type Row = { id: string; name: string; qty: number };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
];

const rows: Row[] = Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: `Row ${i}`, qty: i }));

const MOUNTED_ROWS = 10;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => MOUNTED_ROWS * 36 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
});

afterAll(() => {
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
});

afterEach(cleanup);

const dataRowCount = (container: ParentNode) => container.querySelectorAll('[role="row"][data-grid-row-index]').length;

function CellCountProbe({ counts }: { counts: number[] }) {
  useLayoutEffect(() => {
    counts.push(document.querySelectorAll('[role="gridcell"]').length);
  });
  return null;
}

const grid = (children?: React.ReactNode) => (
  <DataGridProvider data={rows} columns={columns} getRowId={(row) => row.id}>
    <DataGridRoot className="h-90">
      <DataGridHeader />
      <DataGridBody />
      {children}
    </DataGridRoot>
  </DataGridProvider>
);

describe("grid mount", () => {
  it("renders no data cell in the first commit of a client mount", () => {
    const counts: number[] = [];
    const { container } = render(grid(<CellCountProbe counts={counts} />));
    expect(counts[0]).toBe(0);
    expect(container.querySelectorAll('[role="gridcell"]').length).toBeGreaterThan(0);
  });

  it("renders the visible rows plus overscan once mounted", () => {
    const { container } = render(grid());
    expect(dataRowCount(container)).toBe(MOUNTED_ROWS);
  });

  it("server-renders a preview window of rows", () => {
    const html = renderToString(grid());
    expect(html.match(/role="gridcell"/g)).toHaveLength(30 * columns.length);
  });

  it("hydrates the server preview without a recoverable error, then settles on the visible rows", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(grid());
    document.body.appendChild(container);
    const onRecoverableError = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, grid(), { onRecoverableError });
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(dataRowCount(container)).toBe(MOUNTED_ROWS);
    await act(async () => root.unmount());
    consoleError.mockRestore();
    container.remove();
  });
});
