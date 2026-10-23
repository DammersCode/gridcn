import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("keeps isAnyOf values outside the column choices when toggling a choice", async () => {
    const columns: readonly ColumnDef<Row, unknown>[] = [
      { id: "amount", header: "Amount", accessorKey: "amount", type: "select", options: { choices: [{ value: "a", label: "A" }, { value: "b", label: "B" }] } } as never,
    ];
    const onValueChange = vi.fn();
    render(
      <DataGridProvider data={[]} columns={columns} getRowId={(r) => r.id}>
        <DataGridFilterValueInput column={columns[0] as AnyColumnDef} operator="isAnyOf" value={["outside", "a"]} onValueChange={onValueChange} />
      </DataGridProvider>,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "B" }));
    expect(onValueChange).toHaveBeenCalledWith(["a", "b", "outside"]);
  });

  it("matches stored choice values case-insensitively when showing and toggling", async () => {
    const columns: readonly ColumnDef<Row, unknown>[] = [
      { id: "amount", header: "Amount", accessorKey: "amount", type: "select", options: { choices: [{ value: "Open", label: "Open" }, { value: "Closed", label: "Closed" }] } } as never,
    ];
    const onValueChange = vi.fn();
    render(
      <DataGridProvider data={[]} columns={columns} getRowId={(r) => r.id}>
        <DataGridFilterValueInput column={columns[0] as AnyColumnDef} operator="isAnyOf" value={["open", "gone"]} onValueChange={onValueChange} />
      </DataGridProvider>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect((await screen.findByRole("menuitemcheckbox", { name: "Open" })).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Open" }));
    expect(onValueChange).toHaveBeenCalledWith(["gone"]);
  });

  it("lists the distinct column values for isAnyOf on a column without choices and keeps outside values", async () => {
    const columns: readonly ColumnDef<{ id: string; city: string }, unknown>[] = [{ id: "city", header: "City", accessorKey: "city", type: "text" }];
    const data = [
      { id: "1", city: "Berlin" },
      { id: "2", city: "berlin" },
      { id: "3", city: "Bonn" },
    ];
    const onValueChange = vi.fn();
    render(
      <DataGridProvider data={data} columns={columns} getRowId={(r) => r.id}>
        <DataGridFilterValueInput column={columns[0] as AnyColumnDef} operator="isAnyOf" value={["berlin", "gone"]} onValueChange={onValueChange} />
      </DataGridProvider>,
    );
    fireEvent.click(screen.getByRole("button"));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    fireEvent.click(options[1]!);
    expect(onValueChange).toHaveBeenCalledWith(["berlin", "bonn", "gone"]);
  });
});
