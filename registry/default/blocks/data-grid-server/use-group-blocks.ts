"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { serverSpecKey, type DataChange, type RowRange } from "@/registry/default/blocks/data-grid/data-grid";
import { COLLAPSED, expandedTest, holeRowId, isDev, normalizeExpanded, type ExpandedState, type ServerGroupLayout } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { blockOf, createGroupStore, evictBlock, landGroups, landRows, layoutView, listFor, type GroupList, type GroupStore, type GroupView } from "./group-lists";
import { assertRowIdsNotReserved, readGroupsAnswer } from "./read-groups-answer";
import { readAnswer, type FetchReason, type ServerRowsRequest, type WithRowId } from "./read-answer";
import { unionIds, useRefreshGuard } from "./refresh-guard";
import { useSaveRefresh, type SaveRefreshPolicy } from "./save-refresh";
import type { UseDataGridServerRowsScrollOptions } from "./scroll-blocks";
import type { UseDataGridServerRowsScrollProviderProps, UseDataGridServerRowsScrollResult } from "./scroll-types";
import { isolate, scheduleFrame, useControlled, useMountedPlugins, useRegisteredWiring, useReshape, useRevalidation, type ServerSpecState } from "./server-state";
import type { UseDataGridServerRowsRootProps } from "./use-data-grid-server-rows";

const DEFAULT_BLOCK_SIZE = 50;
const DEFAULT_OVERSCAN = 30;
const DEFAULT_CONCURRENT = 6;
const MAX_CONCURRENT = 16;
const DEFAULT_LOAD_DELAY_MS = 100;
const DEFAULT_MAX_LOADED_ROWS = 10_000;
const NO_GROUPS: readonly string[] = [];

/** @internal The open groups of a grouped server source. */
export type UseDataGridServerRowsGroupOptions = {
  /** Controls the open groups; pair it with `onExpandedChange`. Only `mode: "collapsed"` applies: the server lists the children of an open group, so every other group stays closed. */
  expanded?: ExpandedState;
  /** Seeds the open groups once. Default: every group closed. */
  defaultExpanded?: ExpandedState;
  onExpandedChange?: (next: ExpandedState) => void;
};

type Flight = { list: GroupList<never>; block: number; controller: AbortController; ids: ReadonlySet<string> | null; mark: number };
type Failure = { listId: string; error: unknown };
function createEngine<TData>() {
  return {
    store: null as GroupStore<TData> | null,
    view: null as ViewState<TData> | null,
    flight: new Map<string, Flight>(),
    failed: new Map<string, Failure>(),
    stale: new Set<string>(),
    window: null as RowRange | null,
    reason: "load" as FetchReason,
    tick: 0,
    idIndex: null as Map<string, { list: GroupList<TData>; offset: number }> | null,
    landed: [] as { list: GroupList<TData>; start: number; end: number }[],
    cancelFrame: null as (() => void) | null,
    pumpTimer: null as ReturnType<typeof setTimeout> | null,
    warned: new Set<string>(),
  };
}
type Engine<TData> = ReturnType<typeof createEngine<TData>>;
type ViewState<TData> = GroupView<TData> & { loading: boolean };

const emptyView = <TData,>(): ViewState<TData> => ({ data: [], slots: [], owners: [], offsets: [], leafCount: 0, holes: 0, loading: false });

const positiveInteger = (value: number | undefined, fallback: number, min: number) => (typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.floor(value)) : fallback);

/** Whether the options opt in to grouping; read once per hook, so the choice holds for its life. */
export function groupsEnabled(options: { spec?: { groupBy?: unknown }; defaultSpec?: unknown; expanded?: unknown; defaultExpanded?: unknown; onExpandedChange?: unknown }): boolean {
  const seed = options.defaultSpec;
  const seeded = typeof seed === "object" && seed !== null && (seed as { groupBy?: unknown }).groupBy !== undefined;
  return options.spec?.groupBy !== undefined || seeded || options.expanded !== undefined || options.defaultExpanded !== undefined || options.onExpandedChange !== undefined;
}

/**
 * The group engine of scroll mode: one list per open group, loaded by offset in blocks. The core lays the group rows out from the
 * `groupLayout` this hook builds, and `data` holds one entry per view row. Group requests carry offsets, never a cursor.
 */
export function useGroupBlocks<TData, TCursor = never>(
  options: WithRowId<UseDataGridServerRowsScrollOptions<TData, TCursor> & UseDataGridServerRowsGroupOptions, TData>,
  specState: ServerSpecState,
  active: boolean,
) {
  const { spec, onSortChange, onFilterChange, onSearchTextChange, onGroupByChange } = specState;
  const groupBy = spec.groupBy ?? NO_GROUPS;
  const requestKey = serverSpecKey({ ...spec, aggregates: undefined });
  const aggregateKey = JSON.stringify(spec.aggregates ?? []);
  const [rawExpanded, setExpanded] = useControlled(options.expanded, () => options.defaultExpanded ?? COLLAPSED, options.onExpandedChange);
  const expanded = useMemo(() => (normalizeExpanded(rawExpanded).mode === "collapsed" ? normalizeExpanded(rawExpanded) : COLLAPSED), [rawExpanded]);
  const [view, setView] = useState<ViewState<TData>>(emptyView);
  const [error, setError] = useState<unknown>(null);
  const { plugins: guardPlugins, protectedRows, savingRows, saveMark, savedSince, pruneSaves, overlayPushed, streamUpdateRow, setSettleListener, setReshapeListener, evictionProtected } = useRefreshGuard({ trackUnacknowledged: true });

  const live = useRef({ options, spec, expanded, groupBy, active });
  useLayoutEffect(() => {
    live.current = { options, spec, expanded, groupBy, active };
  });
  const engineRef = useRef<Engine<TData> | null>(null);
  const getEngine = useCallback((): Engine<TData> => {
    if (engineRef.current === null) engineRef.current = createEngine<TData>();
    return engineRef.current;
  }, []);

  const warn = useCallback(
    (kind: string, message: string) => {
      if (!isDev() || getEngine().warned.has(kind)) return;
      getEngine().warned.add(kind);
      console.warn(`[data-grid-server] ${message}`);
    },
    [getEngine],
  );
  const blockSize = () => positiveInteger(live.current.options.blockSize, DEFAULT_BLOCK_SIZE, 1);
  const overscan = () => positiveInteger(live.current.options.overscan, DEFAULT_OVERSCAN, 0);
  const idOf = (row: TData, index: number) => live.current.options.getRowId(row, index);

  const syncError = () => setError(getEngine().failed.size > 0 ? [...getEngine().failed.values()].at(-1)!.error : null);

  const publish = () => {
    const store = getEngine().store;
    if (!store) {
      getEngine().view = null;
      setView((prev) => (prev.data.length === 0 && prev.slots.length === 0 && !prev.loading ? prev : emptyView()));
      return;
    }
    const states = new Map<string, "loading" | "failed">();
    for (const { listId } of getEngine().failed.values()) states.set(listId, "failed");
    for (const { list } of getEngine().flight.values()) if (!states.has(list.id)) states.set(list.id, "loading");
    const next = { ...layoutView(store, expandedTest(live.current.expanded), (id) => states.get(id)), loading: getEngine().flight.size > 0 } satisfies ViewState<TData>;
    getEngine().view = next;
    setView(next);
    const { onLoaded } = live.current.options;
    for (const { list, start, end } of getEngine().landed.splice(0)) {
      const first = firstViewRow(next, list, start);
      if (first !== -1 && onLoaded) isolate("onLoaded", () => onLoaded({ start: first, end: first + (end - start) }));
    }
  };
  const schedulePublish = () => {
    if (getEngine().cancelFrame !== null) return;
    getEngine().cancelFrame = scheduleFrame(() => {
      getEngine().cancelFrame = null;
      publish();
      pump();
    });
  };

  const abortAll = () => {
    for (const { controller } of getEngine().flight.values()) controller.abort();
    getEngine().flight.clear();
  };

  const fail = (key: string, list: GroupList<TData>, error: unknown) => {
    getEngine().failed.set(key, { listId: list.id, error: error ?? new Error("fetchRows rejected") });
    syncError();
    const { onError } = live.current.options;
    if (onError) isolate("onError", () => onError(error));
    schedulePublish();
  };

  const evictOverCap = (store: GroupStore<TData>) => {
    const cap = live.current.options.maxLoadedRows;
    const limit = typeof cap === "number" && !Number.isNaN(cap) ? Math.max(cap, store.blockSize) : DEFAULT_MAX_LOADED_ROWS;
    const loaded: { list: GroupList<TData>; block: number; stamp: number }[] = [];
    for (const list of store.lists.values()) if (list.kind === "rows") for (const entry of list.blocks) loaded.push({ list, block: entry[0], stamp: entry[1] });
    let rows = loaded.length * store.blockSize;
    if (rows <= limit) return;
    const protectedIds = evictionProtected();
    loaded.sort((a, b) => a.stamp - b.stamp);
    for (const { list, block, stamp } of loaded) {
      if (rows <= limit || stamp >= getEngine().tick - 1) break;
      const start = block * store.blockSize;
      const held = protectedIds && list.entries.slice(start, start + store.blockSize).some((row) => row !== undefined && protectedIds.has(idOf(row as TData, start)));
      if (held) continue;
      evictBlock(store, list, block);
      rows -= store.blockSize;
      getEngine().idIndex = null;
    }
  };

  /** Writes a validated answer into its list; returns the failure instead of throwing, so `land` keeps one try block. */
  const writeAnswer = (store: GroupStore<TData>, list: GroupList<TData>, flight: Flight, answer: unknown, range: RowRange): Error | null => {
    const stamp = ++getEngine().tick;
    if (list.kind === "groups") {
      const aggregateIds = (live.current.spec.aggregates ?? []).map((aggregate) => aggregate.columnId);
      const read = readGroupsAnswer(answer, range, { topLevel: list.id === "", aggregateIds }, warn);
      if (landGroups(store, list, flight.block, read.groups, read.groupCount, stamp) === "failed") return new TypeError("fetchRows answered groups that shifted twice since the last reload; make the group order total");
      if (list.id === "" && read.totalRowCount !== undefined) store.leafCount = read.totalRowCount;
      return null;
    }
    const read = readAnswer<TData, TCursor>(answer, range, warn, idOf);
    assertRowIdsNotReserved(read.rows.flatMap((row, index) => (row === undefined ? [] : [idOf(row, range.start + index)])));
    const guarded = unionIds(unionIds(flight.ids, savedSince(flight.mark)), protectedRows());
    const count = typeof read.totalRowCount === "number" ? read.totalRowCount : undefined;
    landRows(store, list, flight.block, overlayPushed(read.rows as TData[], flight.mark, range.start, idOf), count, stamp, (existing, offset) => guarded?.has(idOf(existing, offset)) === true);
    return null;
  };

  const land = (key: string, flight: Flight, answer: unknown, range: RowRange) => {
    const store = getEngine().store!;
    const list = flight.list as unknown as GroupList<TData>;
    getEngine().flight.delete(key);
    getEngine().stale.delete(key);
    let failure: unknown = null;
    try {
      failure = writeAnswer(store, list, flight, answer, range);
    } catch (error) {
      failure = error;
    }
    if (failure !== null) {
      fail(key, list, failure);
      return;
    }
    getEngine().failed.delete(key);
    syncError();
    getEngine().idIndex = null;
    getEngine().landed.push({ list, start: range.start, end: range.start + (range.end - range.start) });
    evictOverCap(store);
    pruneSaves([...getEngine().flight.values()].reduce<number | null>((oldest, { mark }) => (oldest === null || mark < oldest ? mark : oldest), null));
    schedulePublish();
  };

  const fetchBlock = (list: GroupList<TData>, block: number) => {
    const key = `${list.id}|${block}`;
    const size = blockSize();
    const start = block * size;
    const range = { start, end: list.count === null ? start + size : Math.min(start + size, list.count) };
    const controller = new AbortController();
    const flight: Flight = { list: list as unknown as GroupList<never>, block, controller, ids: savingRows(), mark: saveMark() };
    getEngine().flight.set(key, flight);
    const request: ServerRowsRequest<TCursor> = { spec: live.current.spec, ...range, cursor: undefined, reason: getEngine().reason, signal: controller.signal, groupPath: list.path, childKind: list.kind };
    const settled = () => getEngine().flight.get(key)?.controller === controller && !controller.signal.aborted;
    new Promise<unknown>((resolve) => resolve(live.current.options.fetchRows(request))).then(
      (answer) => settled() && land(key, flight, answer, range),
      (error: unknown) => {
        if (!settled()) return;
        getEngine().flight.delete(key);
        fail(key, list, error);
      },
    );
  };

  /** Blocks under the rendered rows plus overscan, nearest to the middle first. */
  const wantedBlocks = (store: GroupStore<TData>) => {
    const found = new Map<string, { list: GroupList<TData>; block: number; distance: number }>();
    const top = listFor(store, [], null);
    found.set(`|0`, { list: top, block: 0, distance: -1 });
    const { window: range, view: laid } = getEngine();
    if (!range || !laid) return found;
    const middle = (range.start + range.end) / 2;
    const from = Math.max(0, range.start - overscan());
    const to = Math.min(laid.data.length, range.end + overscan());
    for (let row = from; row < to; row++) {
      const list = laid.owners[row]!;
      const block = blockOf(laid.offsets[row]!, store.blockSize);
      const key = `${list.id}|${block}`;
      if (!found.has(key)) found.set(key, { list, block, distance: Math.abs(row - middle) });
    }
    return found;
  };

  const pump = () => {
    if (!live.current.active) return;
    const store = getEngine().store ?? createGroupStore<TData>(live.current.groupBy, blockSize());
    getEngine().store = store;
    const wanted = wantedBlocks(store);
    for (const [key, flight] of getEngine().flight) {
      if (wanted.has(key)) continue;
      flight.controller.abort();
      getEngine().flight.delete(key);
    }
    const limit = Math.min(positiveInteger(live.current.options.maxConcurrentFetches, DEFAULT_CONCURRENT, 1), MAX_CONCURRENT);
    const due = [...wanted]
      .filter(([key, { list, block }]) => !getEngine().flight.has(key) && !getEngine().failed.has(key) && (!list.blocks.has(block) || getEngine().stale.has(key)))
      .sort((a, b) => a[1].distance - b[1].distance);
    for (const entry of wanted.values()) if (entry.list.blocks.has(entry.block)) entry.list.blocks.set(entry.block, ++getEngine().tick);
    let started = false;
    for (const [, entry] of due) {
      if (getEngine().flight.size >= limit) break;
      fetchBlock(entry.list, entry.block);
      started = true;
    }
    if (started) schedulePublish();
  };

  const pumpSoon = (immediate: boolean) => {
    const delay = positiveInteger(live.current.options.loadDelayMs, DEFAULT_LOAD_DELAY_MS, 0);
    const engine = getEngine();
    if (engine.pumpTimer !== null) clearTimeout(engine.pumpTimer);
    engine.pumpTimer = null;
    if (immediate || delay === 0) pump();
    else engine.pumpTimer = setTimeout(() => ((engine.pumpTimer = null), pump()), delay);
  };

  const reset = () => {
    const engine = getEngine();
    abortAll();
    if (engine.pumpTimer !== null) clearTimeout(engine.pumpTimer);
    engine.pumpTimer = null;
    engine.cancelFrame?.();
    engine.cancelFrame = null;
    engine.store = null;
    engine.view = null;
    engine.idIndex = null;
    engine.failed.clear();
    engine.stale.clear();
    engine.landed = [];
    engine.reason = "load";
    pruneSaves(null);
    setError(null);
  };

  const staleGroupBlocks = () => {
    const engine = getEngine();
    if (!engine.store) return;
    for (const list of engine.store.lists.values()) if (list.kind === "groups") for (const block of list.blocks.keys()) engine.stale.add(`${list.id}|${block}`);
    pump();
  };

  const loading = view.loading;
  const apiRef = useRef({ pump: noop, pumpSoon: noopFlag, publish: noop, reset: noop, refreshFor: noopReason, staleGroupBlocks: noop, retry: noop, applyUpdates: noopChange, evictRange: noopRange });
  const { request: requestReshape, cancel: cancelReshape } = useReshape({ delay: active ? options.reshapeDelayMs : false, ordered: spec.sorts.length + spec.filters.length > 0, run: () => apiRef.current.refreshFor("refresh"), busy: loading, resetKey: requestKey, warn });
  const restartClock = useRevalidation({ interval: active ? options.revalidateIntervalMs : undefined, onTick: () => apiRef.current.refreshFor("refresh"), busy: loading, resetKey: requestKey });

  const refreshFor = (reason: FetchReason) => {
    const engine = getEngine();
    cancelReshape();
    restartClock();
    engine.reason = reason;
    abortAll();
    engine.failed.clear();
    engine.stale.clear();
    syncError();
    const store = engine.store;
    if (store) {
      const keep = wantedBlocks(store);
      for (const list of store.lists.values()) {
        list.conflicts = 0;
        for (const block of Array.from(list.blocks.keys())) {
          const key = `${list.id}|${block}`;
          if (list.kind === "groups" || keep.has(key)) engine.stale.add(key);
          else evictBlock(store, list, block);
        }
      }
      engine.idIndex = null;
    }
    pump();
    schedulePublish();
  };

  const retryFailed = () => {
    const engine = getEngine();
    engine.failed.clear();
    syncError();
    engine.reason = "retry";
    pump();
    schedulePublish();
  };

  const evictRange = (range: RowRange) => {
    const engine = getEngine();
    const store = engine.store;
    const laid = engine.view;
    if (!store || !laid) return;
    for (let row = Math.max(0, range.start); row < Math.min(range.end, laid.data.length); row++) {
      const list = laid.owners[row]!;
      if (list.kind === "rows") evictBlock(store, list, blockOf(laid.offsets[row]!, store.blockSize));
    }
    engine.idIndex = null;
    publish();
  };

  const applyUpdates = (change: DataChange<TData>) => {
    const engine = getEngine();
    const store = engine.store;
    if (!store) return;
    const index = engine.idIndex ?? indexRows(store, idOf);
    engine.idIndex = index;
    const rowOf = streamUpdateRow(change);
    let written = false;
    for (const op of change.ops) {
      if (op.type !== "update") {
        warn("rows-ignored", "an insert, delete, or move reached a grouped source and was ignored; the server places rows while the grid is grouped");
        continue;
      }
      const at = index.get(op.rowId);
      if (!at) continue;
      at.list.entries[at.offset] = rowOf ? rowOf(op, at.list.entries[at.offset] as TData) : op.row;
      written = true;
    }
    if (written) publish();
    if (change.source === "stream" && change.ops.some((op) => op.type !== "update")) requestReshape("soon");
  };

  useLayoutEffect(() => {
    apiRef.current = { pump, pumpSoon, publish, reset, refreshFor, staleGroupBlocks, retry: retryFailed, applyUpdates: applyUpdates as (change: DataChange<never>) => void, evictRange };
  });

  const onRenderedRowsChange = useCallback(
    (range: RowRange) => {
      getEngine().window = range;
      apiRef.current.pumpSoon(false);
      isolate("onRenderedRowsChange", () => live.current.options.onRenderedRowsChange?.(range));
    },
    [getEngine],
  );

  // A new request key drops every list and fetches the top level again; `expanded` stays, because group ids come from the keys.
  useLayoutEffect(() => {
    apiRef.current.reset();
    apiRef.current.publish();
    if (!active) return;
    const timer = setTimeout(() => apiRef.current.pump(), 0);
    return () => {
      clearTimeout(timer);
      apiRef.current.reset();
    };
  }, [requestKey, active]);

  // Aggregates change the group rows only: reload their blocks in place and keep the lists and the scroll position.
  const firstAggregates = useRef(aggregateKey);
  useEffect(() => {
    if (firstAggregates.current === aggregateKey) return;
    firstAggregates.current = aggregateKey;
    apiRef.current.staleGroupBlocks();
  }, [aggregateKey]);

  // A toggle lays the view out again and asks for the rows the open group shows.
  useLayoutEffect(() => {
    if (!getEngine().store) return;
    apiRef.current.publish();
    apiRef.current.pumpSoon(true);
  }, [expanded, getEngine]);

  const refresh = useCallback(() => apiRef.current.refreshFor("refresh"), []);
  const retry = useCallback(() => apiRef.current.retry(), []);
  const reshape = useCallback(() => requestReshape("soon"), [requestReshape]);
  useEffect(() => {
    setReshapeListener(requestReshape);
    return () => setReshapeListener(null);
  }, [setReshapeListener, requestReshape]);
  useEffect(() => {
    setSettleListener(() => {
      if (live.current.options.refreshAfterSave !== false) apiRef.current.refreshFor("save");
    });
    return () => setSettleListener(null);
  }, [setSettleListener]);

  const handledChanges = useRef(new WeakSet<object>());
  const onDataChange = useCallback(
    (next: readonly TData[], change: DataChange<TData>) => {
      if (handledChanges.current.has(change)) return;
      handledChanges.current.add(change);
      apiRef.current.applyUpdates(change as DataChange<never>);
      const onChange = live.current.options.onDataChange;
      if (onChange) isolate("onDataChange", () => onChange(next, change));
    },
    [],
  );

  const refreshAfterSave = useCallback(() => apiRef.current.refreshFor("save"), []);
  const { onSave, wrapSave } = useSaveRefresh({ onSave: options.onSave, refreshAfterSave: options.refreshAfterSave as SaveRefreshPolicy | undefined }, refreshAfterSave);
  const plugins = useMountedPlugins(guardPlugins, options.plugins);
  const getRowId = useCallback((row: TData, index: number) => (row === undefined ? holeRowId(index) : live.current.options.getRowId(row, index)), []);
  const groupLayout = useMemo<ServerGroupLayout>(() => ({ rows: view.slots, leafCount: view.leafCount }), [view]);

  const providerProps = useMemo<UseDataGridServerRowsScrollProviderProps<TData>>(
    () => ({
      data: view.data as TData[],
      getRowId,
      onDataChange,
      ...(onSave ? { onSave } : {}),
      onRenderedRowsChange,
      sortMode: "server",
      filterMode: "server",
      sortState: spec.sorts as UseDataGridServerRowsScrollProviderProps<TData>["sortState"],
      onSortChange,
      filterState: spec.filters as UseDataGridServerRowsScrollProviderProps<TData>["filterState"],
      onFilterChange,
      searchText: spec.searchText,
      onSearchTextChange,
      totalRowCount: view.data.length,
      checkedRowsLifetime: "across-filters",
      headerClickBehavior: "sort",
      plugins,
      groupBy,
      onGroupByChange,
      expanded,
      onExpandedChange: setExpanded,
      groupMode: "server",
      groupLayout,
    }),
    [view, getRowId, onDataChange, onSave, onRenderedRowsChange, spec, onSortChange, onFilterChange, onSearchTextChange, plugins, groupBy, onGroupByChange, expanded, setExpanded, groupLayout],
  );
  useRegisteredWiring(providerProps, wrapSave);
  const rootProps = useMemo<UseDataGridServerRowsRootProps>(() => ({ loading, error, onRetry: retry }), [loading, error, retry]);
  const gridProps = useMemo(() => ({ ...providerProps, ...rootProps }), [providerProps, rootProps]);

  const getLoadedRanges = useCallback((): readonly RowRange[] => {
    const ranges: RowRange[] = [];
    const data = getEngine().view?.data ?? [];
    const slots = new Set(getEngine().view?.slots.map((slot) => slot.viewRow));
    data.forEach((row, index) => {
      if (row === undefined && !slots.has(index)) return;
      const last = ranges.at(-1);
      if (last && last.end === index) last.end = index + 1;
      else ranges.push({ start: index, end: index + 1 });
    });
    return ranges;
  }, [getEngine]);
  const evict = useCallback((range: RowRange) => apiRef.current.evictRange(range), []);

  const status = error !== null ? "error" : loading ? "loading" : "ready";
  const result: UseDataGridServerRowsScrollResult<TData> = { gridProps, providerProps, rootProps, spec, totalRowCount: view.leafCount, status, loading, error, retry, refresh, reshape, canRevalidate: () => true, unloadedCount: view.holes, getLoadedRanges, evict };
  const groupProps = useMemo(() => ({ groupBy, onGroupByChange, expanded, onExpandedChange: setExpanded }), [groupBy, onGroupByChange, expanded, setExpanded]);
  return { result, groupProps };
}

function noop() {}
const noopFlag = (_immediate: boolean) => {};
const noopReason = (_reason: FetchReason) => {};
const noopChange = (_change: DataChange<never>) => {};
const noopRange = (_range: RowRange) => {};

function firstViewRow<TData>(view: GroupView<TData>, list: GroupList<TData>, offset: number): number {
  for (let row = 0; row < view.owners.length; row++) if (view.owners[row] === list && view.offsets[row] === offset) return row;
  return -1;
}

function indexRows<TData>(store: GroupStore<TData>, idOf: (row: TData, index: number) => string) {
  const index = new Map<string, { list: GroupList<TData>; offset: number }>();
  for (const list of store.lists.values()) {
    if (list.kind !== "rows") continue;
    list.entries.forEach((row, offset) => {
      if (row !== undefined) index.set(idOf(row as TData, offset), { list, offset });
    });
  }
  return index;
}
