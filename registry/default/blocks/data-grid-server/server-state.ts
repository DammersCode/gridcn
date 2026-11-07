"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FilterNode, ServerSpec, SortSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { isDev } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { MIN_RESHAPE_DELAY, readReshapeDelay, readRevalidateInterval } from "./fetch-hygiene";

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
  /** Fetches what is in view again and keeps it on screen until the answer lands. */
  refresh: () => void;
  /** Asks the server to place the rows again after a push: one `refresh()` on the next frame, or after `reshapeDelay`. Calls in one frame join. */
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

type RevalidationInput = {
  /** The `revalidateInterval` option as the consumer passed it. */
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
  const { interval, invalid } = readRevalidateInterval(raw);
  const live = useRef({ interval, onTick, busy, canTick });
  useLayoutEffect(() => {
    live.current = { interval, onTick, busy, canTick };
  });
  const clock = useRef<{ timer: ReturnType<typeof setTimeout> | null; deadline: number; waiting: boolean; warned: boolean }>({ timer: null, deadline: 0, waiting: false, warned: false });

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
      console.warn("[data-grid-server] revalidateInterval must be a number of milliseconds above 0, so revalidation is off");
    }
  }, [invalid]);

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
  /** The `reshapeDelay` option as the consumer passed it. */
  delay: unknown;
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
 * Schedules the refresh that places pushed rows again. With `reshapeDelay` the first trigger starts a timer and later triggers
 * join it, so a steady feed reshapes at most once per delay; without it only `"soon"` and `"urgent"` triggers run, on the next
 * frame. A reshape that falls due during a request or while the page is hidden waits and runs once.
 */
export function useReshape({ delay: raw, run, busy, canRun, resetKey, warn }: ReshapeInput) {
  const { delay, invalid, raised } = readReshapeDelay(raw);
  const live = useRef({ delay, run, busy, canRun, warn });
  useLayoutEffect(() => {
    live.current = { delay, run, busy, canRun, warn };
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
      const ms = live.current.delay;
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
    if (invalid) live.current.warn("reshapeDelay", "reshapeDelay must be a number of milliseconds above 0, so the reshape delay is off");
    else if (raised) live.current.warn("reshapeDelay", `reshapeDelay below ${MIN_RESHAPE_DELAY} ms is raised to ${MIN_RESHAPE_DELAY} ms`);
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
