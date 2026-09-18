"use client";

import { useCallback, useState } from "react";
import type { DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridHistory } from "./use-data-grid-history";

/** Options for {@link useDataGridState}. */
export type UseDataGridStateOptions<TData> = {
  getRowId: (row: TData, index: number) => string;
  /** Maximum number of entries kept on the undo stack; oldest entries are dropped past this. */
  capacity?: number;
};

/** Return value of {@link useDataGridState}, spreadable straight onto `<DataGrid {...grid} />`. */
export type UseDataGridStateResult<TData> = {
  data: readonly TData[];
  getRowId: (row: TData, index: number) => string;
  onDataChange: (next: readonly TData[], change: DataChange<TData>) => void;
  onUndo: () => void;
  onRedo: () => void;
  /**
   * For a toolbar's undo/redo buttons, outside the spreadable `DataGrid` props. `clear` empties
   * both stacks (e.g. after regenerating the dataset) — it lives on this sub-object, not the
   * spreadable top level, to avoid a future prop-name collision on the `<DataGrid {...grid} />`
   * spread.
   */
  history: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void; clear: () => void };
};

/**
 * Quick-start grid state with undo/redo (PLAN §2/§5): wires `useState` + {@link useDataGridHistory}
 * into one spreadable object.
 *
 * "Uncontrolled" here means the consumer does not own the array between renders — the hook does —
 * NOT the core's `defaultData` semantics. It spreads a CONTROLLED `data` prop into the grid and
 * re-feeds it every render; undo/redo work precisely because of that echo. Never treat it like
 * `defaultData` (set once, grid-owned afterwards) and pass it alongside your own data.
 *
 * ```tsx
 * const grid = useDataGridState(rows, { getRowId: (r) => r.id });
 * <DataGrid {...grid} columns={columns} />
 * ```
 */
export function useDataGridState<TData>(
  defaultRows: readonly TData[],
  opts: UseDataGridStateOptions<TData>,
): UseDataGridStateResult<TData> {
  const { getRowId, capacity } = opts;
  const [data, setData] = useState<readonly TData[]>(defaultRows);
  const { onDataChange, undo, redo, canUndo, canRedo, clear } = useDataGridHistory({
    data,
    setData,
    getRowId,
    capacity,
  });
  // stable identity: useDataGridRowIdToViewRow keys its O(n) Map build on getRowId identity.
  const gridGetRowId = useCallback((row: TData, index: number) => getRowId(row, index), [getRowId]);

  return {
    data,
    getRowId: gridGetRowId,
    onDataChange,
    onUndo: undo,
    onRedo: redo,
    history: { canUndo, canRedo, undo, redo, clear },
  };
}
