import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { DataGridProvider, DataGridRoot, defineColumns, type DataGridApi } from "./data-grid";

afterEach(cleanup);

type Row = { id: string; name: string };
const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 120 }] as const);
const rows: Row[] = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];

function mount(props: Record<string, unknown> = {}) {
  const ref = createRef<DataGridApi<Row>>();
  const onDataChange = vi.fn();
  render(
    <DataGridProvider ref={ref} data={rows} columns={columns} getRowId={(row) => row.id} onDataChange={onDataChange} {...props}>
      <DataGridRoot />
    </DataGridProvider>,
  );
  return { api: () => ref.current!, onDataChange };
}

describe("api.runShortcut", () => {
  it("runs a command, honoring its when", () => {
    const run = vi.fn();
    const when = vi.fn(() => false);
    const m = mount({ commands: { undo: { run, when } } });
    act(() => m.api().runShortcut("undo"));
    expect(run).not.toHaveBeenCalled();
    when.mockReturnValue(true);
    act(() => m.api().runShortcut("undo"));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("skips an editing-scoped command outside an edit session", () => {
    const run = vi.fn();
    const m = mount({ commands: { undo: { run, scope: "editing" } } });
    act(() => m.api().runShortcut("undo"));
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the built-in with the key target rule, even when no key is bound", () => {
    const m = mount({ keymap: { deleteRows: [] } });
    act(() => m.api().actions.selectCellAt({ col: 0, row: 1 }));
    act(() => m.api().runShortcut("deleteRows"));
    expect(m.onDataChange).toHaveBeenCalledTimes(1);
    expect(m.onDataChange.mock.calls[0]![0].map((r: Row) => r.id)).toEqual(["a", "c"]);
  });

  it("reports a refused delete in all matching mode (server rows) and changes nothing", () => {
    const onRowActionSkipped = vi.fn();
    const m = mount({ totalRowCount: 9, checkedRowsLifetime: "across-filters", onRowActionSkipped });
    act(() => m.api().actions.selectAllMatching());
    act(() => m.api().runShortcut("deleteRows"));
    expect(m.onDataChange).not.toHaveBeenCalled();
    expect(onRowActionSkipped).toHaveBeenCalledWith({ action: "deleteRows", reason: "all-matching" });
  });

  it("reports a readOnly refusal of delete and duplicate through onRowActionSkipped", () => {
    const onRowActionSkipped = vi.fn();
    const m = mount({ readOnly: true, onRowActionSkipped, duplicateRow: (row: Row) => ({ ...row, id: `${row.id}2` }) });
    act(() => m.api().actions.selectCellAt({ col: 0, row: 0 }));
    act(() => m.api().runShortcut("deleteRows"));
    act(() => m.api().runShortcut("duplicateRow"));
    expect(m.onDataChange).not.toHaveBeenCalled();
    expect(onRowActionSkipped).toHaveBeenCalledWith({ action: "deleteRows", reason: "readOnly" });
    expect(onRowActionSkipped).toHaveBeenCalledWith({ action: "duplicateRows", reason: "readOnly" });
  });

  it("reports a duplicate without a duplicateRow factory", () => {
    const onRowActionSkipped = vi.fn();
    const m = mount({ onRowActionSkipped });
    act(() => m.api().actions.selectCellAt({ col: 0, row: 0 }));
    act(() => m.api().runShortcut("duplicateRow"));
    expect(onRowActionSkipped).toHaveBeenCalledWith({ action: "duplicateRows", reason: "no-factory" });
  });

  it("reports a row move shortcut without a reorder rowMarkers mode as disabled", () => {
    const onRowActionSkipped = vi.fn();
    const m = mount({ onRowActionSkipped });
    act(() => m.api().actions.selectCellAt({ col: 0, row: 1 }));
    act(() => m.api().runShortcut("moveRowsUp"));
    expect(onRowActionSkipped).toHaveBeenCalledWith({ action: "moveRows", reason: "disabled" });
    expect(m.onDataChange).not.toHaveBeenCalled();
  });
});
