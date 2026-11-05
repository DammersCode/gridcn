import type { DataGridStoreState } from "./types";

/** The consumer hooks that may answer with a promise; `import` is the import dialog's parse and build. */
export type GateName = "processPaste" | "validateRow" | "onEditStart" | "createRow" | "duplicateRow" | "onBeforeDeleteRows" | "import";

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
  abortRun(run: GateRun): void;
  /** Aborts every live run, or only the runs of the named gates. */
  abort(names?: readonly GateName[]): void;
  /** Marks `name` pending for work the grid does not run itself (the import dialog); returns the release. */
  track(name: GateName): () => void;
};

export type GateTrackerHost = {
  publish: (pending: ReadonlySet<GateName>) => void;
  subscribe: (listener: (now: DataGridStoreState, prev: DataGridStoreState) => void) => () => void;
};

export function createGateTracker(host: GateTrackerHost): GateTracker {
  const live = new Set<GateRun>();
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
        if (run.watch?.(now, prev)) tracker.abortRun(run);
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
    },
    settle: release,
    abortRun(run) {
      run.cancel();
      release(run);
    },
    abort(names) {
      for (const run of Array.from(live)) if (!names || names.includes(run.name)) tracker.abortRun(run);
    },
    track(name) {
      const run = new GateRun(name);
      tracker.hold(run);
      return () => release(run);
    },
  };
  return tracker;
}
