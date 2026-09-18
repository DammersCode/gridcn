"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useStore } from "zustand";
import {
  getCellValue,
  useDataGridStoreApi,
  type AnyColumnDef,
  type DataGridStoreState,
} from "@/registry/default/blocks/data-grid/data-grid";

/** Built-in reducers; a function receives every resolved value plus its source rows (empty values included — unlike the built-ins, a custom reducer owns its own empty handling). */
export type AggregateReducer = "sum" | "avg" | "min" | "max" | "count" | ((values: readonly unknown[], rows: readonly unknown[]) => unknown);

/** One reducer per column id to aggregate. */
export type AggregateSpecs = Record<string, AggregateReducer>;

/** Options for {@link useDataGridAggregate}. */
export type UseDataGridAggregateOptions = {
  /** `"view"` (default) reduces over the sorted/filtered `viewIndex` — the rows actually visible. `"all"` reduces over the full `data` array, ignoring any active filter. */
  scope?: "view" | "all";
};

const NUMERIC_REDUCERS = new Set(["sum", "avg", "min", "max"]);

function reduceNumeric(reducer: "sum" | "avg" | "min" | "max", values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  switch (reducer) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "min":
      return values.reduce((a, b) => Math.min(a, b));
    case "max":
      return values.reduce((a, b) => Math.max(a, b));
  }
}

function aggregateColumn(reducer: AggregateReducer, column: AnyColumnDef, rows: readonly unknown[]): unknown {
  const values = rows.map((row) => getCellValue(row, column));
  if (typeof reducer === "function") return reducer(values, rows);

  const nonEmpty = values.filter((v) => v !== null && v !== undefined);
  if (reducer === "count") return nonEmpty.length;
  if (NUMERIC_REDUCERS.has(reducer)) return reduceNumeric(reducer, nonEmpty as number[]);
  return undefined;
}

function computeAggregate(state: DataGridStoreState, specs: AggregateSpecs, scope: "view" | "all"): Record<string, unknown> {
  const byId = new Map(state.columns.map((c) => [c.id, c] as const));
  const rows = scope === "all" ? state.data : state.viewIndex.map((i) => state.data[i]);
  const result: Record<string, unknown> = {};
  for (const [columnId, reducer] of Object.entries(specs)) {
    const column = byId.get(columnId);
    if (!column) continue;
    result[columnId] = aggregateColumn(reducer, column, rows);
  }
  return result;
}

/**
 * Filter-aware aggregation for pinned totals/summary rows (workplan #91): reduces `specs` over the
 * grid's own state and returns a plain `{ [columnId]: value }` object — the same shape
 * `useDataGridPinnedRows`'s `topRows`/`bottomRows` expect, since pinned cells resolve values through
 * each column's `accessorKey`/`accessorFn` exactly like data rows. Values are resolved through
 * `getCellValue`, so `accessorFn` columns aggregate correctly, not just plain fields. Defaults to
 * reducing over `viewIndex` (sorted/filtered display order) — pass `scope: "all"` to reduce
 * over the raw `data` instead, ignoring the active filter. Recomputes only when `viewIndex`, `data`,
 * `scope`, or the `specs` object's own identity changes, so scrolling (no store write touches any of
 * those) never recomputes — same identity-guardrailed contract as `rowBands`/`overlayPlugins`; define
 * `specs` at module scope or memoize it, same discipline as any other grid callback prop.
 */
export function useDataGridAggregate(specs: AggregateSpecs, options: UseDataGridAggregateOptions = {}): Record<string, unknown> {
  const { scope = "view" } = options;
  const storeApi = useDataGridStoreApi();
  const cache = useRef<{ viewIndex: number[]; data: readonly unknown[]; scope: string; specs: AggregateSpecs; result: Record<string, unknown> } | null>(null);

  return useStore(storeApi, (state) => {
    const c = cache.current;
    if (c && c.viewIndex === state.viewIndex && c.data === state.data && c.scope === scope && c.specs === specs) {
      return c.result;
    }
    const result = computeAggregate(state, specs, scope);
    cache.current = { viewIndex: state.viewIndex, data: state.data, scope, specs, result };
    return result;
  });
}

/** Props for {@link DataGridAggregateReporter}. */
export type DataGridAggregateReporterProps = {
  specs: AggregateSpecs;
  options?: UseDataGridAggregateOptions;
  /** Called with the aggregated row whenever it changes — feed it into a `useState` that becomes a pinned band's `topRows`/`bottomRows` entry. */
  onChange: (row: Record<string, unknown>) => void;
};

/**
 * Bridges {@link useDataGridAggregate} out of the store. `rowBands` is a `DataGridProvider` prop —
 * evaluated in the PARENT before the store exists — so a component that needs the live, filter-aware
 * aggregate to feed back into it must sit INSIDE the provider and report out. Render this as a plain
 * child anywhere under `<DataGridProvider>` (e.g. next to `<DataGridRoot>`) and hold its `onChange`
 * result in the parent's own state; that state is what you pass into `useDataGridPinnedRows`'s
 * `topRows`/`bottomRows`. A layout effect (not a passive one) reports the result before the browser paints,
 * so the parent's second render lands in the same frame as the first — no flash of an empty band.
 * Renders nothing.
 */
export function DataGridAggregateReporter(props: DataGridAggregateReporterProps): ReactNode {
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
