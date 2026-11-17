import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import axe from "axe-core";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, type ColumnDef } from "../data-grid";
import { DataGridPaginationBar } from "@/registry/default/blocks/data-grid-pagination/pagination-footer";
import "@/app/global.css";

type Row = { id: string; region: string; team: string; qty: number };

const rows: Row[] = Array.from({ length: 24 }, (_, i) => ({ id: `r${i}`, region: `Region ${i % 4}`, team: `Team ${i % 2}`, qty: i }));

const columns: ColumnDef<Row, unknown>[] = [
  { id: "region", header: "Region", accessorKey: "region", width: 160 },
  { id: "team", header: "Team", accessorKey: "team", width: 120 },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", aggregate: "sum", width: 100 },
];

function Fixture({ props = {} }: { props?: Record<string, unknown> }) {
  return (
    <main>
      <DataGridProvider data={rows} columns={columns} getRowId={(r: Row) => r.id} defaultGroupBy={["region"]} rowMarkers="checkbox" {...props}>
        <DataGridRoot className="h-[320px] w-[600px]" aria-label="Groups">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
        {props["defaultPageSize"] !== undefined && <DataGridPaginationBar />}
      </DataGridProvider>
    </main>
  );
}

const groupRows = () => [...document.querySelectorAll<HTMLElement>("[data-grid-group-row]")];
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
const activeCell = () => document.querySelector<HTMLElement>('[role="gridcell"][data-active]');

async function violations(): Promise<axe.Result[]> {
  return (await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } })).violations;
}

describe("treegrid a11y", () => {
  it("has zero axe violations collapsed, opened, and with two levels", async () => {
    await render(<Fixture props={{ defaultGroupBy: ["region", "team"] }} />);
    await expect.poll(() => groupRows().length).toBe(4);
    expect(await violations()).toHaveLength(0);
    await userEvent.click(page.getByRole("button", { name: "Expand Region 0" }));
    await userEvent.click(page.getByRole("button", { name: "Expand Team 0" }));
    await expect.poll(() => document.querySelectorAll('[role="row"][aria-level="3"]').length).toBeGreaterThan(0);
    const found = await violations();
    expect(found, found.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`).join("\n")).toHaveLength(0);
  });
});

describe("keys on a group row", () => {
  it("opens with Enter, keeps the focus on the active cell, and closes with ArrowLeft", async () => {
    await render(<Fixture />);
    await expect.poll(() => groupRows().length).toBe(4);
    await settle();
    await userEvent.click(groupRows()[0]!.querySelector('[data-grid-group-label] > span')!);
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => groupRows()[0]!.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(activeCell());
    await userEvent.keyboard("{ArrowLeft}");
    await expect.poll(() => groupRows()[0]!.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(activeCell());
  });

  it("toggles once for Enter on a focused toggle button", async () => {
    await render(<Fixture />);
    await expect.poll(() => groupRows().length).toBe(4);
    const toggle = groupRows()[0]!.querySelector<HTMLElement>("[data-grid-group-toggle]")!;
    toggle.focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => groupRows()[0]!.getAttribute("aria-expanded")).toBe("true");
  });

  it("mirrors the arrows under RTL", async () => {
    await render(
      <main dir="rtl">
        <DataGridProvider data={rows} columns={columns} getRowId={(r: Row) => r.id} defaultGroupBy={["region"]}>
          <DataGridRoot direction="rtl" className="h-[320px] w-[600px]" aria-label="Groups">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </main>,
    );
    await expect.poll(() => groupRows().length).toBe(4);
    await settle();
    await userEvent.click(groupRows()[0]!.querySelector('[data-grid-group-label] > span')!);
    await userEvent.keyboard("{ArrowLeft}");
    await expect.poll(() => groupRows()[0]!.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("pages of groups", () => {
  it("reads the range in groups and pages through them", async () => {
    await render(<Fixture props={{ defaultPageSize: 2 }} />);
    await expect.poll(() => groupRows().length).toBe(2);
    await expect.element(page.getByText("1–2 of 4 groups")).toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: "Next page" }));
    await expect.element(page.getByText("3–4 of 4 groups")).toBeInTheDocument();
    expect(groupRows().map((row) => row.textContent)).toEqual([expect.stringContaining("Region 2"), expect.stringContaining("Region 3")]);
  });
});
