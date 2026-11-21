"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DataGridPlugin, FilterNode, ServerSpec, SortSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { isDev, registerServerWiring } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { DEFAULT_RESHAPE_DELAY, MIN_RESHAPE_DELAY, MIN_REVALIDATE_INTERVAL, readReshapeDelay, readRevalidateInterval } from "./fetch-hygiene";

/** The request state every mode of `useDataGridServerRows` returns. */
export type DataSourceState = {
  /** `"error"` wins over `"loading"`. */
  status: "loading" | "error" | "ready";
  /** A request of the current spec is in flight. */
  loading: boolean;
  /** The latest failure of the current spec, or `null`. */
  error: unknown;
  /** Repeats the failed requests. Does nothing without an error. */
  retry: () => void;
  /** Fetches what is in view again and keeps it on screen until the answer lands. The hook calls it after saves settle by `refreshAfterSave`. */
  refresh: () => void;
  /** Asks the server to place the rows again after a push: one `refresh()` on the next frame, or after `reshapeDelayMs`. Calls in one frame join. */
  reshape: () => void;
};

/** Runs `callback` on the next animation frame, or after 16 ms where there is none. Returns the cancel. */
export function scheduleFrame(callback: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(callback, 16);
  return () => clearTimeout(id);
}

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
  return [controlled ?? inner, set, setInner] as const;
}

/** The result of the engine on screen while the other engine of a hand-off still loads. */
type EngineResult = { loading: boolean; error: unknown; status: string; rootProps: object; providerProps: object; gridProps: object; retry: () => void; refresh: () => void; reshape: () => void };

/**
 * The rows of the engine on screen, read-only, with the state and the controls of the engine the spec asks for: a refresh or a
 * retry reaches the engine that answers, and its failure shows next to the rows on screen.
 */
export function handOffResult<TResult extends EngineResult>(shown: TResult, requested: TResult): TResult {
  const failed = requested.error !== null;
  const root = { loading: !failed, error: requested.error, onRetry: requested.retry };
  return {
    ...shown,
    loading: !failed,
    error: requested.error,
    status: failed ? "error" : "loading",
    retry: requested.retry,
    refresh: requested.refresh,
    reshape: requested.reshape,
    rootProps: { ...shown.rootProps, ...root },
    providerProps: { ...shown.providerProps, readOnly: true },
    gridProps: { ...shown.gridProps, ...root, readOnly: true },
  };
}

/** Runs a consumer callback so that a throw cannot break the caller's bookkeeping. */
export function isolate(label: string, call: () => void) {
  try {
    call();
  } catch (error) {
    console.error(`[data-grid-server] ${label} threw`, error);
  }
}

/** The refresh guard first, then the consumer's plugins; the array keeps its identity while `own` does. */
export function useMountedPlugins(guard: readonly DataGridPlugin<unknown>[], own?: readonly DataGridPlugin<unknown>[]) {
  return useMemo(() => (own && own.length > 0 ? [...guard, ...own] : guard), [guard, own]);
}

export type ServerSpecOptions = {
  spec?: ServerSpec;
  defaultSpec?: Partial<ServerSpec> | (() => Partial<ServerSpec> | undefined);
  onSpecChange?: (spec: ServerSpec) => void;
};

/** The sort, filter, and search of a server source, with stable change handlers for the grid's controlled state. */
export function useServerSpec(source: ServerSpecOptions, afterChange: () => void, groups = false) {
  const lateSeed = typeof source.defaultSpec === "function" && source.spec === undefined ? source.defaultSpec : null;
  const [spec, setSpec, seedSpec] = useControlled<ServerSpec>(source.spec, () => specOf(lateSeed ? undefined : (source.defaultSpec as Partial<ServerSpec> | undefined), groups), source.onSpecChange);
  const [ready, setReady] = useState(lateSeed === null);
  const lateSeedRef = useRef(lateSeed);
  // A function seed runs after mount, on the client only, so the server render and the first client render match.
  useLayoutEffect(() => {
    const seed = lateSeedRef.current;
    if (seed) {
      let value: Partial<ServerSpec> | undefined;
      isolate("defaultSpec", () => (value = seed()));
      if (value) seedSpec(specOf(value, groups));
    }
    setReady(true);
  }, [seedSpec, groups]);
  const live = useRef({ spec, afterChange });
  useLayoutEffect(() => {
    live.current = { spec, afterChange };
  });
  const changeSpec = useCallback(
    (next: Partial<ServerSpec>) => {
      const merged = { ...live.current.spec, ...next };
      if (merged.groupBy?.length === 0) delete merged.groupBy;
      if (merged.filterJoin !== "or") delete merged.filterJoin;
      // Two changes in one effect (a URL restore) merge instead of overwriting each other.
      live.current.spec = merged;
      setSpec(merged);
      live.current.afterChange();
    },
    [setSpec],
  );
  const onSortChange = useCallback((sorts: SortSpec[]) => changeSpec({ sorts }), [changeSpec]);
  const onFilterChange = useCallback((filters: FilterNode[]) => changeSpec({ filters }), [changeSpec]);
  const onFilterJoinChange = useCallback((join: "and" | "or") => changeSpec({ filterJoin: join === "or" ? "or" : undefined }), [changeSpec]);
  const onSearchTextChange = useCallback((searchText: string) => changeSpec({ searchText }), [changeSpec]);
  const onGroupByChange = useCallback((groupBy: readonly string[]) => changeSpec({ groupBy }), [changeSpec]);
  // An ungrouped request with `pivot` is refused, so `pivot` waits in the raw spec until `groupBy` returns.
  const shown = useMemo(() => (spec.pivot && !spec.groupBy?.length ? withoutPivot(spec) : spec), [spec]);
  return { spec: shown, ready, onSortChange, onFilterChange, onFilterJoinChange, onSearchTextChange, onGroupByChange };
}

/** The result of {@link useServerSpec}: the scroll hook takes it from its caller so the group engine and the flat engine share one spec. */
export type ServerSpecState = ReturnType<typeof useServerSpec>;

const specOf = (seed?: Partial<ServerSpec>, groups = false): ServerSpec => ({
  sorts: [...(seed?.sorts ?? EMPTY_SPEC.sorts)],
  filters: [...(seed?.filters ?? EMPTY_SPEC.filters)],
  ...(seed?.filterJoin === "or" ? { filterJoin: "or" as const } : null),
  searchText: seed?.searchText ?? EMPTY_SPEC.searchText,
  ...(groups && seed?.groupBy?.length ? { groupBy: [...seed.groupBy] } : null),
  ...(groups && seed?.aggregates?.length ? { aggregates: [...seed.aggregates] } : null),
  ...(groups && seed?.pivot ? { pivot: { columnIds: [...seed.pivot.columnIds] } } : null),
});

/** `spec` without `pivot`. */
export function withoutPivot(spec: ServerSpec): ServerSpec {
  const { pivot: _pivot, ...rest } = spec;
  return rest;
}

type RevalidationInput = {
  /** The `revalidateIntervalMs` option as the consumer passed it. */
  interval: unknown;
  /** Runs the refresh when a tick is due. */
  onTick: () => void;
  /** A request is in flight: a due tick waits until this turns false and then runs once. */
  busy: boolean;
  /** `false` skips the tick and waits for the next one. */
  canTick?: () => boolean;
  /** A change restarts the clock. */
  resetKey: string;
};

/**
 * Runs `onTick` every `interval` ms while the page is visible. The clock chains `setTimeout`, so ticks never stack, and
 * `restart` (called by every refresh) pushes the next tick a full interval away. Returns `restart`.
 */
export function useRevalidation({ interval: raw, onTick, busy, canTick, resetKey }: RevalidationInput) {
  const { interval, invalid, raised } = readRevalidateInterval(raw);
  const live = useRef({ interval, onTick, busy, canTick });
  useLayoutEffect(() => {
    live.current = { interval, onTick, busy, canTick };
  });
  const clock = useRef<{ timer: ReturnType<typeof setTimeout> | null; deadline: number; waiting: boolean; warned: boolean; warnedRaised: boolean }>({ timer: null, deadline: 0, waiting: false, warned: false, warnedRaised: false });

  const fireRef = useRef<() => void>(() => {});
  const arm = useCallback(() => {
    const state = clock.current;
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = null;
    const { interval: ms } = live.current;
    if (ms === null || typeof document === "undefined" || document.visibilityState === "hidden") return;
    state.timer = setTimeout(() => {
      state.timer = null;
      fireRef.current();
    }, Math.max(0, state.deadline - Date.now()));
  }, []);

  const restart = useCallback(() => {
    clock.current.deadline = Date.now() + (live.current.interval ?? 0);
    clock.current.waiting = false;
    arm();
  }, [arm]);

  const fire = useCallback(() => {
    if (live.current.busy) {
      clock.current.waiting = true;
      return;
    }
    if (!live.current.canTick || live.current.canTick()) live.current.onTick();
    restart();
  }, [restart]);
  useLayoutEffect(() => {
    fireRef.current = fire;
  }, [fire]);

  useEffect(() => {
    if (invalid && isDev() && !clock.current.warned) {
      clock.current.warned = true;
      console.warn("[data-grid-server] revalidateIntervalMs must be a number of milliseconds above 0, so revalidation is off");
    }
  }, [invalid]);

  useEffect(() => {
    if (raised && isDev() && !clock.current.warnedRaised) {
      clock.current.warnedRaised = true;
      console.warn(`[data-grid-server] revalidateIntervalMs below ${MIN_REVALIDATE_INTERVAL} ms is raised to ${MIN_REVALIDATE_INTERVAL} ms`);
    }
  }, [raised]);

  useEffect(() => {
    if (interval === null || typeof document === "undefined") return;
    restart();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (clock.current.timer !== null) clearTimeout(clock.current.timer);
        clock.current.timer = null;
      } else if (Date.now() >= clock.current.deadline) fire();
      else arm();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (clock.current.timer !== null) clearTimeout(clock.current.timer);
      clock.current.timer = null;
    };
    // `resetKey` restarts the clock.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [interval, resetKey, restart, arm, fire]);

  useEffect(() => {
    if (!busy && clock.current.waiting) {
      clock.current.waiting = false;
      // A hidden page leaves the due tick to the visibility handler.
      if (typeof document !== "undefined" && document.visibilityState !== "hidden") fire();
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  return restart;
}

type ReshapeInput = {
  /** The `reshapeDelayMs` option as the consumer passed it. */
  delay: unknown;
  /** The spec has a sort or a filter, so a pushed row can belong elsewhere: `delay` defaults to {@link DEFAULT_RESHAPE_DELAY}. */
  ordered: boolean;
  /** Runs the refresh when a reshape is due. */
  run: () => void;
  /** A request is in flight: a due reshape waits until this turns false and then runs once. */
  busy: boolean;
  /** `false` drops a due reshape. */
  canRun?: () => boolean;
  /** A change cancels the pending reshape: the request it starts fetches the rows anyway. */
  resetKey: string;
  warn: (kind: string, message: string) => void;
};

/** `"stale"` comes from a deferred push, `"soon"` from a stream delete or `reshape()`, `"urgent"` from `reconcileView()` or an immediate push. */
export type ReshapeTrigger = "stale" | "soon" | "urgent";

/**
 * Schedules the refresh that places pushed rows again. With `reshapeDelayMs`, `"stale"` and `"soon"` triggers start or join one
 * timer, so a steady feed reshapes at most once per delay; without it `"stale"` triggers do nothing and `"soon"` runs on the next
 * frame. `"urgent"` always runs on the next frame. A reshape that falls due during a request or while the page is hidden waits and runs once.
 */
export function useReshape({ delay: raw, ordered, run, busy, canRun, resetKey, warn }: ReshapeInput) {
  const { delay, invalid, raised } = readReshapeDelay(raw);
  const staleDelay = delay ?? (raw === undefined && ordered ? DEFAULT_RESHAPE_DELAY : null);
  const live = useRef({ delay, staleDelay, run, busy, canRun, warn });
  useLayoutEffect(() => {
    live.current = { delay, staleDelay, run, busy, canRun, warn };
  });
  const pending = useRef<{ timer: ReturnType<typeof setTimeout> | null; cancelFrame: (() => void) | null; waiting: boolean }>({ timer: null, cancelFrame: null, waiting: false });

  const cancel = useCallback(() => {
    const state = pending.current;
    if (state.timer !== null) clearTimeout(state.timer);
    state.cancelFrame?.();
    state.timer = null;
    state.cancelFrame = null;
    state.waiting = false;
  }, []);

  const due = useCallback(() => {
    const state = pending.current;
    if (live.current.busy || (typeof document !== "undefined" && document.visibilityState === "hidden")) {
      state.waiting = true;
      return;
    }
    state.waiting = false;
    if (!live.current.canRun || live.current.canRun()) live.current.run();
  }, []);

  const request = useCallback(
    (trigger: ReshapeTrigger) => {
      const state = pending.current;
      const ms = trigger === "stale" ? live.current.staleDelay : live.current.delay;
      if (trigger === "stale" || (trigger === "soon" && ms !== null)) {
        if (ms === null || state.timer !== null) return;
        state.timer = setTimeout(() => {
          state.timer = null;
          due();
        }, ms);
        return;
      }
      if (state.cancelFrame !== null) return;
      state.cancelFrame = scheduleFrame(() => {
        state.cancelFrame = null;
        due();
      });
    },
    [due],
  );

  useEffect(() => {
    if (invalid) live.current.warn("reshapeDelayMs", "reshapeDelayMs must be a number of milliseconds above 0, so the reshape delay is off");
    else if (raised) live.current.warn("reshapeDelayMs", `reshapeDelayMs below ${MIN_RESHAPE_DELAY} ms is raised to ${MIN_RESHAPE_DELAY} ms`);
  }, [invalid, raised]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "hidden" && pending.current.waiting) due();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      cancel();
    };
  }, [due, cancel]);

  useEffect(() => {
    cancel();
  }, [resetKey, cancel]);

  useEffect(() => {
    if (!busy && pending.current.waiting) due();
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  return { request, cancel };
}

type WiringSave = Parameters<typeof registerServerWiring>[1]["wrapSave"];

/** Registers during render, not in `useMemo`: the React Compiler drops a memo whose result is unused. */
export function useRegisteredWiring(props: { data: readonly unknown[] }, wrapSave: unknown) {
  registerServerWiring(props.data, { props, wrapSave: wrapSave as WiringSave });
}
