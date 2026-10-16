"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { getCellValue, invertChange, useDataGridApi, type DataChange, type DataGridApi, type DataGridPlugin } from "@/registry/default/blocks/data-grid/data-grid";
import { isDev, createHistory, setCellValue } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** Options for {@link useDataGridHistory}. */
export type UseDataGridHistoryOptions<TData> = {
  /** Maximum number of entries kept on the undo stack; oldest entries are dropped past this. */
  capacity?: number;
  /**
   * Identity of the dataset; a change between renders clears both stacks, so undo after a dataset
   * swap cannot reinsert rows from the old dataset. Omit it and reset with `clear()` instead.
   */
  datasetKey?: string | number;
  /**
   * Which `DataChange.source` values go on the undo stack. Defaults to every source except
   * `"stream"` — a 100-updates/s `updateCells` feed would otherwise evict the user's whole undo
   * stack within seconds. Pass a list to change the set, for example
   * `["edit", "paste", "fill", "delete", "row-operation", "import", "stream", "app"]` to record
   * streams too. `source: "history"` and `"rollback"` (undo, redo, and rollback applied through the grid) are never recorded,
   * whatever the list says — that is what keeps an undo from pushing a second entry.
   */
  recordSources?: readonly DataChange<TData>["source"][];
};

// Fires at most once per app, dev-only: undo ran over a sparse (lazy) data array.
let warnedSparseData = false;

// `Array.prototype.some` skips holes (the callback never runs for missing indices), so hole
// detection must test indices, not values.
function hasSparseHoles(data: readonly unknown[]): boolean {
  for (let i = 0; i < data.length; i++) if (!(i in data)) return true;
  return false;
}

/** Sources `useDataGridHistory` records when `recordSources` is omitted — everything a user did on purpose (`"history"` is skipped before the filter runs). */
const DEFAULT_RECORD_SOURCES: readonly DataChange<unknown>["source"][] = [
  "edit",
  "paste",
  "fill",
  "delete",
  "row-operation",
  "import",
  "app",
];

/**
 * Builds the inverse of `change` against the current data: a cell reverts only while it still holds
 * the change's value, so later edits to the same row (or the same cell) survive the rollback.
 */
function buildRollback<TData>(change: DataChange<TData>, s: ReturnType<DataGridApi<TData>["store"]["getState"]>): DataChange<TData> {
  const rowById = new Map<string, TData>();
  (s.data as readonly TData[]).forEach((row, i) => rowById.set(s.getRowId(row, i), row));
  const columnsById = new Map(s.columns.map((c) => [c.id, c] as const));
  const ops: DataChange<TData>["ops"] = [];
  for (const op of [...change.ops].reverse()) {
    if (op.type !== "update") {
      ops.push(...invertChange({ ops: [op], source: "rollback" }, "rollback").ops);
      continue;
    }
    const current = rowById.get(op.rowId);
    if (current === undefined) continue;
    if (!op.cells) {
      if (current === op.row) ops.push({ type: "update", rowId: op.rowId, row: op.prev, prev: op.row });
      continue;
    }
    let row: TData = current;
    const cells: NonNullable<typeof op.cells> = [];
    for (const cell of [...op.cells].reverse()) {
      const column = columnsById.get(cell.columnId);
      if (!column || !Object.is(getCellValue(row, column as never), cell.value)) continue;
      row = setCellValue<TData, never>(row, column as never, cell.prev as never);
      cells.push({ columnId: cell.columnId, value: cell.prev, prev: cell.value });
    }
    if (cells.length > 0) ops.push({ type: "update", rowId: op.rowId, row, prev: current, cells });
  }
  return { ops, source: "rollback", label: change.label };
}

/** Return value of {@link useDataGridHistory}. */
export type UseDataGridHistoryResult<TData> = {
  /** One entry of the grid's `plugins` prop — the plugin's `onDataChange` observer records the grid's data changes, its `undo`/`redo` commands back the mod+Z/mod+Shift+Z bindings, and its `Mount` hands the grid's api handle to the imperative triggers below. Stable for the hook's lifetime. An inline `plugins={[plugin]}` is fine: re-resolution is gated on entry identity (name + member references), not on the array's. */
  plugin: DataGridPlugin<TData>;
  /** Imperative undo (a toolbar button outside the keyboard bindings); no-op when nothing to undo or the grid is read-only. */
  undo: () => void;
  /** Imperative redo; see {@link UseDataGridHistoryResult.undo}. */
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Number of entries on the undo stack; 0 when there is nothing to undo. */
  historySize: number;
  /** Clears both stacks. A dataset change clears them itself when `datasetKey` changes; use `clear` for an imperative reset. */
  clear: () => void;
  /**
   * Reverts `change` (the object an `onDataChange` handler received) after its save failed: applies the
   * inverse with `source: "rollback"` and drops the entry from the stacks, so no dead undo step remains.
   * A cell reverts only while it still holds the change's value, so later edits survive. A change the
   * user already undid is dropped without a write. No-op when the grid is not mounted yet or is read-only.
   */
  rollback: (change: DataChange<TData>) => void;
  /**
   * Applies a programmatic change (the consumer-built operation batch) to the grid as one write AND
   * registers it as one undo entry — `commitChange` with `source: "app"`, which the observer
   * records like any user gesture. No-op when the grid is not mounted yet or is read-only.
   * `label` is an optional human-readable entry label.
   */
  record: (change: DataChange<TData>, label?: string) => void;
};

/**
 * Operation-based undo/redo as a grid plugin. Records the grid's own `onDataChange` stream (the observer
 * runs after the store write and after the consumer's `onDataChange`), and undoes/redoes by
 * applying the inverted operation batch back through the grid's `commitChange` — one write, one emit,
 * so a controlled `data` prop sees the same change the user made.
 *
 * Design: the plugin does not take `data`/`setData` — the grid's store is the write target, and
 * the consumer's controlled-data echo (their `onDataChange` calling their own state setter)
 * stays exactly where it always was. `undo`/`redo` applied through the grid carry
 * `source: "history"`, which the observer skips, so each undo or redo records no second entry.
 */
export function useDataGridHistory<TData>(opts: UseDataGridHistoryOptions<TData> = {}): UseDataGridHistoryResult<TData> {
  const { capacity, datasetKey, recordSources } = opts;
  const history = useMemo(() => createHistory<TData>({ capacity }), [capacity]);
  // history's canUndo/canRedo are getters on a mutable object; this forces a re-render
  // after every mutating call so callers see them update even when nothing else re-renders
  // this hook (e.g. `clear()`, or a consumer setter that dedupes identical arrays).
  const [, forceUpdate] = useState(0);

  // stale entries reference the old dataset: undo after a swap would resurrect dead rows
  const prevDatasetKey = useRef(datasetKey);
  useEffect(() => {
    if (prevDatasetKey.current === datasetKey) return;
    prevDatasetKey.current = datasetKey;
    history.clear();
    forceUpdate((n) => n + 1);
  }, [datasetKey, history]);

  const recorded = useMemo(
    () => new Set<DataChange<TData>["source"]>(recordSources ?? DEFAULT_RECORD_SOURCES),
    [recordSources],
  );
  const recordedRef = useRef(recorded);
  recordedRef.current = recorded;

  // The grid's imperative handle, stashed by the plugin's Mount (and refreshed by every
  // command/observer ctx): the imperative `undo`/`redo`/`record` triggers below run through it.
  const apiRef = useRef<DataGridApi<TData> | null>(null);

  const undo = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    // a read-only grid never applied the change it would revert (writes are gated), so popping the
    // entry would only lose it
    if (api.store.getState().readOnly) return;
    const change = history.undo();
    if (!change) return;
    // Sparse (lazy) data needs a hole-tolerant getRowId and skips evicted rows silently — flag once, not per undo.
    if (!warnedSparseData && isDev() && hasSparseHoles(api.store.getState().data)) {
      warnedSparseData = true;
      console.warn(
        "[data-grid-history] undo ran over a sparse (lazy) data array: unloaded rows are holes and their operations are skipped. Use a hole-tolerant getRowId and pass a datasetKey (or call clear()) on lazy.reset() or a dataset swap.",
      );
    }
    api.actions.commitChange(change);
    forceUpdate((n) => n + 1);
  }, [history]);

  const redo = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    if (api.store.getState().readOnly) return;
    const change = history.redo();
    if (!change) return;
    api.actions.commitChange(change);
    forceUpdate((n) => n + 1);
  }, [history]);

  const clear = useCallback(() => {
    history.clear();
    forceUpdate((n) => n + 1);
  }, [history]);

  const rolledBack = useMemo(() => new WeakSet<DataChange<TData>>(), []);

  const rollback = useCallback(
    (change: DataChange<TData>) => {
      const api = apiRef.current;
      if (!api || api.store.getState().readOnly) return;
      rolledBack.add(change);
      const undoSize = history.size;
      const found = history.discard(change);
      const alreadyUndone = found && history.size === undoSize;
      if (!alreadyUndone) api.actions.commitChange(buildRollback(change, api.store.getState()));
      forceUpdate((n) => n + 1);
    },
    [history, rolledBack],
  );

  const record = useCallback(
    (change: DataChange<TData>, label?: string) => {
      const api = apiRef.current;
      if (!api) return;
      // `source: "app"` tags the imperative entry (see DataChange.source); the observer records it
      api.actions.commitChange({ ...change, source: "app", ...(label !== undefined ? { label } : {}) });
      forceUpdate((n) => n + 1);
    },
    [history],
  );

  // The Mount must keep ONE identity for the hook's lifetime (a fresh component type per render
  // would remount it); the api stash touches no hook state, so a once-created closure is safe.
  const mountRef = useRef<ComponentType | null>(null);
  if (mountRef.current === null) {
    const ref = apiRef;
    mountRef.current = function HistoryApiStash(): ReactNode {
      ref.current = useDataGridApi<TData>();
      return null;
    };
  }

  const plugin = useMemo<DataGridPlugin<TData>>(
    () => ({
      name: "history",
      onDataChange: (_next, change) => {
        if (change.source === "history" || change.source === "rollback") return;
        if (recordedRef.current.has(change.source) && !rolledBack.has(change)) history.push(change);
        forceUpdate((n) => n + 1);
      },
      commands: {
        undo: {
          when: (ctx) => !ctx.readOnly,
          run: (ctx) => {
            apiRef.current = ctx.api;
            undo();
          },
        },
        redo: {
          when: (ctx) => !ctx.readOnly,
          run: (ctx) => {
            apiRef.current = ctx.api;
            redo();
          },
        },
      },
      Mount: mountRef.current ?? undefined,
    }),
    [history, rolledBack, undo, redo, mountRef.current],
  );

  return {
    plugin,
    undo,
    redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    historySize: history.size,
    clear,
    rollback,
    record,
  };
}
