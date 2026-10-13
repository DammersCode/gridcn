import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type ReactNode } from "react";
import type { ColumnDef, FilterSpec } from "../types";
import { DataGridProvider } from "../store";
import { DataGridRoot } from "../root";
import { DataGridHeader, type HeaderCellRenderCtx, type HeaderCellRenderer } from "../header";
import { DataGridBody } from "../body";
import { DataGrid } from "../data-grid";
import { gridAttrSelector } from "../data-attributes";

type Row = { id: string; name: string; age: number };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "age", header: "Age", accessorKey: "age" },
];

function rows(): Row[] {
  return [
    { id: "1", name: "Charlie", age: 30 },
    { id: "2", name: "Alice", age: 25 },
    { id: "3", name: "Bob", age: 40 },
  ];
}

function compose({
  data = rows(),
  headerProps,
  bodyProps,
  filterState,
  loading,
  emptyState,
  loadingState,
}: {
  data?: Row[];
  headerProps?: { className?: string; renderHeaderCell?: HeaderCellRenderer };
  bodyProps?: { className?: string };
  filterState?: FilterSpec[];
  loading?: boolean;
  emptyState?: Parameters<typeof DataGridRoot>[0]["emptyState"];
  loadingState?: Parameters<typeof DataGridRoot>[0]["loadingState"];
}) {
  return (
    <DataGridProvider data={data} columns={columns} getRowId={(r) => r.id} filterState={filterState}>
      <DataGridRoot className="h-[400px]" loading={loading} emptyState={emptyState} loadingState={loadingState}>
        <DataGridHeader {...headerProps} />
        <DataGridBody {...bodyProps} />
      </DataGridRoot>
    </DataGridProvider>
  );
}

describe("DataGridHeader composition props", () => {
  it("applies className to the header layer", () => {
    const { container } = render(compose({ headerProps: { className: "my-header" } }));
    expect(container.querySelector(gridAttrSelector("headerLayer"))).toHaveClass("my-header");
  });

  it("renderHeaderCell replaces the contents of a grid-owned header cell, once per visible column", () => {
    const renderHeaderCell = vi.fn((ctx: HeaderCellRenderCtx, Default: ReactNode) =>
      ctx.column.id === "name" ? <span data-testid="custom-header">custom</span> : Default,
    );
    const { container } = render(compose({ headerProps: { renderHeaderCell } }));

    // Every visible column is custom-rendered. The mount heal render (the windowing element
    // attaches in a pre-paint layout-effect flush) may render the header a second time, so
    // count per column rather than in total.
    const renderedColumns = new Set(renderHeaderCell.mock.calls.map(([ctx]) => ctx.column.id));
    expect([...renderedColumns].sort()).toEqual(["age", "name"]);
    const nameCell = container.querySelector<HTMLElement>('[data-column-id="name"]')!;
    expect(nameCell.getAttribute("role")).toBe("columnheader");
    expect(nameCell.getAttribute("aria-colindex")).toBe("1");
    expect(nameCell.style.gridColumnStart).not.toBe("");
    expect(nameCell.contains(screen.getByTestId("custom-header"))).toBe(true);
    expect(nameCell.textContent).toBe("custom");
    expect(container.querySelector('[data-column-id="age"]')!.textContent).toContain("Age");
  });

  it("renderHeaderCell receives the column context without the resize and reorder plumbing", () => {
    const renderHeaderCell = vi.fn((_ctx: HeaderCellRenderCtx, Default: ReactNode) => Default);
    render(compose({ headerProps: { renderHeaderCell } }));

    const [ctx] = renderHeaderCell.mock.calls[0]!;
    expect(Object.keys(ctx).sort()).toEqual(["column", "headerClickBehavior", "index", "sortState", "width"]);
    expect(ctx.column.id).toBe("name");
    expect(ctx.index).toBe(0);
    expect(ctx.width).toBeGreaterThan(0);
  });

  it("ignores sort and select gestures that start on interactive content in renderHeaderCell", () => {
    const onSortChange = vi.fn();
    const onSelectionChange = vi.fn();
    const renderHeaderCell: HeaderCellRenderer = (ctx, Default) => (
      <>
        {Default}
        <button type="button" data-testid={`action-${ctx.column.id}`}>
          act
        </button>
      </>
    );
    function Harness({ behavior }: { behavior: "sort" | "select" }) {
      return (
        <DataGridProvider
          data={rows()}
          columns={columns}
          getRowId={(r) => r.id}
          headerClickBehavior={behavior}
          onSortChange={onSortChange}
          onSelectionChange={onSelectionChange}
        >
          <DataGridRoot className="h-[400px]">
            <DataGridHeader renderHeaderCell={renderHeaderCell} />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      );
    }
    const { rerender } = render(<Harness behavior="sort" />);
    const button = screen.getByTestId("action-name");
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    expect(onSortChange).not.toHaveBeenCalled();

    rerender(<Harness behavior="select" />);
    fireEvent.pointerDown(screen.getByTestId("action-name"));
    expect(onSelectionChange).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByText("Name"));
    expect(onSelectionChange).toHaveBeenCalled();
  });

  it("without renderHeaderCell the default header cells render (regression guard)", () => {
    const { container } = render(compose({}));
    expect(container.querySelectorAll("[data-column-id]").length).toBe(2);
    expect(screen.queryByTestId("custom-header")).toBeNull();
  });
});

describe("DataGridBody composition props", () => {
  it("applies className to the rows canvas", () => {
    const { container } = render(compose({ bodyProps: { className: "my-body" } }));
    expect(container.querySelector(gridAttrSelector("rowsCanvas"))).toHaveClass("my-body");
  });
});

describe("emptyState function form", () => {
  it("reports reason 'no-data' when the data array itself is empty", () => {
    const seen: string[] = [];
    render(
      <DataGrid
        data={[]}
        columns={columns}
        getRowId={(r) => r.id}
        className="h-[400px]"
        emptyState={(ctx) => {
          seen.push(ctx.reason);
          return <span>{ctx.reason}</span>;
        }}
      />,
    );
    expect(screen.getByText("no-data")).toBeDefined();
    // The mount heal render calls emptyState again pre-paint — every call must report the
    // no-data reason; the count itself is an implementation detail.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((reason) => reason === "no-data")).toBe(true);
  });

  it("reports reason 'filtered' when rows exist but the filter removes all of them", () => {
    render(
      <DataGrid
        data={rows()}
        columns={columns}
        getRowId={(r) => r.id}
        className="h-[400px]"
        filterState={[{ columnId: "name", operator: "equals", value: "Nobody" }]}
        emptyState={(ctx) => <span>{ctx.reason}</span>}
      />,
    );
    expect(screen.getByText("filtered")).toBeDefined();
  });

  it("a plain ReactNode emptyState still renders unchanged", () => {
    render(
      <DataGrid data={[]} columns={columns} getRowId={(r) => r.id} className="h-[400px]" emptyState={<span>static</span>} />,
    );
    expect(screen.getByText("static")).toBeDefined();
  });
});

describe("loadingState slot", () => {
  it("replaces the skeleton when loading with zero rows", () => {
    const { container } = render(
      <DataGrid
        data={[]}
        columns={columns}
        getRowId={(r) => r.id}
        className="h-[400px]"
        loading
        loadingState={<span>custom loading</span>}
      />,
    );
    expect(container.querySelector(gridAttrSelector("loadingState"))).toHaveTextContent("custom loading");
    expect(container.querySelectorAll(gridAttrSelector("loadingSkeleton")).length).toBe(0);
  });

  it("replaces the bar when loading with rows present, and a function form receives the reason", () => {
    const { container } = render(
      <DataGrid
        data={rows()}
        columns={columns}
        getRowId={(r) => r.id}
        className="h-[400px]"
        loading
        loadingState={(ctx) => <span>{ctx.reason}</span>}
      />,
    );
    expect(container.querySelector(gridAttrSelector("loadingState"))).toHaveTextContent("rows-present");
    expect(container.querySelectorAll(gridAttrSelector("loadingBar")).length).toBe(0);
  });

  it("renders nothing while not loading", () => {
    const { container } = render(
      <DataGrid data={rows()} columns={columns} getRowId={(r) => r.id} className="h-[400px]" loadingState={<span>custom loading</span>} />,
    );
    expect(container.querySelector(gridAttrSelector("loadingState"))).toBeNull();
  });

  it("the built-in loading UI still renders when loadingState is omitted (regression guard)", () => {
    const { container } = render(<DataGrid data={[]} columns={columns} getRowId={(r) => r.id} className="h-[400px]" loading />);
    expect(container.querySelectorAll(gridAttrSelector("loadingSkeleton")).length).toBeGreaterThan(0);
  });
});
