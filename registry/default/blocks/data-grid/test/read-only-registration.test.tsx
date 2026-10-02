import { act, render } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "../types";
import { DataGridProvider, DataGridRoot, useDataGridActions } from "../data-grid";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];

/** Writes as soon as the readOnly render commits, before any passive effect runs. */
function WriteOnCommit({ readOnly }: { readOnly: boolean }) {
  const actions = useDataGridActions();
  useLayoutEffect(() => {
    if (readOnly) actions.commitCellValue({ rowId: "a", columnId: "name" }, "Changed");
  }, [actions, readOnly]);
  return null;
}

describe("readOnly registration", () => {
  it("blocks a write made in the same commit that turns readOnly on", () => {
    const onDataChange = vi.fn();
    const grid = (readOnly: boolean) => (
      <DataGridProvider defaultData={[{ id: "a", name: "Alpha" }]} columns={columns} getRowId={(row) => row.id} onDataChange={onDataChange}>
        <DataGridRoot readOnly={readOnly} />
        <WriteOnCommit readOnly={readOnly} />
      </DataGridProvider>
    );
    const view = render(grid(false));

    act(() => view.rerender(grid(true)));

    expect(onDataChange).not.toHaveBeenCalled();
  });
});
