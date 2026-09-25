/**
 * Compile-time-only assertions for getSelectedViewRows. No runtime assertions live here; the
 * tsc gate typechecks this file (it is intentionally named so vitest's *.test.ts glob does not
 * pick it up).
 */
import { getSelectedViewRows } from "./selected-view-rows";
import type { GridSelection } from "../types";

/** Compile-only check: `Actual` must be identical to `Expected` (both directions assignable). */
type Equal<Expected, Actual> = (<T>() => T extends Expected ? 1 : 2) extends <T>() => T extends Actual ? 1 : 2
  ? true
  : false;
function assertEqual<Expected, Actual>(_check: Equal<Expected, Actual>): void {}

// A rows-channel semantics change (view index -> row id) flips `hasIndex`/`toArray` to
// string-keyed and breaks these before any consumer mis-targets rows.
assertEqual<(index: number) => boolean, GridSelection["rows"]["hasIndex"]>(true);
assertEqual<() => number[], GridSelection["rows"]["toArray"]>(true);

// The selector returns view row indices, never row ids.
assertEqual<number[], ReturnType<typeof getSelectedViewRows>>(true);
