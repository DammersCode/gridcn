import type { DataGridStoreState } from "./types";

/** The consumer hooks that may answer with a promise; `import` is the import dialog's parse and build, `mapColumn` its column match, `processReplace` the find-replace panel's hook, `validate` an async column `validate` that holds a paste, fill, or clear. */
export type GateName = "processPaste" | "processCellFromClipboard" | "validateRow" | "onBeforeEditStart" | "createRow" | "duplicateRow" | "onBeforeDeleteRows" | "import" | "mapColumn" | "processReplace" | "validate" | "processFill" | "resolveTexts";

/** The last argument of an async gate: `signal` aborts when a newer run supersedes this one, the result can no longer apply, or the grid unmounts. */
export type GateContext = { signal: AbortSignal };

/** Shared identity while no gate is pending, so a selector on `gatesPending` does not churn. */
export const EMPTY_GATES_PENDING: ReadonlySet<GateName> = new Set<GateName>();

/** Returns true when the store change makes the run's result unable to apply. */
export type GateWatch = (now: DataGridStoreState, prev: DataGridStoreState) => boolean;

/**
 * One run of a gate. The `signal` getter creates its controller on first read, so a sync gate that
 * never reads it pays for no controller. The run itself is the `{ signal }` context of `validateRow`.
 */
export class GateRun {
  aborted = false;
  private controller: AbortController | null = null;

  constructor(
    readonly name: GateName,
    public watch?: GateWatch,
  ) {}

  get signal(): AbortSignal {
    if (!this.controller) {
      this.controller = new AbortController();
      if (this.aborted) this.controller.abort();
    }
    return this.controller.signal;
  }

  cancel(): void {
    this.aborted = true;
    this.controller?.abort();
  }
}

export type GateTracker = {
  /** Creates an untracked run: the gate is sync until {@link GateTracker.hold} is called. */
  begin(name: GateName, watch?: GateWatch): GateRun;
  /** Marks the run pending: it returned a promise. */
  hold(run: GateRun): void;
  /** Marks the run done; a no-op when it was aborted or already settled. */
  settle(run: GateRun): void;
  /** Aborts a run and takes it out of the pending set. */
  abortRun(run: GateRun, reason?: GateAbortReason): void;
  /** Aborts every live run, or only the runs of the named gates; `reason` defaults to `"reset"`. */
  abort(names?: readonly GateName[], reason?: GateAbortReason): void;
  /** Marks `name` pending for work the grid does not run itself (the import dialog); returns the release. */
  track(name: GateName): () => void;
};

/** Why a gate run stopped before its result applied: it ran longer than `gateTimeoutMs`, the rows, the mode, or the cell it asked about changed, a newer run replaced it, the user pressed Escape, or the grid reset or unmounted. */
export type GateAbortReason = "timeout" | "changed" | "superseded" | "cancelled" | "reset";

/** How long a pending run without a timeout waits before the host hears of it. */
export const STUCK_GATE_MS = 30_000;

export type GateTrackerHost = {
  /** Read on every hold; `undefined` or a non-positive number turns the timeout off. */
  timeoutMs?: (name: GateName) => number | undefined;
  /** Called when a run is still pending after {@link STUCK_GATE_MS} and no timeout aborts it. */
  stuck?: (name: GateName) => void;
  /** Called once per run that is aborted while pending. */
  aborted?: (name: GateName, reason: GateAbortReason) => void;
  publish: (pending: ReadonlySet<GateName>) => void;
  subscribe: (listener: (now: DataGridStoreState, prev: DataGridStoreState) => void) => () => void;
};

export function createGateTracker(host: GateTrackerHost): GateTracker {
  const live = new Set<GateRun>();
  const timers = new Map<GateRun, ReturnType<typeof setTimeout>>();
  const watchedRuns = new Set<GateRun>();
  const counts = new Map<GateName, number>();
  let unwatch: (() => void) | null = null;
  let watched = 0;

  const publish = (): void => {
    if (counts.size === 0) {
      host.publish(EMPTY_GATES_PENDING);
      return;
    }
    host.publish(new Set(counts.keys()));
  };

  const stopWatching = (): void => {
    if (watched > 0 || !unwatch) return;
    unwatch();
    unwatch = null;
  };

  const release = (run: GateRun): void => {
    if (!live.delete(run)) return;
    const timer = timers.get(run);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(run);
    }
    if (run.watch) {
      watched--;
      watchedRuns.delete(run);
    }
    const count = (counts.get(run.name) ?? 1) - 1;
    const changed = count <= 0;
    if (changed) counts.delete(run.name);
    else counts.set(run.name, count);
    stopWatching();
    if (changed) publish();
  };

  const watchStore = (): void => {
    if (unwatch) return;
    unwatch = host.subscribe((now, prev) => {
      for (const run of Array.from(watchedRuns)) {
        if (run.watch?.(now, prev)) tracker.abortRun(run, "changed");
      }
    });
  };

  const tracker: GateTracker = {
    begin: (name, watch) => new GateRun(name, watch),
    hold(run) {
      if (run.aborted || live.has(run)) return;
      live.add(run);
      const count = counts.get(run.name) ?? 0;
      counts.set(run.name, count + 1);
      if (run.watch) {
        watched++;
        watchedRuns.add(run);
        watchStore();
      }
      if (count === 0) publish();
      const timeoutMs = host.timeoutMs?.(run.name);
      if (run.name === "import") return;
      if (typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0) timers.set(run, setTimeout(() => tracker.abortRun(run, "timeout"), Math.min(timeoutMs, 2_147_483_647)));
      else if (host.stuck) timers.set(run, setTimeout(() => host.stuck?.(run.name), STUCK_GATE_MS));
    },
    settle: release,
    abortRun(run, reason = "superseded") {
      const pending = live.has(run);
      run.cancel();
      release(run);
      if (pending) host.aborted?.(run.name, reason);
    },
    abort(names, reason = "reset") {
      for (const run of Array.from(live)) if (!names || names.includes(run.name)) tracker.abortRun(run, reason);
    },
    track(name) {
      const run = new GateRun(name);
      tracker.hold(run);
      return () => release(run);
    },
  };
  return tracker;
}
