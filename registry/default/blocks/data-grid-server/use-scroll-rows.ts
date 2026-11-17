"use client";

import { useMemo, useState } from "react";
import type { WithRowId } from "./read-answer";
import { useScrollBlocks, type UseDataGridServerRowsScrollOptions } from "./scroll-blocks";
import type { UseDataGridServerRowsScrollResult } from "./scroll-types";
import { useServerSpec } from "./server-state";
import { groupsEnabled, useGroupBlocks, type UseDataGridServerRowsGroupOptions } from "./use-group-blocks";

function noop() {}

type Options<TData, TCursor> = WithRowId<UseDataGridServerRowsScrollOptions<TData, TCursor> & UseDataGridServerRowsGroupOptions, TData>;

/**
 * Scroll mode: the flat block engine, plus the group engine when the options opt in to grouping. Both read one spec. While the
 * spec groups, the flat engine waits (`ready: false`) and the group engine fetches; an empty `groupBy` hands the rows back.
 */
export function useScrollRows<TData, TCursor = never>(options: Options<TData, TCursor>): UseDataGridServerRowsScrollResult<TData> {
  const [grouping] = useState(() => groupsEnabled(options));
  const specState = useServerSpec(options, noop, grouping);
  const grouped = grouping && (specState.spec.groupBy?.length ?? 0) > 0;
  const flatSpec = useMemo(() => (grouped ? { ...specState, ready: false } : specState), [grouped, specState]);
  const flat = useScrollBlocks(options, flatSpec);
  const groups = useGroupBlocks(options, specState, grouped);
  const extra = grouping ? groups.groupProps : undefined;
  const gridProps = useMemo(() => (extra ? { ...flat.gridProps, ...extra } : flat.gridProps), [flat.gridProps, extra]);
  const providerProps = useMemo(() => (extra ? { ...flat.providerProps, ...extra } : flat.providerProps), [flat.providerProps, extra]);
  const ungrouped = useMemo(() => ({ ...flat, gridProps, providerProps }), [flat, gridProps, providerProps]);
  return grouped ? groups.result : ungrouped;
}
