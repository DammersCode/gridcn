import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataGrid } from "./data-grid";
import { DataGridProvider, useDataGridStoreProps } from "./store";
import { DataGridRoot } from "./root";
import { resolveHeaderHeight } from "./rows/density";
import type { ColumnDef } from "./types";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const data: Row[] = [{ id: "a", name: "A" }];

describe("DataGrid root props", () => {
  it("names the grid with aria-label", () => {
    const { container } = render(<DataGrid data={data} columns={columns} getRowId={(r: Row) => r.id} aria-label="Tasks" />);
    expect(container.querySelector('[role="grid"]')?.getAttribute("aria-label")).toBe("Tasks");
  });

  it("names the grid with aria-labelledby", () => {
    const { container } = render(<DataGrid data={data} columns={columns} getRowId={(r: Row) => r.id} aria-labelledby="title" />);
    expect(container.querySelector('[role="grid"]')?.getAttribute("aria-labelledby")).toBe("title");
  });
});

describe("DataGrid shell", () => {
  const gridOf = (container: HTMLElement) => container.querySelector('[role="grid"]');

  it("names a grid without aria-label with labels.grid.gridName", () => {
    const { container } = render(<DataGrid data={data} columns={columns} getRowId={(r: Row) => r.id} />);
    expect(gridOf(container)?.getAttribute("aria-label")).toBe("Data grid");
    const custom = render(<DataGrid data={data} columns={columns} getRowId={(r: Row) => r.id} labels={{ grid: { gridName: "Tasks" } }} />);
    expect(gridOf(custom.container)?.getAttribute("aria-label")).toBe("Tasks");
  });

  it("leaves the name to aria-labelledby", () => {
    const { container } = render(<DataGrid data={data} columns={columns} getRowId={(r: Row) => r.id} aria-labelledby="title" />);
    expect(gridOf(container)?.hasAttribute("aria-label")).toBe(false);
  });

  it("shows the error, not the loading skeleton, when both are set", () => {
    const { container } = render(<DataGrid data={[]} columns={columns} getRowId={(r: Row) => r.id} loading error={new Error("boom")} />);
    expect(container.querySelector("[data-grid-loading-skeleton]")).toBeNull();
  });

  it("renders the toolbar prop before the grid", () => {
    const { container } = render(<DataGrid data={data} columns={columns} getRowId={(r: Row) => r.id} toolbar={<div data-testid="tb" />} />);
    const toolbar = container.querySelector("[data-testid=tb]");
    expect(toolbar).not.toBeNull();
    expect(toolbar!.compareDocumentPosition(gridOf(container)!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sizes the header by density and lets headerHeight win", () => {
    expect(resolveHeaderHeight("compact", undefined)).toBe(32);
    expect(resolveHeaderHeight(undefined, undefined)).toBe(36);
    expect(resolveHeaderHeight("comfortable", undefined)).toBe(40);
    expect(resolveHeaderHeight("compact", 50)).toBe(50);
  });

  it("warns once when a second root mounts on a store that another root serves", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    function Two() {
      const { store } = useDataGridStoreProps({ data, columns, getRowId: (r: Row) => r.id });
      return (
        <DataGridProvider store={store}>
          <DataGridRoot aria-label="a" />
          <DataGridRoot aria-label="b" />
        </DataGridProvider>
      );
    }
    render(<Two />);
    expect(warn.mock.calls.filter(([m]) => String(m).includes("second DataGridRoot"))).toHaveLength(1);
    warn.mockRestore();
  });
});
