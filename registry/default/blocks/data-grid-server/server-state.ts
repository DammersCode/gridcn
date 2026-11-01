"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { FilterNode, ServerSpec, SortSpec } from "@/registry/default/blocks/data-grid/data-grid";

const EMPTY_SPEC: ServerSpec = { sorts: [], filters: [], searchText: "" };

/** Controlled or uncontrolled state with a stable setter that always calls the latest `onChange`. */
export function useControlled<T>(controlled: T | undefined, initial: () => T, onChange: ((next: T) => void) | undefined) {
  const [inner, setInner] = useState(initial);
  const latest = useRef({ controlled, onChange });
  useLayoutEffect(() => {
    latest.current = { controlled, onChange };
  });
  const set = useCallback((next: T) => {
    if (latest.current.controlled === undefined) setInner(next);
    latest.current.onChange?.(next);
  }, []);
  return [controlled ?? inner, set] as const;
}

/** Runs a consumer callback so that a throw cannot break the caller's bookkeeping. */
export function isolate(label: string, call: () => void) {
  try {
    call();
  } catch (error) {
    console.error(`[data-grid-server] ${label} threw`, error);
  }
}

export type ServerSpecOptions = {
  spec?: ServerSpec;
  defaultSpec?: Partial<ServerSpec>;
  onSpecChange?: (spec: ServerSpec) => void;
};

/** The sort, filter, and search of a server source, with stable change handlers for the grid's controlled state. */
export function useServerSpec(source: ServerSpecOptions, afterChange: () => void) {
  const [spec, setSpec] = useControlled<ServerSpec>(
    source.spec,
    () => ({
      sorts: [...(source.defaultSpec?.sorts ?? EMPTY_SPEC.sorts)],
      filters: [...(source.defaultSpec?.filters ?? EMPTY_SPEC.filters)],
      searchText: source.defaultSpec?.searchText ?? EMPTY_SPEC.searchText,
    }),
    source.onSpecChange,
  );
  const live = useRef({ spec, afterChange });
  useLayoutEffect(() => {
    live.current = { spec, afterChange };
  });
  const changeSpec = useCallback(
    (next: Partial<ServerSpec>) => {
      const merged = { ...live.current.spec, ...next };
      // Two changes in one effect (a URL restore) merge instead of overwriting each other.
      live.current.spec = merged;
      setSpec(merged);
      live.current.afterChange();
    },
    [setSpec],
  );
  const onSortChange = useCallback((sorts: SortSpec[]) => changeSpec({ sorts }), [changeSpec]);
  const onFilterChange = useCallback((filters: FilterNode[]) => changeSpec({ filters }), [changeSpec]);
  const onSearchTextChange = useCallback((searchText: string) => changeSpec({ searchText }), [changeSpec]);
  return { spec, onSortChange, onFilterChange, onSearchTextChange };
}
