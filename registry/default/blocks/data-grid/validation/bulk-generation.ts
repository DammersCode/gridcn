"use client";

import { useEffect, useRef } from "react";
import type { DataGridStoreState } from "../store";

/**
 * The store facts an in-flight bulk batch was built against, plus the row ids it targets. A batch
 * resolves against a grid that may have moved on, so the apply step re-checks these before writing.
 *
 * Targets are ROW IDS, never view rows or data indexes. That is the whole point: a pure reorder (the
 * consumer hands back the same rows in a new order, a row above the target is deleted, a streaming
 * tick moves rows under an active sort) leaves every target id present, and the batch still applies
 * to the cells the user aimed at. Only a change that removes a target row, or one that redefines the
 * view the targets were picked in, drops the batch.
 */
export type BulkBatchSnapshot = {
  rowIds: readonly string[];
  sortState: DataGridStoreState["sortState"];
  filterState: DataGridStoreState["filterState"];
};

/** Reads the snapshot an async bulk batch is held against: its target row ids plus the view specs they were chosen under. */
export function snapshotBulkBatch(s: DataGridStoreState, rowIds: readonly string[]): BulkBatchSnapshot {
  return { rowIds, sortState: s.sortState, filterState: s.filterState };
}

/** The distinct row ids a view-space bulk batch targets — resolved NOW, so a later reorder can still find them. */
export function candidateRowIds(s: DataGridStoreState, candidates: readonly { viewRow: number }[]): string[] {
  const rowIds = new Set<string>();
  for (const candidate of candidates) {
    const dataRowIndex = s.viewIndex[candidate.viewRow];
    if (dataRowIndex === undefined) continue;
    const row = s.data[dataRowIndex];
    if (row === undefined) continue;
    rowIds.add(s.getRowId(row, dataRowIndex));
  }
  return Array.from(rowIds);
}

/**
 * Whether a batch held against `snapshot` may still apply to `s`.
 *
 * Drops when any target row id is gone from `data` (the rows it validated no longer exist — a data
 * replacement, a delete) or when the sort or filter spec changed (the batch chose its targets inside
 * a view that no longer exists, so applying it would write cells the user never selected). Survives a
 * re-render, a scroll, a selection change, an unrelated edit, and any reordering of `data` that keeps
 * the target rows present.
 */
export function isBulkBatchCurrent(s: DataGridStoreState, snapshot: BulkBatchSnapshot): boolean {
  if (s.sortState !== snapshot.sortState || s.filterState !== snapshot.filterState) return false;
  if (snapshot.rowIds.length === 0) return true;
  const present = new Set<string>();
  for (let i = 0; i < s.data.length; i++) present.add(s.getRowId(s.data[i], i));
  return snapshot.rowIds.every((rowId) => present.has(rowId));
}

/**
 * Re-points a held batch's writes at the view rows their target ids occupy NOW.
 *
 * {@link isBulkBatchCurrent} only decides whether the batch as a whole may still land; a pure
 * reorder passes it while every write's captured `viewRow` has gone stale, which without this would
 * write the user's values onto whichever rows happen to sit at those positions. A write whose
 * `rowId` is no longer in the view is dropped, never remapped — the guard's drop decisions must not
 * be undone here. Writes with no `rowId` (a caller that never resolved one) pass through untouched.
 */
export function reresolveBulkWrites<T extends { viewRow: number; rowId?: string }>(
  s: DataGridStoreState,
  writes: readonly T[],
): T[] {
  const viewRowById = new Map<string, number>();
  for (let viewRow = 0; viewRow < s.viewIndex.length; viewRow++) {
    const dataRowIndex = s.viewIndex[viewRow]!; // viewRow < length by loop condition
    const row = s.data[dataRowIndex];
    if (row !== undefined) viewRowById.set(s.getRowId(row, dataRowIndex), viewRow);
  }

  const resolved: T[] = [];
  for (const write of writes) {
    if (write.rowId === undefined) {
      resolved.push(write);
      continue;
    }
    const viewRow = viewRowById.get(write.rowId);
    if (viewRow === undefined) continue;
    resolved.push(viewRow === write.viewRow ? write : { ...write, viewRow });
  }
  return resolved;
}

/** What {@link useBulkGeneration} hands a caller that is about to hold a batch. */
export type BulkGeneration = {
  /** Bumps the counter and returns this batch's token. Any batch begun earlier is now stale. */
  begin(): number;
  /** Whether `token` is still the newest batch AND the store still matches `snapshot`. */
  isCurrent(token: number, s: DataGridStoreState, snapshot: BulkBatchSnapshot): boolean;
  /** {@link reresolveBulkWrites} — the apply-time half of the guard, reached without a second import. */
  reresolve<T extends { viewRow: number; rowId?: string }>(s: DataGridStoreState, writes: readonly T[]): T[];
};

/**
 * Per-surface generation counter for held async bulk batches — the same discipline
 * `interaction/use-async-validate.ts` uses for a single cell, at batch scope.
 *
 * One counter per hook instance means one per SURFACE: the paste pipeline, the fill handle, and the
 * import dialog each supersede only their own in-flight batch. A second paste fired while the first
 * is still validating wins outright; the first resolves into a dropped token and writes nothing, so
 * an older paste can never land on top of a newer one. Unmount bumps the counter too, so a batch
 * that resolves after the grid is gone is discarded instead of calling into a dead store.
 */
export function useBulkGeneration(): BulkGeneration {
  const generationRef = useRef(0);
  const apiRef = useRef<BulkGeneration | null>(null);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
    };
  }, []);

  if (!apiRef.current) {
    apiRef.current = {
      begin: () => ++generationRef.current,
      isCurrent: (token, s, snapshot) => generationRef.current === token && isBulkBatchCurrent(s, snapshot),
      reresolve: reresolveBulkWrites,
    };
  }
  return apiRef.current;
}
