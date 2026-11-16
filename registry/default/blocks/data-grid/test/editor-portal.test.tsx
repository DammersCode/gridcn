import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, it } from "vitest";
import { DataGrid, cellTypes, type CellEditorProps, type CellType, type DataGridApi } from "../data-grid";

afterEach(cleanup);

type Row = { id: string; name: string };

function PortalEditor(props: CellEditorProps<unknown, string, unknown>) {
  return (
    <>
      <input aria-label="draft" defaultValue={props.value} />
      {createPortal(<button type="button">Pick</button>, document.body)}
    </>
  );
}

const pickerType: CellType<unknown, string, unknown> = { ...(cellTypes.text as CellType<unknown, string, unknown>), Editor: PortalEditor };

describe("a portaled editor without the editor marker", () => {
  it("keeps the edit open when the user presses inside the portal", () => {
    const ref = createRef<DataGridApi<Row>>();
    render(
      <DataGrid
        ref={ref}
        data={[{ id: "a", name: "Ann" }]}
        columns={[{ id: "name", header: "Name", accessorKey: "name", type: "picker" as never }]}
        cellTypes={{ picker: pickerType }}
        getRowId={(row) => row.id}
        aria-label="Grid"
        className="h-96"
      />,
    );
    act(() => ref.current!.actions.startEditing({ rowId: "a", columnId: "name" }));
    expect(ref.current!.store.getState().editing).not.toBeNull();
    act(() => {
      fireEvent.pointerDown(screen.getByRole("button", { name: "Pick" }), { button: 0, pointerId: 1, pointerType: "mouse" });
    });
    expect(ref.current!.store.getState().editing).not.toBeNull();
  });
});
