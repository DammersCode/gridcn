"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * A stable-identity wrapper that calls the latest `renderer`. An inline renderer then leaves the
 * memoized rows and the root context alone; its output refreshes when its row or header re-renders.
 */
export function useLatestRenderer<Ctx>(renderer: ((ctx: Ctx) => React.ReactNode) | undefined): ((ctx: Ctx) => React.ReactNode) | undefined {
  const latest = useRef(renderer);
  useLayoutEffect(() => {
    latest.current = renderer;
  }, [renderer]);
  const stable = useCallback((ctx: Ctx) => latest.current?.(ctx), []);
  return renderer === undefined ? undefined : stable;
}
