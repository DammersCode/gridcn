import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "../types";
import { DataGridProvider, DataGridRoot, useDataGridActions } from "../data-grid";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];

/** Writes in a passive effect of the commit — the provider's config phase (layout timing) has already run. */
function WriteAfterConfigPhase({ on }: { on: boolean }) {
  const actions = useDataGridActions();
  useEffect(() => {
    if (on) actions.commitCellValue({ rowId: "a", columnId: "name" }, "Changed");
  }, [actions, on]);
  return null;
}

describe("readOnly config sync", () => {
  it("blocks a write made in the passive effect of the commit that turns readOnly on", () => {
    const onDataChange = vi.fn();
    const grid = (readOnly: boolean) => (
      <DataGridProvider
        defaultData={[{ id: "a", name: "Alpha" }]}
        columns={columns}
        getRowId={(row) => row.id}
        onDataChange={onDataChange}
        readOnly={readOnly}
      >
        <DataGridRoot />
        <WriteAfterConfigPhase on={readOnly} />
      </DataGridProvider>
    );
    const view = render(grid(false));

    act(() => view.rerender(grid(true)));

    expect(onDataChange).not.toHaveBeenCalled();
  });
});
