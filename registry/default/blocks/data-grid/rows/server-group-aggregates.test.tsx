import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DataGridBody, DataGridProvider, DataGridRoot, type ColumnDef } from "../data-grid";
import type { ServerGroupLayout } from "../group-types";

type Row = { id: string; region: string; amount: number; name: string; at: string };

const columns: ColumnDef<Row, unknown>[] = [
  { id: "region", header: "Region", accessorKey: "region" },
  { id: "amount", header: "Amount", accessorKey: "amount", type: "number", aggregate: "sum" },
  { id: "name", header: "Name", accessorKey: "name", aggregate: "min" },
  { id: "at", header: "At", accessorKey: "at", type: "date", aggregate: "max" },
];
const placeholder: Row = { id: "", region: "", amount: 0, name: "", at: "" };
const layout = (aggregates: Record<string, unknown>): ServerGroupLayout => ({ rows: [{ viewRow: 0, path: [{ columnId: "region", key: "EU" }], count: 2, childCount: 0, aggregates }], leafCount: 2 });

afterEach(cleanup);

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 360 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 2000 });
});

const cellText = (columnId: string): string | null => document.querySelector(`[role="row"] [data-column-id="${columnId}"]`)?.textContent ?? null;

describe("server group row aggregates", () => {
  it("shows an exact decimal sum in the number format and text and date strings for min and max", async () => {
    render(
      <DataGridProvider columns={columns} data={[placeholder]} getRowId={(_r: Row, i: number) => `slot-${i}`} groupBy={["region"]} groupLayout={layout({ amount: "123456789012345.675", name: "alpha", at: "2024-03-10" })}>
        <DataGridRoot aria-label="Sales">
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
    await screen.findByText("alpha");
    expect(cellText("amount")).toBe("123,456,789,012,345.68");
    expect(cellText("at")).toBe("2024-03-10");
  });

  it("keeps a number sum in the number format", async () => {
    render(
      <DataGridProvider columns={columns} data={[placeholder]} getRowId={(_r: Row, i: number) => `slot-${i}`} groupBy={["region"]} groupLayout={layout({ amount: 1250.555 })}>
        <DataGridRoot aria-label="Sales">
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
    await screen.findByText("1,250.56");
  });
});
