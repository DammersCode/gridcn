import { describe, expect, it } from "vitest";
import { cellTypes } from "@/registry/default/blocks/data-grid/cell-types/cell-types";
import { buildImportedRows, type ProcessCellFromText } from "./build-imported-rows";

type Order = { id: string; customer: string; total: number };

const build = (processCellFromText: ProcessCellFromText<Order>) =>
  buildImportedRows<Order>({
    dataRows: [[" Ada ", " 12.5 "]],
    mapping: [
      { importColumnIndex: 0, gridColumnId: "customer" },
      { importColumnIndex: 1, gridColumnId: "total" },
    ],
    columns: [
      { id: "customer", header: "Customer", accessorKey: "customer" },
      { id: "total", header: "Total", accessorKey: "total", type: "number" },
    ],
    cellTypes: cellTypes as never,
    createRow: () => ({ id: "1", customer: "", total: 0 }),
    processCellFromText,
  });

describe("control-import sample", () => {
  it("parses total as a number and trims the other cells", async () => {
    const result = await build((text, { column }) => (column.id === "total" ? Number.parseFloat(text) : text.trim()));
    expect(result.rows[0]).toMatchObject({ customer: "Ada", total: 12.5 });
  });

  it("stores the hook result as it is and skips fromText", async () => {
    const result = await build((text) => text.trim());
    expect(result.rows[0]!.total).toBe("12.5");
  });
});
