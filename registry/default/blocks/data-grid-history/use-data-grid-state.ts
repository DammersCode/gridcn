"use client";

import { useCallback, useState } from "react";
import { type DataChange, type DataGridPlugin } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridHistory, type RecordedChange, type UseDataGridHistoryOptions } from "./use-data-grid-history";

/** Options for {@link useDataGridState}: every `useDataGridHistory` option, plus `getRowId` and `plugins`. */
export type UseDataGridStateOptions<TData> = UseDataGridHistoryOptions<TData> & {
  /** Row identity; defaults to the row's `id` field, like `DataGrid`'s `getRowId`. */
  getRowId?: (row: TData, index: number) => string;
  /** Other plugins of the grid. The returned `plugins` holds them, then the history plugin, so the spread stays complete. An inline array is fine: equal entries keep the identity. An inline plugin object is a new plugin on every render, so define it at module scope or memoize it. */
  plugins?: readonly DataGridPlugin<TData>[];
};

/** Return value of {@link useDataGridState}, spreadable straight onto `<DataGrid {...grid} />`. */
export type UseDataGridStateResult<TData> = {
  data: readonly TData[];
  getRowId?: (row: TData, index: number) => string;
  /** Writes the grid's next array back into the hook-owned state — the controlled-data echo the undo/redo flow relies on. */
  onDataChange: (next: readonly TData[], change: DataChange<TData>) => void;
  /** The grid's `plugins` prop: the `plugins` option, then the history plugin (observer + `undo`/`redo` commands + api stash). */
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
     * Returns the same result as `useDataGridHistory`'s `record`.
     */
    record: (change: RecordedChange<TData>, label?: string) => boolean;
    /** Reverts a change whose save failed; see `useDataGridHistory`'s `rollback`. */
    rollback: (change: DataChange<TData>) => void;
  };
};

const NO_PLUGINS: readonly never[] = [];

const entryIds = new WeakMap<object, number>();
let nextEntryId = 0;

function entryIdOf(entry: object): number {
  let id = entryIds.get(entry);
  if (id === undefined) entryIds.set(entry, (id = nextEntryId++));
  return id;
}

class EntriesHolder<T> {
  private key: string | null = null;
  private entries: readonly T[] = [];

  /** The entries held for `key`: the last entries with an equal key, so a new array of equal entries keeps the identity. */
  hold(key: string, entries: readonly T[]): readonly T[] {
    if (key !== this.key) [this.key, this.entries] = [key, entries];
    return this.entries;
  }
}

// Keyed by entry identity and held outside state, so a new inline entry on every render gives a new array instead of a render loop.
function useStableEntries<T extends object>(entries: readonly T[]): readonly T[] {
  const [holder] = useState(() => new EntriesHolder<T>());
  return holder.hold(entries.map(entryIdOf).join(","), entries);
}

/**
 * Quick-start grid state with undo/redo: wires `useState` + {@link useDataGridHistory}
 * into one spreadable object.
 *
 * The hook owns the array between renders and spreads it into the grid as a controlled `data` prop.
 * Do not pass `defaultData` or your own `data` alongside the spread. `useDataGridHistory` alone
 * also gives undo/redo to a grid that owns `defaultData`. `defaultRows` seeds the state once; later
 * changes to it are ignored.
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
  const { getRowId, plugins: extraPlugins = NO_PLUGINS, ...historyOptions } = opts;
  const [data, setData] = useState<readonly TData[]>(defaultRows);
  const history = useDataGridHistory<TData>(historyOptions);
  // stable identity: useDataGridRowIdToViewRow keys its O(n) Map build on getRowId identity.
  const wrappedGetRowId = useCallback((row: TData, index: number) => getRowId!(row, index), [getRowId]);
  const gridGetRowId = getRowId ? wrappedGetRowId : undefined;

  const onDataChange = useCallback((next: readonly TData[]) => {
    setData(next);
  }, []);

  const historyPlugin = history.plugin;
  // the config phase keys its sync on array identity, so equal entries keep the last array
  const plugins = useStableEntries([...extraPlugins, historyPlugin]);

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
