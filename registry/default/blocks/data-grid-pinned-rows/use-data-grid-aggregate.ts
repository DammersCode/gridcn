"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useStore } from "zustand";
import { getCellValue, type AnyColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { aggregateValues, isDev, leafViewOf, useDataGridStoreApi, type AggregateReducer, type AggregateSpecs, type DataGridReadState } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { shallowEqual } from "./pinned-row-source";

export type { AggregateReducer, AggregateSpecs };

/** Options for {@link useDataGridAggregate}. */
export type UseDataGridAggregateOptions = {
  /** `"view"` (default) reduces over every row the sort and filter leave, all pages of a paged grid. `"page"` reduces over the shown page only. `"all"` reduces over the full `data` array, ignoring any active filter. */
  scope?: "view" | "page" | "all";
};

function aggregateColumn<TData>(reducer: AggregateReducer<TData>, column: AnyColumnDef, rows: readonly unknown[]): unknown {
  // Boundary cast: the store keeps rows as unknown[], the user's reducer gets them typed.
  return aggregateValues(reducer, rows.map((row) => getCellValue(row, column)), rows as readonly TData[]);
}

const warnedKinds = new WeakMap<object, Set<string>>();

/** Dev-only warning, once per grid instance and kind. */
function warnOnce(owner: object, kind: string, message: string): void {
  if (!isDev()) return;
  const kinds = warnedKinds.get(owner) ?? new Set<string>();
  warnedKinds.set(owner, kinds);
  if (kinds.has(kind)) return;
  kinds.add(kind);
  console.warn(message);
}

function warnSparseData(owner: object, scope: "view" | "page" | "all", holes: number): void {
  warnOnce(
    owner,
    "sparse",
    `[data-grid-pinned-rows] useDataGridAggregate (scope "${scope}") skipped ${holes} unloaded row(s): the data array is sparse (lazy loading), so the result covers loaded rows only. Use server-side totals or compute them outside the grid.`,
  );
}

function warnUnknownSpecKey(owner: object, columnId: string): void {
  warnOnce(
    owner,
    "spec-key",
    `[data-grid-pinned-rows] useDataGridAggregate: spec key "${columnId}" matches no column id and is ignored (check for a typo)`,
  );
}

function computeAggregate<TData>(owner: object, state: DataGridReadState, specs: AggregateSpecs<TData>, scope: "view" | "page" | "all"): Record<string, unknown> {
  const byId = new Map(state.columns.map((c) => [c.id, c] as const));
  const scoped = scope === "all" ? state.data : (scope === "page" ? state.viewIndex.filter((i) => i >= 0) : leafViewOf(state)).map((i) => state.data[i]);
  // undefined rows are unloaded holes of a lazy grid; reduce over the loaded rows only.
  const rows = scoped.filter((row) => row !== undefined);
  if (rows.length !== scoped.length) warnSparseData(owner, scope, scoped.length - rows.length);
  const result: [string, unknown][] = [];
  for (const [columnId, reducer] of Object.entries(specs)) {
    const column = byId.get(columnId);
    if (!column) {
      warnUnknownSpecKey(owner, columnId);
      continue;
    }
    result.push([columnId, aggregateColumn(reducer, column, rows)]);
  }
  return Object.fromEntries(result);
}

/**
 * Filter-aware aggregation for pinned totals/summary rows: reduces `specs` over the
 * grid's own state and returns a plain `{ [columnId]: value }` object, usable as a
 * `useDataGridPinnedRows` `topRows`/`bottomRows` entry. Pinned cells read it through each column's
 * `accessorKey`/`accessorFn` like a data row, so a total shows only where `accessorKey` equals the
 * column id; remap it for other columns. The object carries no row id, so
 * a pinned band gives it a band id when `getRowId` cannot resolve one. Values are resolved through
 * `getCellValue`, so `accessorFn` columns aggregate correctly, not just plain fields. Defaults to
 * `scope: "view"`, every row the sort and filter leave across all pages; `"page"` reduces over the
 * shown page only, and `"all"` over the raw `data`, ignoring the active filter. Recomputes only when `viewIndex`, `data`,
 * `scope`, or an entry of `specs` changes (a named reducer by name, a function by identity), so
 * scrolling never recomputes and an inline `specs` object of named reducers is fine. A reducer
 * function defined in the render recomputes on every render; define it at module scope or memoize it.
 * `undefined` rows (unloaded holes of a lazy grid) are skipped and a dev warning fires once per grid — on a
 * lazy grid the result covers loaded rows only. A spec key that matches no column id is ignored
 * and a dev warning fires once per grid. `TData` types `rows` in custom reducers (see {@link AggregateReducer}).
 */
export function useDataGridAggregate<TData = unknown>(specs: AggregateSpecs<TData>, options: UseDataGridAggregateOptions = {}): Record<string, unknown> {
  const { scope = "view" } = options;
  const storeApi = useDataGridStoreApi();
  const cache = useRef<{ viewIndex: number[]; data: readonly unknown[]; scope: string; specs: AggregateSpecs<TData>; result: Record<string, unknown> } | null>(null);

  return useStore(storeApi, (state) => {
    const c = cache.current;
    if (c && c.viewIndex === state.viewIndex && c.data === state.data && c.scope === scope && shallowEqual(c.specs, specs)) {
      return c.result;
    }
    const result = computeAggregate(storeApi, state, specs, scope);
    cache.current = { viewIndex: state.viewIndex, data: state.data, scope, specs, result };
    return result;
  });
}

/** Props for {@link DataGridAggregateReporter}. */
export type DataGridAggregateReporterProps<TData = unknown> = {
  specs: AggregateSpecs<TData>;
  options?: UseDataGridAggregateOptions;
  /** Called with the aggregated row whenever it changes — feed it into a `useState` that becomes a pinned band's `topRows`/`bottomRows` entry. */
  onChange: (row: Record<string, unknown>) => void;
};

/**
 * Bridges {@link useDataGridAggregate} out of the store. The pinned rows reach the grid as a
 * plugin's `rowBands` through the `plugins` prop — evaluated in the PARENT before the store exists — so a component that needs the live, filter-aware
 * aggregate to feed back into it must sit INSIDE the provider and report out. Render this as a plain
 * child anywhere under `<DataGridProvider>` (e.g. next to `<DataGridRoot>`) and hold its `onChange`
 * result in the parent's own state; that state is what you pass into `useDataGridPinnedRows`'s
 * `topRows`/`bottomRows`. A layout effect (not a passive one) reports the result before the browser paints,
 * so the parent's second render lands in the same frame as the first — no flash of an empty band.
 * Renders nothing.
 */
export function DataGridAggregateReporter<TData = unknown>(props: DataGridAggregateReporterProps<TData>): ReactNode {
  const { specs, options, onChange } = props;
  const row = useDataGridAggregate(specs, options);
  // Hold the latest callback in a ref and key the effect on `row` alone: an inline `onChange`
  // (fresh identity every parent render) would otherwise re-fire the effect on every render, and
  // a parent that stores the row with a spread (`{ ...prev, ...row }`) loops that forever.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useLayoutEffect(() => {
    onChangeRef.current(row);
  }, [row]);
  return null;
}
