import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, type ColumnDef } from "../data-grid";
import { buildDefaultLabels } from "../label-defaults";

type Row = { id: string; region: string; qty: number };

const columns: ColumnDef<Row, unknown>[] = [
  { id: "region", header: "Region", accessorKey: "region" },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", aggregate: "sum" },
];

const rows: Row[] = [
  { id: "1", region: "north", qty: 1000.5 },
  { id: "2", region: "north", qty: 2000 },
];

afterEach(cleanup);

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 360 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
});

function mount(props: Record<string, unknown>) {
  return render(
    <DataGridProvider columns={columns} defaultData={rows} getRowId={(row: Row) => row.id} defaultGroupBy={["region"]} {...props}>
      <DataGridRoot aria-label="Sales">
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>,
  );
}

const groupRowText = () => document.querySelector("[data-grid-group-row]")!.textContent;

describe("group row i18n", () => {
  it("formats the aggregate in the grid locale", () => {
    mount({ locale: "de-DE" });
    expect(groupRowText()).toContain("3.000,5");
  });

  it("composes the group row text through labels.grouping.rowLabel", () => {
    mount({ labels: { grouping: { rowLabel: (column: string, label: string, count: number) => `${label} / ${column} / ${count}` } } });
    expect(groupRowText()).toContain("north / Region / 2");
  });

  it("composes the group name of the announcement through labels.grouping.groupName", async () => {
    mount({ labels: { grouping: { groupName: (column: string, label: string) => `${label} in ${column}` } } });
    fireEvent.click(screen.getByRole("button", { name: "Expand north" }));
    await waitFor(() => expect(document.querySelector("[data-grid-live-region]")!.textContent).toContain("north in Region expanded"), { timeout: 2000 });
  });
});

describe("default labels in a locale", () => {
  const de = buildDefaultLabels("de-DE");

  it("formats the group row count", () => {
    expect(de.grouping.rowLabel("Rolle", "Admin", 12345)).toBe("Rolle: Admin (12.345)");
  });

  it("formats the pagination ranges", () => {
    expect(de.pagination.range(1, 50, 100000)).toBe("1–50 of 100.000");
    expect(de.pagination.rangeGroups(1, 10, 1234)).toBe("1–10 of 1.234 groups");
  });

  it("formats the counts of the import, print, and replace messages", () => {
    expect(de.io.previewTruncated(1000, 25000)).toBe("Showing 1.000 of 25.000 rows");
    expect(de.findReplace.replaced(1500, 0)).toBe("1.500 replaced");
    expect(de.findReplace.replacedAndMore("1.500 replaced", "More remain.")).toBe("1.500 replaced. More remain.");
  });
});
