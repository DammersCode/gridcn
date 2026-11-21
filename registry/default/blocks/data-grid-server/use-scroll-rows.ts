"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WithRowId } from "./read-answer";
import { useScrollBlocks, type UseDataGridServerRowsScrollOptions } from "./scroll-blocks";
import type { UseDataGridServerRowsScrollResult } from "./scroll-types";
import { handOffResult, useServerSpec } from "./server-state";
import { groupsEnabled, useGroupBlocks, type UseDataGridServerRowsGroupOptions } from "./use-group-blocks";

function noop() {}

const NO_GROUPS: readonly string[] = [];

type Options<TData, TCursor> = WithRowId<UseDataGridServerRowsScrollOptions<TData, TCursor> & UseDataGridServerRowsGroupOptions, TData>;

/**
 * Scroll mode: the flat block engine, plus the group engine when the options opt in to grouping. Both read one spec. While the
 * spec groups, the flat engine waits (`ready: false`) and the group engine fetches; an empty `groupBy` hands the rows back.
 * Across a hand-off the engine on screen stays, busy, until the other one has answered.
 */
export function useScrollRows<TData, TCursor = never>(options: Options<TData, TCursor>): UseDataGridServerRowsScrollResult<TData> {
  const [grouping] = useState(() => groupsEnabled(options));
  const specState = useServerSpec(options, noop, grouping);
  const grouped = grouping && (specState.spec.groupBy?.length ?? 0) > 0;
  // A save settles in the engine whose plugins wrote it; the refresh it asks for goes to the engine that answers the spec.
  const refreshFlat = useRef(noop);
  const refreshGroups = useRef(noop);
  const flatSpec = useMemo(() => (grouped ? { ...specState, ready: false, refreshElsewhere: () => refreshGroups.current() } : specState), [grouped, specState]);
  const groupSpec = useMemo(() => ({ ...specState, refreshElsewhere: () => refreshFlat.current() }), [specState]);
  const flat = useScrollBlocks(options, flatSpec);
  const groups = useGroupBlocks(options, groupSpec, grouped);
  useLayoutEffect(() => {
    refreshFlat.current = flat.refresh;
    refreshGroups.current = groups.result.refresh;
  });
  const extra = useMemo(() => (grouping ? { ...groups.groupProps, groupBy: NO_GROUPS } : undefined), [grouping, groups.groupProps]);
  const gridProps = useMemo(() => (extra ? { ...flat.gridProps, ...extra } : flat.gridProps), [flat.gridProps, extra]);
  const providerProps = useMemo(() => (extra ? { ...flat.providerProps, ...extra } : flat.providerProps), [flat.providerProps, extra]);
  const ungrouped = useMemo(() => ({ ...flat, gridProps, providerProps }), [flat, gridProps, providerProps]);
  const [shown, setShown] = useState({ grouped, flipped: false });
  const next = grouped ? groups.result : ungrouped;
  // A failed answer keeps the rows on screen next to its error bar; the switch waits for an answer that lands.
  const arrived = grouped ? groups.answered && groups.result.error === null : !flat.loading && flat.error === null;
  // The render of the flip still carries the old loading state of the flat engine, so the switch waits one render.
  useLayoutEffect(() => {
    if (shown.grouped === grouped) {
      if (shown.flipped) setShown({ grouped, flipped: false });
    } else if (!shown.flipped) setShown({ grouped: shown.grouped, flipped: true });
    else if (arrived) setShown({ grouped, flipped: false });
  });
  const previous = shown.grouped ? groups.result : ungrouped;
  const waiting = shown.grouped !== grouped;
  return useMemo(() => (waiting ? handOffResult(previous, next) : next), [waiting, previous, next]);
}
