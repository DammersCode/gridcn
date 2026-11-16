import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CellEditorProps, CellType, ColumnDef } from "../types";
import { DataGrid } from "../data-grid";

type Row = { id: string; name: string };

afterEach(cleanup);

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 360 });
});

function PickEditor({ commitValue }: CellEditorProps<unknown, string>) {
  return (
    <button type="button" onClick={() => commitValue("picked", { dx: 0, dy: 0 })}>
      pick
    </button>
  );
}

const pickCellType: CellType<unknown, string> = {
  Cell: ({ value }) => <span>{value}</span>,
  Editor: PickEditor,
  toText: (value) => value ?? "",
  fromText: (text) => text,
  clearValue: () => "",
  isEmpty: (value) => !value,
};

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name", type: "pick" }];

describe("editor commitValue", () => {
  it("commits the value it receives, with no onChange first", () => {
    const onDataChange = vi.fn();
    render(<DataGrid data={[{ id: "1", name: "old" }]} columns={columns} cellTypes={{ pick: pickCellType }} onDataChange={onDataChange} />);
    fireEvent.pointerDown(screen.getAllByRole("gridcell")[0]!, { button: 0 });
    fireEvent.keyDown(screen.getByRole("grid"), { key: "F2" });
    fireEvent.click(screen.getByRole("button", { name: "pick" }));
    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect(onDataChange.mock.calls[0]![0][0].name).toBe("picked");
  });
});
