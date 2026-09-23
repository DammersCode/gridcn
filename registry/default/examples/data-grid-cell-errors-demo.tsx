"use client";

import { type ReactNode } from "react";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
  useDataGridActions,
  useDataGridCellErrors,
  useDataGridStoreProps,
  type DataChange,
  type DataOp,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridState } from "@/registry/default/blocks/data-grid-history/data-grid-history";
import { Button } from "@/components/ui/button";

type Order = { id: string; item: string; quantity: number; status: string };

const columns = defineColumns<Order>()([
  { id: "item", header: "Item", accessorKey: "item", type: "text", width: 150, flex: 2 },
  { id: "quantity", header: "Quantity", accessorKey: "quantity", type: "number", width: 110, flex: 1 },
  { id: "status", header: "Status", accessorKey: "status", type: "text", width: 100, flex: 1 },
] as const);

function initialRows(): Order[] {
  return [
    { id: "row-0", item: "Widget", quantity: 12, status: "ok" },
    { id: "row-1", item: "Gadget", quantity: 40, status: "ok" },
    { id: "row-2", item: "Gizmo", quantity: 8, status: "ok" },
    { id: "row-3", item: "Doohickey", quantity: 25, status: "ok" },
    { id: "row-4", item: "Thingamajig", quantity: 60, status: "ok" },
  ];
}

const getRowId = (row: Order) => row.id;

type RejectedCell = { rowId: string; columnId: string };

function isUpdateWithCells(op: DataOp<Order>): op is Extract<DataOp<Order>, { type: "update" }> & {
  cells: NonNullable<Extract<DataOp<Order>, { type: "update" }>["cells"]>;
} {
  return op.type === "update" && Boolean(op.cells);
}

/** Fake server call: rejects any committed quantity over 100, after ~600ms. */
function saveOrders(ops: DataChange<Order>["ops"]): Promise<void> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const tooMany: RejectedCell[] = ops
        .filter(isUpdateWithCells)
        .flatMap((op) =>
          op.cells
            .filter((cell) => cell.columnId === "quantity" && typeof cell.value === "number" && cell.value > 100)
            .map((cell) => ({ rowId: op.rowId, columnId: cell.columnId })),
        );
      if (tooMany.length > 0) reject(tooMany);
      else resolve();
    }, 600);
  });
}

/** Reads the live cellErrors map from inside the provider and drives the badge + clear button. */
function CellErrorsBar(): ReactNode {
  const actions = useDataGridActions();
  const cellErrors = useDataGridCellErrors();

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-muted-foreground">
        Server errors: <span className="font-medium text-foreground">{cellErrors.size}</span>
      </span>
      <Button size="sm" variant="outline" disabled={cellErrors.size === 0} onClick={() => actions.clearCellErrors()}>
        Clear all
      </Button>
    </div>
  );
}

/**
 * Edit a Quantity cell past 100 and commit: `onDataChange` calls a fake `saveOrders` that rejects
 * after ~600ms, and the `.catch()` handler calls `actions.setCellErrors` to paint the exact cell —
 * the same ring/tint/aria-invalid a pre-commit `validate` rejection uses, but after the value already
 * committed. Editing that cell again, with any value, clears its error on the next successful commit.
 */
export default function DataGridCellErrorsDemo(): ReactNode {
  const grid = useDataGridState(initialRows(), { getRowId });
  const { store, actions } = useDataGridStoreProps({
    data: grid.data,
    getRowId: grid.getRowId,
    onUndo: grid.onUndo,
    onRedo: grid.onRedo,
    columns,
    onDataChange: handleDataChange,
  });

  function handleDataChange(next: readonly Order[], change: DataChange<Order>): void {
    grid.onDataChange(next, change);
    saveOrders(change.ops).catch((tooMany: RejectedCell[]) => {
      actions.setCellErrors(tooMany.map((cell) => ({ ...cell, message: "Quantity cannot exceed 100" })));
    });
  }

  return (
    <DataGridProvider store={store} columns={columns} getRowId={grid.getRowId}>
      <div className="w-full flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Set a Quantity above 100 and press Enter: the fake server rejects it after ~600ms and the
          cell is marked with a red ring — hover it to read the message.
        </p>
        <div className="h-[300px] overflow-hidden rounded-md border border-border">
          <DataGridRoot className="h-full rounded-none border-none">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </div>
        <CellErrorsBar />
      </div>
    </DataGridProvider>
  );
}
