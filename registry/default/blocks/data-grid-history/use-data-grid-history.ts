"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useDataGridApi, type DataChange, type DataGridApi, type DataGridPlugin } from "@/registry/default/blocks/data-grid/data-grid";
import { isDev, createHistory, buildRollback, useDataGridAnnounce } from "@/registry/default/blocks/data-grid/data-grid-sdk";

type RecordSources<TData> =
  | readonly DataChange<TData>["source"][]
  | ((defaults: readonly DataChange<TData>["source"][]) => readonly DataChange<TData>["source"][]);

/** Options for {@link useDataGridHistory}. */
export type UseDataGridHistoryOptions<TData> = {
  /** Maximum number of entries kept on the undo stack (default `100`); oldest entries are dropped past this. A change between renders starts an empty history. */
  capacity?: number;
  /**
   * Identity of the dataset; a change between renders clears both stacks, so undo after a dataset
   * swap cannot reinsert rows from the old dataset. Omit it and reset with `clear()` instead.
   */
  datasetKey?: string | number;
  /**
   * Which `DataChange.source` values go on the undo stack. Defaults to
   * `["edit", "paste", "fill", "delete", "row-operation", "import", "replace", "app"]`: `"stream"` stays
   * out because a 100-updates/s `updateCells` feed would otherwise evict the user's whole undo
   * stack within seconds. Pass a list to replace the set, or a function of the defaults to edit it, for
   * example `(defaults) => [...defaults, "stream"]` to record streams too. `"history"`, `"rollback"`,
   * `"merge"`, and `"id-swap"` are never recorded, whatever the list says — that is what keeps an undo
   * from pushing a second entry.
   */
  recordSources?: RecordSources<TData>;
  /**
   * Called when `undo` or `redo` finds a row its change needs missing from `data`, and applies nothing.
   * `"rows-not-loaded"`: `data` has holes (lazy rows); the entry stays, so the same call works after the rows load.
   * `"rows-gone"`: `data` is dense and lacks the rows; the entry is dropped. The live region announces both.
   * A throw is logged and does not stop the grid.
   */
  onSkip?: (ctx: HistorySkip) => void;
};

/** What {@link UseDataGridHistoryOptions.onSkip} receives. */
export type HistorySkip = {
  direction: "undo" | "redo";
  reason: "rows-not-loaded" | "rows-gone";
  /** Ids of the rows the change needs and `data` lacks. */
  rowIds: readonly string[];
};

/**
 * The ids `change` needs that `data` lacks (an insert needs none), and whether `data` has holes.
 * `Array.prototype.some` skips holes, so the scan tests indices.
 */
function findMissingRows<TData>(
  change: DataChange<TData>,
  data: readonly unknown[],
  getRowId: (row: never, index: number) => string,
): { missing: string[]; hasHoles: boolean } {
  const needed = new Set<string>();
  for (const op of change.ops) if (op.type !== "insert") needed.add(op.rowId);
  let hasHoles = false;
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!(i in data) || row === undefined) hasHoles = true;
    else if (needed.size > 0) needed.delete(getRowId(row as never, i));
  }
  return { missing: [...needed], hasHoles };
}

/** Sources `useDataGridHistory` records when `recordSources` is omitted — everything a user did on purpose (`"history"` is skipped before the filter runs). */
const DEFAULT_RECORD_SOURCES: readonly DataChange<unknown>["source"][] = [
  "edit",
  "paste",
  "fill",
  "delete",
  "row-operation",
  "import",
  "replace",
  "app",
];

/** Return value of {@link useDataGridHistory}. */
export type UseDataGridHistoryResult<TData> = {
  /** One entry of the grid's `plugins` prop — the plugin's `onDataChange` observer records the grid's data changes, its `undo`/`redo` commands back the mod+Z/mod+Shift+Z bindings, and its `Mount` hands the grid's api handle to the imperative triggers below. Stable for the hook's lifetime. An inline `plugins={[plugin]}` is fine: re-resolution is gated on entry identity (name + member references), not on the array's. */
  plugin: DataGridPlugin<TData>;
  /** Imperative undo (a toolbar button outside the keyboard bindings); no-op when nothing to undo, the grid is not mounted yet, or the grid is read-only. Applies nothing and calls `onSkip` when a needed row is missing. */
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
   * user already undid is dropped without a write. A whole-row update reverts only while the row is shallow-equal to the change's row. No-op when the grid is not mounted yet or is read-only.
   */
  rollback: (change: DataChange<TData>) => void;
  /**
   * Applies a programmatic change (the consumer-built operation batch) to the grid as one write AND
   * registers it as one undo entry — `commitChange` with `source: "app"`, which the observer
   * records like any user gesture. Returns `false` when nothing is written (the grid is not mounted yet, is `readOnly`, or every operation was an insert of a row `data` already holds), `true` otherwise.
   * `label` is an optional human-readable entry label.
   */
  record: (change: DataChange<TData>, label?: string) => boolean;
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
  const onSkipRef = useRef(opts.onSkip);
  onSkipRef.current = opts.onSkip;
  const warnedSparseData = useRef(false);
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
    () =>
      new Set<DataChange<TData>["source"]>(
        typeof recordSources === "function" ? recordSources(DEFAULT_RECORD_SOURCES) : (recordSources ?? DEFAULT_RECORD_SOURCES),
      ),
    [recordSources],
  );
  const recordedRef = useRef(recorded);
  recordedRef.current = recorded;

  // The grid's imperative handle, stashed by the plugin's Mount (and refreshed by every
  // command/observer ctx): the imperative `undo`/`redo`/`record` triggers below run through it.
  const apiRef = useRef<DataGridApi<TData> | null>(null);
  const announceRef = useRef<ReturnType<typeof useDataGridAnnounce> | null>(null);

  const applyHistoryChange = useCallback(
    (direction: HistorySkip["direction"]) => {
      const api = apiRef.current;
      if (!api) return;
      const state = api.store.getState();
      // A read-only grid refuses the revert, so popping the entry would only lose it.
      if (state.readOnly) return;
      const change = direction === "undo" ? history.undo() : history.redo();
      if (!change) return;
      const { missing, hasHoles } = findMissingRows(change, state.data, state.getRowId);
      if (!warnedSparseData.current && hasHoles && isDev()) {
        warnedSparseData.current = true;
        console.warn(
          "[data-grid-history] undo ran over a sparse (lazy) data array: unloaded rows are holes, so an undo that needs them is blocked and keeps its entry. Use a hole-tolerant getRowId and pass a datasetKey (or call clear()) when server.refresh() replaces the rows or the dataset changes.",
        );
      }
      if (missing.length === 0) {
        api.actions.commitChange(change);
        forceUpdate((n) => n + 1);
        return;
      }
      if (hasHoles) history.restore(change);
      else history.discard(change);
      forceUpdate((n) => n + 1);
      announceRef.current?.("historyBlocked", missing.length, hasHoles);
      try {
        onSkipRef.current?.({ direction, reason: hasHoles ? "rows-not-loaded" : "rows-gone", rowIds: missing });
      } catch (error) {
        console.error("[data-grid-history] onSkip threw:", error);
      }
    },
    [history],
  );

  const undo = useCallback(() => applyHistoryChange("undo"), [applyHistoryChange]);
  const redo = useCallback(() => applyHistoryChange("redo"), [applyHistoryChange]);

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
      if (!api || api.store.getState().readOnly) return false;
      const fresh = withoutPresentInserts(api.store.getState(), change);
      if (fresh.ops.length === 0) return false;
      // `source: "app"` tags the imperative entry (see DataChange.source); the observer records it
      api.actions.commitChange({ ...fresh, source: "app", ...(label !== undefined ? { label } : {}) });
      forceUpdate((n) => n + 1);
      return true;
    },
    [history],
  );

  // The Mount must keep ONE identity for the hook's lifetime (a fresh component type per render
  // would remount it); the api stash touches no hook state, so a once-created closure is safe.
  const mountRef = useRef<ComponentType | null>(null);
  if (mountRef.current === null) {
    const ref = apiRef;
    const announce = announceRef;
    mountRef.current = function HistoryApiStash(): ReactNode {
      ref.current = useDataGridApi<TData>();
      announce.current = useDataGridAnnounce();
      return null;
    };
  }

  const plugin = useMemo<DataGridPlugin<TData>>(
    () => ({
      name: "history",
      onDataChange: (next, change, ctx) => {
        if (change.source === "rollback" || change.source === "merge") {
          const { reverts, serverRowIds } = change;
          const revertedEntry =
            reverts !== undefined && (change.source === "rollback" ? history.restore(reverts) || history.discard(reverts) : history.discard(reverts));
          const prunedEntries = serverRowIds !== undefined && history.dropRows(serverRowIds);
          if (revertedEntry || prunedEntries) forceUpdate((n) => n + 1);
          return;
        }
        if (change.source === "id-swap") {
          const swapped = new Map<unknown, number>();
          for (const op of change.ops) if (op.type === "update") swapped.set(op.row, -1);
          next.forEach((row, index) => {
            if (swapped.get(row) === -1) swapped.set(row, index);
          });
          const getRowId = ctx.api.store.getState().getRowId;
          const swaps = change.ops.flatMap((op) =>
            op.type === "update" ? [{ oldId: op.rowId, newId: getRowId(op.row, Math.max(0, swapped.get(op.row) ?? 0)), oldRow: op.prev, newRow: op.row }] : [],
          );
          if (history.replaceRowIds(swaps)) forceUpdate((n) => n + 1);
          return;
        }
        if (change.source === "history") return;
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

/** Drops an insert whose row id `data` already holds (the caller applied it first), so `record` never writes a row twice; warns once in development. */
function withoutPresentInserts<TData>(state: { data: readonly unknown[]; getRowId: (row: unknown, index: number) => string }, change: DataChange<TData>): DataChange<TData> {
  if (!change.ops.some((op) => op.type === "insert")) return change;
  const present = new Set(state.data.map((row, index) => (row === undefined ? "" : state.getRowId(row, index))));
  const ops = change.ops.filter((op) => op.type !== "insert" || !present.has(op.rowId));
  if (ops.length === change.ops.length) return change;
  if (isDev()) console.warn("[data-grid-history] record() skipped an insert of a row that data already holds. record() writes the change itself, so the call is safe, but you do not need to apply it to your own array first.");
  return { ...change, ops };
}
