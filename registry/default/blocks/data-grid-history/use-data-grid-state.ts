"use client";

import { useCallback, useState } from "react";
import { applyChange, type DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridHistory } from "./use-data-grid-history";

/** Options for {@link useDataGridState}. */
export type UseDataGridStateOptions<TData> = {
  getRowId: (row: TData, index: number) => string;
  /** Maximum number of entries kept on the undo stack; oldest entries are dropped past this. */
  capacity?: number;
  /**
   * Identity of the dataset; a change between renders clears both history stacks.
   * See `useDataGridHistory`'s `datasetKey`.
   */
  datasetKey?: string | number;
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
   * both stacks for an imperative reset — it lives on this sub-object, not the
   * spreadable top level, to avoid a future prop-name collision on the `<DataGrid {...grid} />`
   * spread.
   */
  history: {
    canUndo: boolean;
    canRedo: boolean;
    /** Number of entries on the undo stack; 0 when there is nothing to undo. */
    historySize: number;
    undo: () => void;
    redo: () => void;
    clear: () => void;
    /**
     * Applies a programmatic change (the consumer-built op batch) to the hook-owned data AND
     * registers it as one undo entry - unlike the bare `useDataGridHistory` `record`, which only
     * registers, because here the hook owns the array and the consumer has no other write path.
     */
    record: (change: DataChange<TData>, label?: string) => void;
  };
};

/**
 * Quick-start grid state with undo/redo: wires `useState` + {@link useDataGridHistory}
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
  const { getRowId, capacity, datasetKey } = opts;
  const [data, setData] = useState<readonly TData[]>(defaultRows);
  const { onDataChange, undo, redo, canUndo, canRedo, clear, historySize, record: historyRecord } = useDataGridHistory({
    data,
    setData,
    getRowId,
    capacity,
    datasetKey,
  });
  // stable identity: useDataGridRowIdToViewRow keys its O(n) Map build on getRowId identity.
  const gridGetRowId = useCallback((row: TData, index: number) => getRowId(row, index), [getRowId]);

  const record = useCallback(
    (change: DataChange<TData>, label?: string) => {
      const tagged = label ? { ...change, label } : change;
      setData((current) => applyChange(current, tagged, gridGetRowId));
      historyRecord(tagged);
    },
    [historyRecord, gridGetRowId],
  );

  return {
    data,
    getRowId: gridGetRowId,
    onDataChange,
    onUndo: undo,
    onRedo: redo,
    history: { canUndo, canRedo, historySize, undo, redo, clear, record },
  };
}
