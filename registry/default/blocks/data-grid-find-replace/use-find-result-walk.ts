"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDataGridApi, useDataGridScrollToCellAt } from "@/registry/default/blocks/data-grid/data-grid";
import { useStashedPager } from "@/registry/default/blocks/data-grid-pagination/data-grid-pagination";
import { matchPast, nextHoleRow, type WalkDirection } from "./result-walk";

const WAIT_LIMIT_MS = 15_000;

type Wait = { direction: WalkDirection; origin: number; hole: number; page: number; data: readonly unknown[] };

type Options = {
  enabled: boolean;
  /** A change of this key (find text, options, spec) drops a running wait. */
  resetKey: unknown;
  goTo: (index: number) => void;
};

/** Steps Next and Previous past the loaded rows of a server grid: scrolls to the next unloaded row, or asks for the next page, then activates the first match that arrives. */
export function useFindResultWalk({ enabled, resetKey, goTo }: Options) {
  const api = useDataGridApi();
  const scrollToCell = useDataGridScrollToCellAt();
  const pager = useStashedPager();
  const pagerRef = useRef(pager);
  const goToRef = useRef(goTo);
  useEffect(() => {
    pagerRef.current = pager;
    goToRef.current = goTo;
  });
  const waitRef = useRef<Wait | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const [busy, setBusy] = useState(false);

  const cancel = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    waitRef.current = null;
    setBusy(false);
  }, []);

  const request = useCallback(
    (wait: Wait) => {
      waitRef.current = wait;
      if (wait.hole >= 0) scrollToCell({ col: 0, row: wait.hole });
      else pagerRef.current?.onPageChange(wait.page);
    },
    [scrollToCell],
  );

  const check = useCallback(() => {
    const wait = waitRef.current;
    if (!wait) return;
    const s = api.store.getState();
    const byPage = wait.hole < 0;
    if (byPage ? s.data === wait.data : s.data[s.viewIndex[wait.hole]!] === undefined) return;
    const found = matchPast(s.searchMatches, wait.origin, wait.direction);
    if (found >= 0) {
      cancel();
      goToRef.current(found);
      return;
    }
    if (byPage) {
      const next = wait.page + wait.direction;
      const reachable = next >= 1 && next <= (pagerRef.current?.pageCount ?? 0);
      if (!reachable) return cancel();
      request({ ...wait, page: next, data: s.data });
      return;
    }
    const hole = nextHoleRow(s, wait.hole, wait.direction);
    if (hole === -1) return cancel();
    request({ ...wait, hole });
  }, [api, cancel, request]);

  const step = useCallback(
    (direction: WalkDirection, cursor: number): boolean => {
      if (!enabled) return false;
      if (waitRef.current) return true;
      const s = api.store.getState();
      const matches = s.searchMatches;
      const atEdge = matches.length === 0 || (direction === 1 ? cursor >= matches.length - 1 : cursor <= 0);
      if (!atEdge) return false;
      const origin = matches.length > 0 ? matches[cursor]!.row : direction === 1 ? -1 : s.viewIndex.length;
      const paged = s.pageSize === null && typeof s.totalRowCount === "number" && pagerRef.current !== null;
      let wait: Wait;
      if (paged) {
        const page = pagerRef.current!.page + direction;
        if (page < 1 || page > pagerRef.current!.pageCount) return false;
        wait = { direction, origin: direction === 1 ? -1 : Number.MAX_SAFE_INTEGER, hole: -1, page, data: s.data };
      } else {
        const hole = nextHoleRow(s, origin, direction);
        if (hole === -1) return false;
        wait = { direction, origin, hole, page: 0, data: s.data };
      }
      request(wait);
      setBusy(true);
      const unsubscribe = api.store.subscribe(check);
      const timer = setTimeout(cancel, WAIT_LIMIT_MS);
      stopRef.current = () => {
        unsubscribe();
        clearTimeout(timer);
      };
      return true;
    },
    [api, enabled, request, check, cancel],
  );

  useEffect(() => cancel, [resetKey, cancel]);

  return { step, busy };
}
