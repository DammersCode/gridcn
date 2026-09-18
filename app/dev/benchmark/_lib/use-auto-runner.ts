"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onRunnerMessage, postToParent, runBenchmarkScenario, type BenchmarkRunResult } from "./harness";

export type AutoRunnerRefs = {
  scrollEl: HTMLElement | null;
  clickTargetEl: HTMLElement | null;
  domScopeEl: HTMLElement | null;
  isReady: () => boolean;
};

type ResolvedAutoRunnerRefs = AutoRunnerRefs & { scrollEl: HTMLElement; clickTargetEl: HTMLElement };

const GRID_ROOT_TIMEOUT_MS = 10_000;

/** Polls `getRefs()` via rAF until its grid root resolves (dynamic-import chunk load + mount), or rejects after a timeout. */
function waitForGridRoot(getRefs: () => AutoRunnerRefs): Promise<ResolvedAutoRunnerRefs> {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    function poll() {
      const refs = getRefs();
      if (refs.scrollEl && refs.clickTargetEl) {
        resolve(refs as ResolvedAutoRunnerRefs);
        return;
      }
      if (performance.now() - start > GRID_ROOT_TIMEOUT_MS) {
        reject(new Error("grid root not found (timed out waiting for it to mount)"));
        return;
      }
      requestAnimationFrame(poll);
    }
    poll();
  });
}

/**
 * Drives a per-grid page's scripted scenario when embedded in the runner's iframe (URL carries
 * `?auto=1`) or when the runner posts an explicit `benchmark:run` message. `mountKey` is bumped to
 * force 5 remount cycles (via the caller's `key={mountKey}` on the grid subtree) for the
 * post-mount-unmount heap-delta measurement.
 */
export function useAutoRunner(grid: string, getRefs: () => AutoRunnerRefs) {
  const [mountKey, setMountKey] = useState(0);
  const resolveRemountRef = useRef<(() => void) | null>(null);

  // Signals the pending remountCycle() promise once the bumped key has re-rendered and settled.
  useEffect(() => {
    if (resolveRemountRef.current) {
      const resolve = resolveRemountRef.current;
      resolveRemountRef.current = null;
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }
  }, [mountKey]);

  const remountCycle = useCallback(() => {
    return new Promise<void>((resolve) => {
      resolveRemountRef.current = resolve;
      setMountKey((k) => k + 1);
    });
  }, []);

  const run = useCallback(async () => {
    try {
      // Dynamically-imported grids (all but gridcn) haven't finished loading their chunk yet when
      // this fires on the first post-mount rAF — poll for the root instead of failing immediately.
      const refs = await waitForGridRoot(getRefs);
      const result: BenchmarkRunResult = await runBenchmarkScenario({
        grid,
        scrollEl: refs.scrollEl,
        clickTargetEl: refs.clickTargetEl,
        domScopeEl: refs.domScopeEl,
        isReady: refs.isReady,
        remountCycle,
      });
      postToParent({ type: "benchmark:result", result });
    } catch (err) {
      postToParent({ type: "benchmark:error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [grid, getRefs, remountCycle]);

  useEffect(() => {
    postToParent({ type: "benchmark:ready" });
    const params = new URLSearchParams(window.location.search);
    const offRunnerMessage = onRunnerMessage((message) => {
      if (message.type === "benchmark:run") void run();
    });
    if (params.get("auto") === "1") {
      // Give the initially-mounted grid a frame to settle before the scenario's own mount-time
      // measurement starts (isReady() may already be true by the time this effect runs).
      const id = requestAnimationFrame(() => void run());
      return () => {
        cancelAnimationFrame(id);
        offRunnerMessage();
      };
    }
    return offRunnerMessage;
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- run once per mount; `run` closes over refs read fresh via getRefs()
  }, []);

  return { mountKey };
}
