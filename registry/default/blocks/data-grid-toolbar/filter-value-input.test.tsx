import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cellTypes,
  DataGridProvider,
  type AnyColumnDef,
  type CellType,
  type ColumnDef,
  type FilterOperator,
  type FilterValueInputProps,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridFilterValueInput } from "./filter-value-input";

type Row = { id: string; amount: number };

afterEach(cleanup);

function renderInput(cellType: CellType, operator: FilterOperator = "gt") {
  const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "amount", header: "Amount", accessorKey: "amount", type: "money" as never }];
  return render(
    <DataGridProvider data={[]} columns={columns} getRowId={(r) => r.id} cellTypes={{ money: cellType } as never}>
      <DataGridFilterValueInput column={columns[0] as AnyColumnDef} operator={operator} value={undefined} onValueChange={vi.fn()} />
    </DataGridProvider>,
  );
}

const textType = cellTypes.text as unknown as CellType;

describe("DataGridFilterValueInput", () => {
  it("renders the built-in widget a custom type names in filter.valueInput", () => {
    renderInput({ ...textType, filter: { valueInput: "number" } });
    expect(screen.getByRole("spinbutton")).toBeTruthy();
  });

  it("renders two of the named widget for isBetween", () => {
    renderInput({ ...textType, filter: { valueInput: "date" } }, "isBetween");
    expect(document.querySelectorAll('input[type="date"]')).toHaveLength(2);
  });

  it("renders a custom type's component with the column, operator, and value", () => {
    function MoneyInput(props: FilterValueInputProps) {
      return <span data-testid="money-input">{`${props.column.id}:${props.operator}`}</span>;
    }
    renderInput({ ...textType, filter: { valueInput: MoneyInput } }, "isBetween");
    expect(screen.getByTestId("money-input").textContent).toBe("amount:isBetween");
  });

  it("falls back to a text input for a custom type without filter.valueInput", () => {
    renderInput(textType);
    expect(screen.getByRole("textbox")).toBeTruthy();
  });
});
