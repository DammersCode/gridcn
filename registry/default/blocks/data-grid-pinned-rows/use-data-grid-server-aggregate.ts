"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { serverSpecKey, type ServerSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { isDev, useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** Longest text a server value keeps; longer strings are cut. */
export const MAX_SERVER_AGGREGATE_TEXT = 1000;

/** What `fetchAggregates` receives. */
export type FetchAggregatesRequest = {
  /** The sort, filters, and quick-search text the grid holds now. */
  spec: ServerSpec;
  /** The column ids whose values the band shows. */
  columnIds: readonly string[];
  /** Aborted when a newer request replaces this one, and on unmount. */
  signal: AbortSignal;
};

/** `"loading"`: no values yet. `"stale"`: old values stay while a newer request runs. `"error"`: the last request failed; old values stay. */
export type ServerAggregateStatus = "loading" | "stale" | "ready" | "error";

/** Options for {@link useDataGridServerAggregate}. */
export type UseDataGridServerAggregateOptions = {
  /** Resolves `{ [columnId]: value }` for the whole result of `spec`, not for the rows the grid holds. */
  fetchAggregates: (request: FetchAggregatesRequest) => Promise<Record<string, unknown>>;
  /** Columns to ask for. Default: every column. */
  columnIds?: readonly string[];
  /** Wait this long after a filter change before the request starts. Default `150`. */
  debounceMs?: number;
  /** Called once per failed request. */
  onError?: (error: unknown) => void;
};

/** Return value of {@link useDataGridServerAggregate}. */
export type ServerAggregateResult = {
  /** Sanitized values, ready for a pinned band's `topRows` or `bottomRows`. Identity changes only when a request lands. */
  row: Record<string, unknown>;
  status: ServerAggregateStatus;
  error: unknown;
  /** Requests the values again and keeps the old ones on screen until the answer lands. */
  refresh: () => void;
  /** Requests again after a failure; does nothing without an error. */
  retry: () => void;
};

const EMPTY_ROW: Record<string, unknown> = {};

function filtersKey(spec: ServerSpec): string {
  return serverSpecKey({ sorts: [], filters: spec.filters, searchText: "" });
}

function notifyError(onError: ((error: unknown) => void) | undefined, error: unknown): void {
  try {
    onError?.(error);
  } catch {
    // a throwing consumer callback must not break the grid
  }
}

let warnedDroppedValue = false;

function sanitizeAnswer(answer: unknown, columnIds: readonly string[]): Record<string, unknown> {
  if (typeof answer !== "object" || answer === null || Array.isArray(answer)) {
    throw new TypeError("fetchAggregates must resolve an object of { [columnId]: value }");
  }
  const row: Record<string, unknown> = {};
  for (const id of columnIds) {
    if (!Object.prototype.hasOwnProperty.call(answer, id)) continue;
    const value = (answer as Record<string, unknown>)[id];
    if (typeof value === "string") row[id] = value.length > MAX_SERVER_AGGREGATE_TEXT ? value.slice(0, MAX_SERVER_AGGREGATE_TEXT) : value;
    else if (typeof value === "number" && Number.isFinite(value)) row[id] = value;
    else if (typeof value === "boolean" || value === null) row[id] = value;
    else if (isDev() && !warnedDroppedValue) {
      warnedDroppedValue = true;
      console.warn(`[data-grid-pinned-rows] useDataGridServerAggregate dropped the value of column "${id}": only text, finite numbers, booleans, and null are shown.`);
    }
  }
  return row;
}

/**
 * Pinned-row values from a server. Calls `fetchAggregates` with the current spec on mount and again
 * after each filter change (sorts and quick search never change the aggregated rows), aborts the
 * request a newer one replaces, and drops its late answer. Pagination, scroll, and own-API grids
 * use it alike, because the request carries the spec and not the rows the grid holds. Answer
 * values are untrusted: unknown column ids are ignored, text is cut at {@link MAX_SERVER_AGGREGATE_TEXT},
 * and anything but text, finite numbers, booleans, and null is dropped.
 * Must run inside the grid provider; see {@link DataGridServerAggregateReporter}.
 */
export function useDataGridServerAggregate(options: UseDataGridServerAggregateOptions): ServerAggregateResult {
  const { debounceMs = 150 } = options;
  const storeApi = useDataGridStoreApi();
  const filters = useStore(storeApi, (s) => s.filterState);
  const sorts = useStore(storeApi, (s) => s.sortState);
  const searchText = useStore(storeApi, (s) => s.searchText);
  const columns = useStore(storeApi, (s) => s.columns);

  const spec = useMemo<ServerSpec>(() => ({ sorts, filters, searchText }), [sorts, filters, searchText]);
  const key = filtersKey(spec);
  const columnIds = useMemo(() => options.columnIds ?? columns.map((c) => c.id), [options.columnIds, columns]);
  const columnKey = columnIds.join("\u0000");

  const latest = useRef({ options, spec, columnIds });
  useLayoutEffect(() => {
    latest.current = { options, spec, columnIds };
  });

  const [state, setState] = useState<{ row: Record<string, unknown>; status: ServerAggregateStatus; error: unknown }>({
    row: EMPTY_ROW,
    status: "loading",
    error: null,
  });
  const hasValues = useRef(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => (prev.status === (hasValues.current ? "stale" : "loading") ? prev : { ...prev, status: hasValues.current ? "stale" : "loading", error: null }));
    const start = () => {
      const { options: o, spec: s, columnIds: ids } = latest.current;
      void new Promise<unknown>((resolve) => resolve(o.fetchAggregates({ spec: s, columnIds: ids, signal: controller.signal })))
        .then((answer) => {
          if (controller.signal.aborted) return;
          hasValues.current = true;
          setState({ row: sanitizeAnswer(answer, ids), status: "ready", error: null });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setState((prev) => ({ ...prev, status: "error", error }));
          notifyError(latest.current.options.onError, error);
        });
    };
    if (debounceMs <= 0) {
      start();
      return () => controller.abort();
    }
    const timer = setTimeout(start, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, columnKey, tick, debounceMs]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const errored = state.status === "error";
  const retry = useCallback(() => {
    if (errored) setTick((t) => t + 1);
  }, [errored]);

  return useMemo(() => ({ ...state, refresh, retry }), [state, refresh, retry]);
}

/** Props for {@link DataGridServerAggregateReporter}. */
export type DataGridServerAggregateReporterProps = UseDataGridServerAggregateOptions & {
  /** Called when the row, status, or error changes; hold the result in the parent's state and pass its `row` to a pinned band. */
  onChange: (result: ServerAggregateResult) => void;
};

/**
 * Bridges {@link useDataGridServerAggregate} out of the grid provider, like
 * `DataGridAggregateReporter`: render it as a child of the grid and keep the reported result in the
 * parent's state. Renders nothing.
 */
export function DataGridServerAggregateReporter(props: DataGridServerAggregateReporterProps): ReactNode {
  const { onChange, ...options } = props;
  const result = useDataGridServerAggregate(options);
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });
  useLayoutEffect(() => {
    onChangeRef.current(result);
  }, [result]);
  return null;
}
