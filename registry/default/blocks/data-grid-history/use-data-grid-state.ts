"use client";

import { useCallback, useMemo, useState } from "react";
import { type DataChange, type DataGridPlugin } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridHistory } from "./use-data-grid-history";

/** Options for {@link useDataGridState}. */
export type UseDataGridStateOptions<TData> = {
  /** Row identity; defaults to the row's `id` field, like `DataGrid`'s `getRowId`. */
  getRowId?: (row: TData, index: number) => string;
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
  getRowId?: (row: TData, index: number) => string;
  /** Writes the grid's next array back into the hook-owned state — the controlled-data echo the undo/redo flow relies on. */
  onDataChange: (next: readonly TData[], change: DataChange<TData>) => void;
  /** The grid's `plugins` prop: the history plugin (observer + `undo`/`redo` commands + api stash). Combine with other plugins explicitly after the spread, e.g. `plugins={[fillPlugin, ...grid.plugins]}`. */
  plugins: readonly DataGridPlugin<TData>[];
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
     * Applies a programmatic change (the consumer-built operation batch) to the grid AND registers it as
     * one undo entry — one `commitChange` write, recorded by the history plugin's observer.
     */
    record: (change: DataChange<TData>, label?: string) => void;
    /** Reverts a change whose save failed; see `useDataGridHistory`'s `rollback`. */
    rollback: (change: DataChange<TData>) => void;
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
  opts: UseDataGridStateOptions<TData> = {},
): UseDataGridStateResult<TData> {
  const { getRowId, capacity, datasetKey } = opts;
  const [data, setData] = useState<readonly TData[]>(defaultRows);
  const history = useDataGridHistory<TData>({ capacity, datasetKey });
  // stable identity: useDataGridRowIdToViewRow keys its O(n) Map build on getRowId identity.
  const wrappedGetRowId = useCallback((row: TData, index: number) => getRowId!(row, index), [getRowId]);
  const gridGetRowId = getRowId ? wrappedGetRowId : undefined;

  const onDataChange = useCallback((next: readonly TData[]) => {
    setData(next);
  }, []);

  const historyPlugin = history.plugin;
  // a fresh `[historyPlugin]` per render is entry-equal (no re-resolution), but the config phase
  // keys its sync on array identity — a stable reference skips the store set entirely
  const plugins = useMemo(() => [historyPlugin], [historyPlugin]);

  return {
    data,
    getRowId: gridGetRowId,
    onDataChange,
    plugins,
    history: {
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      historySize: history.historySize,
      undo: history.undo,
      redo: history.redo,
      clear: history.clear,
      record: history.record,
      rollback: history.rollback,
    },
  };
}
