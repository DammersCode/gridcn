"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDataGridLabels, type AnyColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridSelector, useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { MAX_SET_FILTER_ENTRIES } from "./apply-set-filter";
import { isOwnSetFilter } from "./distinct-values";
import type { SetFilterOption } from "./set-filter-list";

const MAX_LABEL_LENGTH = 1000;

export type ServerFilterOption = SetFilterOption & { text: string };

export type ServerFilterValues = {
  /** `"loading"` keeps the previous `options` while a new search runs; `"error"` keeps them too. */
  status: "loading" | "ready" | "error";
  options: readonly ServerFilterOption[];
  /** Key to text of every value an answer showed since the first request: a search narrows `options`, not this. */
  known: ReadonlyMap<string, string>;
  capped: boolean;
};

/** Adds `options` to `known` and drops the first-seen entries beyond `MAX_SET_FILTER_ENTRIES`, never one of `options` or `pinned`. */
export function mergeKnownValues(
  known: ReadonlyMap<string, string>,
  options: readonly ServerFilterOption[],
  pinned: ReadonlyMap<string, unknown> = new Map(),
): Map<string, string> {
  const merged = new Map(known);
  for (const option of options) merged.set(option.key, option.text);
  const current = new Set(options.map((option) => option.key));
  for (const key of merged.keys()) {
    if (merged.size <= MAX_SET_FILTER_ENTRIES) break;
    if (!current.has(key) && !pinned.has(key)) merged.delete(key);
  }
  return merged;
}

/** Reads an untrusted provider response: string labels only, one entry per lowercase key, at most {@link MAX_SET_FILTER_ENTRIES}. `null` when the shape is wrong. */
export function sanitizeServerValues(response: unknown): { options: ServerFilterOption[]; capped: boolean } | null {
  const values = (response as { values?: unknown } | null)?.values;
  if (!Array.isArray(values)) return null;
  const byKey = new Map<string, ServerFilterOption>();
  let capped = false;
  for (const entry of values) {
    const label = (entry as { label?: unknown } | null)?.label;
    if (typeof label !== "string") continue;
    const text = label.slice(0, MAX_LABEL_LENGTH);
    const key = text.toLowerCase();
    if (byKey.has(key)) continue;
    if (byKey.size >= MAX_SET_FILTER_ENTRIES) {
      capped = true;
      break;
    }
    const count = (entry as { count?: unknown }).count;
    byKey.set(key, { key, label: text, text, count: typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : undefined });
  }
  return { options: [...byKey.values()], capped };
}

const hasChoices = (column: AnyColumnDef): boolean => {
  const choices = (column.options as { choices?: unknown } | undefined)?.choices;
  return Array.isArray(choices) && choices.length > 0;
};

/** Whether the set-value lists of `column` come from `fetchFilterValues`; a column with declared choices never does. */
export function useServerFilterValuesEnabled(column: AnyColumnDef): boolean {
  return useDataGridSelector((s) => s.fetchFilterValues !== undefined) && !hasChoices(column);
}

/**
 * The server set values of `column` for `search`, or `null` when the provider is absent or the column has
 * `choices`. A new `search`, a column switch, and unmount abort the request in flight; a stale result is dropped.
 */
export function useServerFilterValues(column: AnyColumnDef, search: string, pinned?: ReadonlyMap<string, unknown>): ServerFilterValues | null {
  const enabled = useServerFilterValuesEnabled(column);
  const storeApi = useDataGridStoreApi();
  const blanks = useDataGridLabels().toolbar.headerFilterBlanks;
  const [result, setResult] = useState<ServerFilterValues>({ status: "loading", options: [], known: new Map(), capped: false });
  const columnId = column.id;
  const pinnedRef = useRef(pinned);
  useLayoutEffect(() => {
    pinnedRef.current = pinned;
  });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setResult((previous) => ({ ...previous, status: "loading" }));
    void (async () => {
      try {
        const state = storeApi.getState();
        const fetchValues = state.fetchFilterValues;
        if (!fetchValues) return;
        const filters = state.filterState.filter((node) => !isOwnSetFilter(node, columnId));
        const response = await fetchValues({ columnId, query: search, filters, signal: controller.signal });
        if (controller.signal.aborted) return;
        const clean = sanitizeServerValues(response);
        if (!clean) {
          setResult((previous) => ({ ...previous, status: "error" }));
          return;
        }
        setResult((previous) => ({
          status: "ready",
          capped: clean.capped,
          options: clean.options,
          known: mergeKnownValues(previous.known, clean.options, pinnedRef.current),
        }));
      } catch {
        if (!controller.signal.aborted) setResult((previous) => ({ ...previous, status: "error" }));
      }
    })();
    return () => controller.abort();
  }, [enabled, storeApi, columnId, search]);

  const options = useMemo(
    () => result.options.map((option) => (option.key === "" ? { ...option, label: blanks } : option)),
    [result.options, blanks],
  );
  return enabled ? { ...result, options } : null;
}
