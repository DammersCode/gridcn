import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    expect(onValueChange).toHaveBeenCalledWith(["Berlin", "Bonn", "gone"]);
  });

  it("lists the provider values for isAnyOf, keeps selected values the list does not show, and skips the local pass", async () => {
    const columns: readonly ColumnDef<{ id: string; city: string }, unknown>[] = [{ id: "city", header: "City", accessorKey: "city" }];
    const fetchFilterValues = vi.fn(async () => ({ values: [{ label: "Paris", count: 4 }, { label: "Rome" }] }));
    const onValueChange = vi.fn();
    render(
      <DataGridProvider data={[{ id: "1", city: "Local" }]} columns={columns} getRowId={(r) => r.id} fetchFilterValues={fetchFilterValues}>
        <DataGridFilterValueInput column={columns[0] as AnyColumnDef} operator="isAnyOf" value={["paris", "gone"]} onValueChange={onValueChange} />
      </DataGridProvider>,
    );
    fireEvent.click(screen.getByRole("button"));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    expect(options).toHaveLength(2);
    expect(fetchFilterValues).toHaveBeenCalledWith(expect.objectContaining({ columnId: "city", search: "" }));
    fireEvent.click(options[1]!);
    expect(onValueChange).toHaveBeenCalledWith(["Paris", "Rome", "gone"]);
  });
});

describe("DataGridFilterValueInput commits", () => {
  function renderBetween(onValueChange = vi.fn(), inputDebounceMs?: number) {
    const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "amount", header: "Amount", accessorKey: "amount", type: "number" }];
    const view = render(
      <DataGridProvider data={[]} columns={columns} getRowId={(r) => r.id} inputDebounceMs={inputDebounceMs}>
        <DataGridFilterValueInput column={columns[0] as AnyColumnDef} operator="isBetween" value={undefined} onValueChange={onValueChange} />
      </DataGridProvider>,
    );
    return { view, onValueChange, inputs: () => screen.getAllByRole("spinbutton") as HTMLInputElement[] };
  }

  it("two quick edits in the from and to inputs keep both values", () => {
    vi.useFakeTimers();
    const { inputs, onValueChange } = renderBetween();
    fireEvent.change(inputs()[0]!, { target: { value: "10" } });
    fireEvent.change(inputs()[1]!, { target: { value: "20" } });
    act(() => void vi.advanceTimersByTime(200));
    expect(onValueChange.mock.calls.at(-1)![0]).toEqual(["10", "20"]);
    vi.useRealTimers();
  });

  it("blur commits the pending value, and the provider's inputDebounceMs 0 commits each keystroke", () => {
    const { inputs, onValueChange } = renderBetween(vi.fn(), 0);
    fireEvent.change(inputs()[0]!, { target: { value: "5" } });
    expect(onValueChange).toHaveBeenCalledWith(["5", ""]);
  });

  it("moving from the from input to the to input inside the wait keeps both values", () => {
    vi.useFakeTimers();
    const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "amount", header: "Amount", accessorKey: "amount", type: "number" }];
    const seen: Array<[string, string]> = [];
    function Controlled() {
      const [value, setValue] = useState<[string, string]>(["", ""]);
      return (
        <DataGridFilterValueInput
          column={columns[0] as AnyColumnDef}
          operator="isBetween"
          value={value}
          onValueChange={(next) => {
            seen.push(next as [string, string]);
            setValue(next as [string, string]);
          }}
        />
      );
    }
    render(
      <DataGridProvider data={[]} columns={columns} getRowId={(r) => r.id}>
        <Controlled />
      </DataGridProvider>,
    );
    const [from, to] = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    fireEvent.change(from!, { target: { value: "3" } });
    fireEvent.blur(from!);
    fireEvent.change(to!, { target: { value: "9" } });
    fireEvent.blur(to!);
    expect(seen.at(-1)).toEqual(["3", "9"]);
    vi.useRealTimers();
  });

  it("unmounting inside the wait commits the last keystrokes", () => {
    vi.useFakeTimers();
    const { view, inputs, onValueChange } = renderBetween();
    fireEvent.change(inputs()[0]!, { target: { value: "7" } });
    view.unmount();
    expect(onValueChange).toHaveBeenCalledWith(["7", ""]);
    vi.useRealTimers();
  });
});
