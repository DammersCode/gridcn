import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { flushSync } from "react-dom";
import type { ColumnDef, ColumnLayout } from "../types";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot } from "../data-grid";
import "@/app/global.css";

type Row = { id: string; short: string; long: string };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "short", header: "S", accessorKey: "short" },
  { id: "long", header: "L", accessorKey: "long" },
];

const rows: Row[] = Array.from({ length: 200 }, (_, i) => ({ id: String(i), short: String(i % 10), long: `a considerably longer cell text ${i}` }));

const grid = (props: { onColumnLayoutChange?: (layout: ColumnLayout) => void } = {}) => (
  <DataGridProvider data={rows} columns={columns} getRowId={(row) => row.id} autosizeOnMount {...props}>
    <DataGridRoot className="h-[360px] w-[640px]">
      <DataGridHeader />
      <DataGridBody />
    </DataGridRoot>
  </DataGridProvider>
);

const mountedRows = (root: ParentNode) => root.querySelectorAll('[role="row"][data-grid-row-index]').length;

describe("grid mount in a real browser", () => {
  it("has the visible rows in the DOM by the first animation frame", async () => {
    const { container } = await render(grid());
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(mountedRows(container)).toBe(10);
    expect(container.querySelectorAll('[role="gridcell"]').length).toBe(10 * columns.length);
  });

  it("autosizes once the rows are mounted: the long column ends up wider than the short one", async () => {
    const cellsAtAutosize: number[] = [];
    const onColumnLayoutChange = vi.fn<(layout: ColumnLayout) => void>(() => {
      cellsAtAutosize.push(document.querySelectorAll('[role="gridcell"]').length);
    });
    await render(grid({ onColumnLayoutChange }));
    await vi.waitFor(() => expect(onColumnLayoutChange).toHaveBeenCalledTimes(1));
    expect(cellsAtAutosize[0]).toBeGreaterThan(0);
    const { widths } = onColumnLayoutChange.mock.calls[0]![0];
    expect(widths["long"]).toBeGreaterThan(widths["short"]! + 100);
  });

  it("hydrates the server HTML without a recoverable error and settles on the visible rows", async () => {
    const host = document.createElement("div");
    host.style.width = "640px";
    host.innerHTML = renderToString(grid());
    document.body.appendChild(host);
    const onRecoverableError = vi.fn();
    const consoleError = vi.spyOn(console, "error");
    let root!: ReturnType<typeof hydrateRoot>;
    flushSync(() => {
      root = hydrateRoot(host, grid(), { onRecoverableError });
    });
    await vi.waitFor(() => expect(mountedRows(host)).toBe(10));
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    root.unmount();
    host.remove();
    consoleError.mockRestore();
  });
});
