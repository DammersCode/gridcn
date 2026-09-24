/**
 * Compile-time-only pin of the data-grid-presence public payload contract: the
 * `PresenceHighlight`/`RowIdPresenceHighlight`/`RowIdRangePresenceHighlight` entry shapes, the
 * `isRowIdPresenceHighlight`/`isRowIdRangePresenceHighlight` guards (signature + true-branch
 * narrowing to the member type), and that foreign/malformed payloads are rejected. No runtime
 * assertions live here; the tsc gate typechecks this file (named so vitest's *.test.ts glob does
 * not pick it up, matching the repo's other type-test files).
 */
import type { GridRect } from "@/registry/default/blocks/data-grid/data-grid";
import {
  isRowIdPresenceHighlight,
  isRowIdRangePresenceHighlight,
  type PresenceHighlight,
  type PresenceHighlightEntry,
  type RowIdPresenceHighlight,
  type RowIdRangePresenceHighlight,
} from "./data-grid-presence";

/** Compile-only check: `Actual` must be identical to `Expected` (both directions assignable). */
type Equal<Expected, Actual> = (<T>() => T extends Expected ? 1 : 2) extends <T>() => T extends Actual ? 1 : 2
  ? true
  : false;
function assertEqual<Expected, Actual>(_check: Equal<Expected, Actual>): void {}

// --- entry shapes: the discriminated union's three members and the union itself --

assertEqual<PresenceHighlight, { id: string; color: string; range: GridRect; label?: string }>(true);
assertEqual<RowIdPresenceHighlight, { id: string; color: string; rowId: string; columnId: string; label?: string }>(true);
assertEqual<RowIdRangePresenceHighlight, { id: string; color: string; rowIds: string[]; columnIds: string[]; label?: string }>(true);
assertEqual<PresenceHighlight | RowIdPresenceHighlight | RowIdRangePresenceHighlight, PresenceHighlightEntry>(true);

// --- guards: signature + true-branch narrowing to the member type ----------------

assertEqual<(entry: PresenceHighlightEntry) => entry is RowIdPresenceHighlight, typeof isRowIdPresenceHighlight>(true);
assertEqual<(entry: PresenceHighlightEntry) => entry is RowIdRangePresenceHighlight, typeof isRowIdRangePresenceHighlight>(true);

declare const entry: PresenceHighlightEntry;

if (isRowIdPresenceHighlight(entry)) {
  const rowId: string = entry.rowId;
  const columnId: string = entry.columnId;
  void rowId;
  void columnId;
}
if (isRowIdRangePresenceHighlight(entry)) {
  const rowIds: string[] = entry.rowIds;
  const columnIds: string[] = entry.columnIds;
  void rowIds;
  void columnIds;
}

// --- payloads: all three valid forms compile (incl. the documented both-rowId-and-rowIds form)

const viewSpace: PresenceHighlightEntry = { id: "u1", color: "#ff0000", range: { x: 0, y: 1, width: 2, height: 3 } };
const singleCell: PresenceHighlightEntry = { id: "u2", color: "#00ff00", rowId: "r1", columnId: "c1", label: "Ann" };
const rowRange: PresenceHighlightEntry = { id: "u3", color: "#0000ff", rowIds: ["r1", "r2"], columnIds: ["c1", "c2"] };
// An entry carrying both rowId and rowIds is still a valid payload (the single-cell form wins at
// paint time — see PresenceHighlightEntry's doc comment).
const both: PresenceHighlightEntry = { id: "u4", color: "#000000", rowId: "r1", columnId: "c1", rowIds: ["r1"], columnIds: ["c1"] };
void viewSpace;
void singleCell;
void rowRange;
void both;

// --- foreign/malformed payloads are rejected -------------------------------------

// @ts-expect-error - a view-space entry whose range is a string, not a GridRect
const badRange: PresenceHighlightEntry = { id: "u1", color: "red", range: "not-a-rect" };
void badRange;

// @ts-expect-error - a rowId-native entry with a non-string rowId (foreign JSON that lost its type)
const badRowId: PresenceHighlightEntry = { id: "u1", color: "red", rowId: null, columnId: "c1" };
void badRowId;

// @ts-expect-error - missing every required member (no id, no range/rowId/rowIds)
const foreign: PresenceHighlightEntry = { color: "red" };
void foreign;

export {};
