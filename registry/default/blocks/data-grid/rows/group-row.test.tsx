import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, type ColumnDef } from "../data-grid";
import { groupLabelSpan } from "./group-row";

type Row = { id: string; region: string | null; team: string; qty: number };

const columns: ColumnDef<Row, unknown>[] = [
  { id: "region", header: "Region", accessorKey: "region" },
  { id: "team", header: "Team", accessorKey: "team" },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", aggregate: "sum" },
];

const rows: Row[] = [
  { id: "1", region: "north", team: "a", qty: 1 },
  { id: "2", region: "south", team: "a", qty: 2 },
  { id: "3", region: "north", team: "b", qty: 3 },
  { id: "4", region: null, team: "a", qty: 4 },
];

afterEach(cleanup);

// jsdom performs no layout; the row window reads clientHeight.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 360 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
});

function mount(props: Record<string, unknown> = {}, rootProps: Record<string, unknown> = {}) {
  return render(
    <DataGridProvider columns={columns} defaultData={rows} getRowId={(row: Row) => row.id} {...props}>
      <DataGridRoot aria-label="Sales" {...rootProps}>
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>,
  );
}

const groupRows = () => Array.from(document.querySelectorAll<HTMLElement>("[data-grid-group-row]"));

describe("a grouped grid", () => {
  it("is a treegrid with one collapsed group row per group", () => {
    mount({ defaultGroupBy: ["region"] });
    expect(screen.getByRole("treegrid")).toBeTruthy();
    expect(groupRows().map((row) => row.textContent)).toEqual(["Region: north (2)4", "Region: south (1)2", "Region: (empty) (1)4"]);
    expect(groupRows().map((row) => [row.getAttribute("aria-level"), row.getAttribute("aria-expanded"), row.getAttribute("aria-posinset"), row.getAttribute("aria-setsize")])).toEqual([
      ["1", "false", "1", "3"],
      ["1", "false", "2", "3"],
      ["1", "false", "3", "3"],
    ]);
  });

  it("shows the aggregate through the column type and spans the label over the columns before it", () => {
    mount({ defaultGroupBy: ["region"] });
    const cells = within(groupRows()[0]!).getAllByRole("gridcell");
    expect(cells.map((cell) => cell.textContent)).toEqual(["Region: north (2)", "4"]);
    expect(cells[0]!.getAttribute("aria-colspan")).toBe("2");
    expect(cells.every((cell) => cell.getAttribute("aria-readonly") === "true")).toBe(true);
  });

  it("opens a group from its toggle and numbers its rows inside the group", () => {
    mount({ defaultGroupBy: ["region"], rowMarkers: "number" });
    fireEvent.click(screen.getByRole("button", { name: "Expand north" }));
    expect(screen.getByRole("button", { name: "Collapse north" })).toBeTruthy();
    const rowEls = screen.getAllByRole("row").filter((row) => row.hasAttribute("data-grid-row-index"));
    const dataRows = rowEls.filter((row) => !row.hasAttribute("data-grid-group-row"));
    expect(dataRows).toHaveLength(2);
    expect(dataRows.map((row) => [row.getAttribute("aria-level"), row.getAttribute("aria-posinset"), row.getAttribute("aria-setsize")])).toEqual([
      ["2", "1", "2"],
      ["2", "2", "2"],
    ]);
    expect(dataRows.map((row) => within(row).getAllByRole("gridcell")[0]!.textContent)).toEqual(["1", "2"]);
    expect(groupRows()[0]!.getAttribute("aria-expanded")).toBe("true");
  });

  it("gives a group row no checkbox and no row number", () => {
    mount({ defaultGroupBy: ["region"], rowMarkers: "both" });
    expect(within(groupRows()[0]!).queryByRole("checkbox")).toBeNull();
    expect(groupRows()[0]!.querySelector("[data-grid-marker-number]")).toBeNull();
  });

  it("nests a second level and indents it through the spacing variable", () => {
    mount({ defaultGroupBy: ["region", "team"], defaultExpanded: { mode: "expanded", ids: [] } });
    const levels = groupRows().map((row) => row.getAttribute("aria-level"));
    expect(levels).toContain("2");
    const nested = groupRows().find((row) => row.getAttribute("aria-level") === "2")!;
    expect(nested.querySelector<HTMLElement>("[data-grid-group-label]")!.style.paddingInlineStart).toContain("var(--grid-group-indent, 1rem)");
    const dataRow = screen.getAllByRole("row").find((row) => !row.hasAttribute("data-grid-group-row") && row.hasAttribute("data-grid-row-index"))!;
    expect(dataRow.getAttribute("aria-level")).toBe("3");
  });

  it("renders the label through renderGroupLabel as a React node", () => {
    mount({ defaultGroupBy: ["region"] }, { renderGroupLabel: (ctx: { label: string; count: number; expanded: boolean }) => <b data-testid="label">{`${ctx.label}/${ctx.count}/${ctx.expanded}`}</b> });
    expect(screen.getAllByTestId("label").map((node) => node.textContent)).toEqual(["north/2/false", "south/1/false", "(empty)/1/false"]);
  });

  it("takes the labels from the labels prop", () => {
    mount({ defaultGroupBy: ["region"], labels: { grouping: { expand: (label: string) => `Open ${label}`, empty: "none" } } });
    expect(screen.getByRole("button", { name: "Open north" })).toBeTruthy();
    expect(groupRows()[2]!.textContent).toContain("none");
  });

  it("treats a group row's text as text, never as markup", () => {
    mount({ defaultData: [{ id: "x", region: "<img src=x onerror=alert(1)>", team: "a", qty: 1 }], defaultGroupBy: ["region"] });
    expect(document.querySelector("img")).toBeNull();
    expect(groupRows()[0]!.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("follows a controlled expanded state", () => {
    const { rerender } = mount({ defaultGroupBy: ["region"], expanded: { mode: "collapsed", ids: [] } });
    expect(groupRows()).toHaveLength(3);
    rerender(
      <DataGridProvider columns={columns} defaultData={rows} getRowId={(row: Row) => row.id} defaultGroupBy={["region"]} expanded={{ mode: "expanded", ids: [] }}>
        <DataGridRoot aria-label="Sales">
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
    expect(screen.getAllByRole("row").filter((row) => row.hasAttribute("data-grid-row-index"))).toHaveLength(7);
  });

  it("moves the active cell onto a group row and marks it", () => {
    mount({ defaultGroupBy: ["region"] });
    act(() => {
      fireEvent.pointerDown(screen.getByText("Region: north (2)"));
    });
    expect(groupRows()[0]!.querySelector("[data-active]")).not.toBeNull();
  });
});

describe("a grid that does not group", () => {
  it("stays a grid with no group attributes and no group row", () => {
    mount();
    expect(screen.getByRole("grid")).toBeTruthy();
    expect(screen.queryByRole("treegrid")).toBeNull();
    expect(groupRows()).toHaveLength(0);
    const first = screen.getAllByRole("row").find((row) => row.hasAttribute("data-grid-row-index"))!;
    expect(first.hasAttribute("aria-level")).toBe(false);
    expect(first.hasAttribute("aria-posinset")).toBe(false);
  });

  it("numbers rows by their view position", () => {
    mount({ rowMarkers: "number" });
    const dataRows = screen.getAllByRole("row").filter((row) => row.hasAttribute("data-grid-row-index"));
    expect(within(dataRows[3]!).getAllByRole("gridcell")[0]!.textContent).toBe("4");
  });
});

describe("groupLabelSpan", () => {
  it("covers the columns before the first aggregate column, at least one", () => {
    expect(groupLabelSpan([{}, {}, { aggregate: "sum" }])).toBe(2);
    expect(groupLabelSpan([{ aggregate: "sum" }, {}])).toBe(1);
    expect(groupLabelSpan([{}, {}])).toBe(2);
  });
});

describe("server rendering", () => {
  it("hydrates a defaultGroupBy grid with no mismatch", () => {
    const tree = (
      <DataGridProvider columns={columns} defaultData={rows} getRowId={(row: Row) => row.id} defaultGroupBy={["region"]}>
        <DataGridRoot aria-label="Sales">
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    );
    const html = renderToString(tree);
    expect(html).toContain('role="treegrid"');
    expect(html).toContain("data-grid-group-row");
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let root!: Root;
    act(() => {
      root = hydrateRoot(container, tree);
    });
    expect(errors).not.toHaveBeenCalled();
    expect(container.querySelectorAll("[data-grid-group-row]")).toHaveLength(3);
    act(() => root.unmount());
    container.remove();
    errors.mockRestore();
  });
});
