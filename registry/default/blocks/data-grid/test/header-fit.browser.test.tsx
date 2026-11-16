import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, defineColumns } from "../data-grid";
import { gridAttrSelector } from "../data-grid-sdk";
import "@/app/global.css";

type Row = { id: string; name: string; email: string; age: number };

const rows: Row[] = Array.from({ length: 20 }, (_, i) => ({ id: `row-${i}`, name: `Person ${i}`, email: `p${i}@example.com`, age: 18 + i }));

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 96 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 96 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 96 },
] as const);

const headerCells = () => [...document.querySelectorAll<HTMLElement>('[role="columnheader"]')];

afterEach(() => {
  document.documentElement.style.fontSize = "";
  document.documentElement.classList.remove("dark");
});

async function sortThreeColumns(width: number) {
  await render(
    <div style={{ height: 400, width }}>
      <DataGrid
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        aria-label="People"
        className="h-[400px]"
        headerClickBehavior="sort"
        renderHeaderMenu={({ trigger }) => trigger}
      />
    </div>,
  );
  await expect.element(page.getByRole("grid")).toBeInTheDocument();
  await userEvent.click(headerCells()[0]!);
  await userEvent.keyboard("{Shift>}");
  await userEvent.click(headerCells()[1]!);
  await userEvent.click(headerCells()[2]!);
  await userEvent.keyboard("{/Shift}");
}

function expectIndicatorsInsideHeaders() {
  const indicators = document.querySelectorAll<HTMLElement>(gridAttrSelector("sortIndicator"));
  expect(indicators).toHaveLength(3);
  for (const indicator of indicators) {
    const cell = indicator.closest<HTMLElement>('[role="columnheader"]')!;
    expect(indicator.scrollWidth).toBeLessThanOrEqual(indicator.clientWidth);
    expect(indicator.getBoundingClientRect().right).toBeLessThanOrEqual(cell.getBoundingClientRect().right + 0.5);
    expect(cell.scrollWidth).toBeLessThanOrEqual(cell.clientWidth + 1);
  }
  expect([...indicators].map((el) => el.textContent)).toEqual(["1", "2", "3"]);
}

describe("header fit", () => {
  it("shows the sort number of a third sorted column inside its header", async () => {
    await sortThreeColumns(500);
    expectIndicatorsInsideHeaders();
  });

  it("keeps all three sort numbers inside their headers at an 18px root font", async () => {
    document.documentElement.style.fontSize = "18px";
    await sortThreeColumns(500);
    expectIndicatorsInsideHeaders();
  });

  it("keeps the sort numbers inside their headers in dark mode at a 375px viewport width", async () => {
    document.documentElement.classList.add("dark");
    await sortThreeColumns(375);
    expectIndicatorsInsideHeaders();
  });
});
