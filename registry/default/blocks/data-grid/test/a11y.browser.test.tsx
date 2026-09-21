import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import axe from "axe-core";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "../data-grid";
import { DataGridToolbar, DataGridSearch, DataGridFilterMenu, DataGridColumnsMenu } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import { useDataGridPinnedRows } from "@/registry/default/blocks/data-grid-pinned-rows/data-grid-pinned-rows";
// real stylesheet so Tailwind's `grid`/`overflow-auto` actually apply — axe's color-contrast and
// layout-dependent rules are meaningless (and noisy) without real computed styles.
import "@/app/global.css";

type Row = { id: string; name: string; email: string; age: number };

function makeRows(): Row[] {
  return [
    { id: "r0", name: "Alice", email: "alice@example.com", age: 30 },
    { id: "r1", name: "Bob", email: "bob@example.com", age: 40 },
    { id: "r2", name: "Carol", email: "carol@example.com", age: 25 },
    { id: "r3", name: "Dave", email: "dave@example.com", age: 50 },
  ];
}

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 80 },
] as const);

const totals: Row = { id: "totals", name: "Total", email: "", age: 145 };

/**
 * Representative fixture: toolbar (search/filter/columns) + row markers (checkbox mode,
 * exercises the select-all header + per-row checkboxes) + a pinned-top row (via the
 * `data-grid-pinned-rows` add-on) + a sorted column. Wrapped in a `<main>` landmark: axe's
 * `region` rule expects all page content to sit inside a landmark, which is the CONSUMER page's
 * job (a registry component can't unilaterally own the page shell) — the wrapper here stands in
 * for that so the rule checks what it's meant to.
 */
function Fixture() {
  const { rowBands } = useDataGridPinnedRows({ topRows: [totals] });
  return (
    <main data-testid="fixture-root">
      <DataGridProvider
        data={makeRows()}
        columns={columns}
        getRowId={(r) => r.id}
        sortState={[{ columnId: "name", direction: "asc" }]}
        rowMarkers="checkbox"
        rowBands={rowBands}
      >
        <DataGridToolbar>
          <DataGridSearch />
          <DataGridFilterMenu />
          <DataGridColumnsMenu />
        </DataGridToolbar>
        <DataGridRoot className="h-[300px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </main>
  );
}

function renderFixture() {
  return render(<Fixture />);
}

/** Runs axe against the whole document and returns only violations (axe "incomplete"/"inapplicable" results are not failures). */
async function runAxe(): Promise<axe.Result[]> {
  const results = await axe.run(document.body, {
    // color-contrast needs real font metrics/paint timing axe's own heuristics don't always get
    // right in a headless browser-mode iframe; every other rule in the default ruleset stays on.
    rules: { "color-contrast": { enabled: false } },
  });
  return results.violations;
}

function formatViolations(violations: axe.Result[]): string {
  return violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n  nodes: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)
    .join("\n");
}

describe("DataGrid a11y — axe-core", () => {
  it("has zero violations on the base fixture (toolbar + markers + pinned row + sorted column)", async () => {
    renderFixture();
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const violations = await runAxe();
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  it("has zero violations with a cell editor open", async () => {
    renderFixture();
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const cell = [...document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="name"]')].find((c) =>
      c.textContent?.includes("Alice"),
    )!;
    await userEvent.dblClick(cell);
    await expect.element(page.getByRole("gridcell").getByRole("textbox")).toBeInTheDocument();

    const violations = await runAxe();
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  it("has zero violations with a multi-cell range selected (aria-selected on every member)", async () => {
    renderFixture();
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const nameCells = [...document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="name"]')];
    const ageCells = [...document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="age"]')];
    await userEvent.click(nameCells[0]!);
    // shift+click the diagonal cell to grow a rectangular range covering both columns, both rows.
    await userEvent.keyboard("{Shift>}");
    await userEvent.click(ageCells[1]!);
    await userEvent.keyboard("{/Shift}");

    const selected = document.querySelectorAll('[role="gridcell"][aria-selected="true"]');
    expect(selected.length).toBeGreaterThan(1);

    const violations = await runAxe();
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});
