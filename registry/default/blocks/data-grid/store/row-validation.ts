import type { StoreApi } from "zustand/vanilla";
import type { DataOp } from "../types";
import { toSafeText } from "../cell-types/safe-text";
import { isThenable } from "./async-gate";
import { cellErrorKey } from "./compute";
import type { GateRun, GateTracker } from "./gate-signal";
import type { RowIndexCache } from "./row-index";
import type { DataGridStoreState } from "./types";

type RowVerdict = Record<string, string> | null;

export type RowValidationDeps = {
  getStore: () => StoreApi<DataGridStoreState>;
  rowIndexCache: RowIndexCache;
  gates: GateTracker;
  warnOnce: (key: string, message: string | (() => string)) => void;
};

export type RowValidation = {
  /**
   * Runs `validateRow` once per touched row of a committed write gesture, AFTER `clearErrorsForOps`
   * — the row in `nextData` already has every cell of the gesture applied, which is the whole
   * point: the verdict cannot depend on column order inside a paste. Returns the same map identity
   * when the prop is absent or nothing changed.
   */
  apply: (
    s: DataGridStoreState,
    cellErrors: ReadonlyMap<string, string>,
    nextData: readonly unknown[],
    ops: readonly DataOp<unknown>[],
  ) => ReadonlyMap<string, string>;
  prune: (data: readonly unknown[], getRowId: (row: unknown, index: number) => string) => void;
  renameRow: (oldId: string, newId: string) => void;
};

export function createRowValidation({ getStore, rowIndexCache, gates, warnOnce }: RowValidationDeps): RowValidation {
  // cellErrors keys of each row's last validateRow verdict, so a re-run clears only its own messages.
  const rowValidationKeys = new Map<string, string[]>();
  // rowId -> its newest pending async verdict; a newer run for the row supersedes and aborts the older one.
  const pendingRowVerdicts = new Map<string, GateRun>();
  // Verdicts that settled in this tick and wait for their write; a newer run for the row drops its entry.
  const settledVerdicts = new Map<string, RowVerdict>();
  let unwatchRowVerdicts: (() => void) | null = null;

  // An unpruned entry for a deleted rowId lets the next validateRow wipe a reused row's consumer errors.
  const prune: RowValidation["prune"] = (data, getRowId) => {
    if (rowValidationKeys.size === 0) return;
    const live = new Set<string>();
    for (let i = 0; i < data.length; i++) live.add(getRowId(data[i], i));
    for (const rowId of rowValidationKeys.keys()) if (!live.has(rowId)) rowValidationKeys.delete(rowId);
  };
  const foldRowVerdict = (
    current: () => ReadonlyMap<string, string>,
    ensure: () => Map<string, string>,
    rowId: string,
    verdict: RowVerdict,
  ): void => {
    const prevKeys = rowValidationKeys.get(rowId);
    if (prevKeys) for (const key of prevKeys) if (current().has(key)) ensure().delete(key);
    const entries = verdict ? Object.entries(verdict) : [];
    if (entries.length === 0) {
      rowValidationKeys.delete(rowId);
      return;
    }
    const keys: string[] = [];
    for (const [columnId, message] of entries) {
      const key = cellErrorKey(rowId, columnId);
      if (current().get(key) !== message) ensure().set(key, message);
      keys.push(key);
    }
    rowValidationKeys.set(rowId, keys);
  };
  const supersedeRowVerdict = (rowId: string): void => {
    settledVerdicts.delete(rowId);
    const older = pendingRowVerdicts.get(rowId);
    if (!older) return;
    pendingRowVerdicts.delete(rowId);
    gates.abortRun(older);
  };
  const watchRowVerdicts = (): void => {
    if (unwatchRowVerdicts) return;
    unwatchRowVerdicts = getStore().subscribe((now, prev) => {
      if (pendingRowVerdicts.size === 0) {
        unwatchRowVerdicts?.();
        unwatchRowVerdicts = null;
        return;
      }
      if (now.data === prev.data) return;
      const index = rowIndexCache.resolve(now.data, now.getRowId);
      for (const rowId of Array.from(pendingRowVerdicts.keys())) if (!index.has(rowId)) supersedeRowVerdict(rowId);
    });
  };
  const renameRow: RowValidation["renameRow"] = (oldId, newId) => {
    const keys = rowValidationKeys.get(oldId);
    if (keys) {
      rowValidationKeys.delete(oldId);
      rowValidationKeys.set(newId, keys.map((key) => cellErrorKey(newId, key.slice(oldId.length + 1))));
    }
    supersedeRowVerdict(oldId);
  };
  // Verdicts that settle in the same tick merge into cellErrors with one copy and one write.
  const flushSettledVerdicts = (): void => {
    const batch = Array.from(settledVerdicts);
    settledVerdicts.clear();
    const store = getStore();
    const s = store.getState();
    const index = rowIndexCache.resolve(s.data, s.getRowId);
    let next: Map<string, string> | null = null;
    for (const [rowId, verdict] of batch) {
      if (!index.has(rowId)) continue;
      foldRowVerdict(
        () => next ?? s.cellErrors,
        () => next ?? (next = new Map(s.cellErrors)),
        rowId,
        verdict,
      );
    }
    const merged = next as Map<string, string> | null;
    if (merged) store.setState({ cellErrors: merged });
  };
  const holdRowVerdict = (rowId: string, run: GateRun, verdict: PromiseLike<RowVerdict>): void => {
    supersedeRowVerdict(rowId);
    pendingRowVerdicts.set(rowId, run);
    gates.hold(run);
    watchRowVerdicts();
    const release = (): boolean => {
      gates.settle(run);
      if (run.aborted || pendingRowVerdicts.get(rowId) !== run) return false;
      pendingRowVerdicts.delete(rowId);
      return true;
    };
    verdict.then(
      (resolved) => {
        if (!release()) return;
        settledVerdicts.set(rowId, resolved);
        if (settledVerdicts.size === 1) queueMicrotask(flushSettledVerdicts);
      },
      (error: unknown) => {
        if (release()) warnOnce("validateRow rejected", () => `validateRow rejected, so the row gets no verdict: ${toSafeText(error)}`);
      },
    );
  };
  const apply: RowValidation["apply"] = (s, cellErrors, nextData, ops) => {
    const validateRow = s.validateRow;
    if (!validateRow) return cellErrors;
    const touched = new Set<string>();
    for (const op of ops) if (op.type === "update") touched.add(op.rowId);
    if (touched.size === 0) return cellErrors;
    const rowIndex = rowIndexCache.resolve(nextData, s.getRowId);
    let next: Map<string, string> | null = null;
    const ensure = () => next ?? (next = new Map(cellErrors));
    const current = () => next ?? cellErrors;
    for (const rowId of touched) {
      const dataRowIndex = rowIndex.get(rowId);
      if (dataRowIndex === undefined) continue;
      const row = nextData[dataRowIndex];
      const run = gates.begin("validateRow");
      let verdict: RowVerdict | PromiseLike<RowVerdict>;
      try {
        verdict = validateRow(row, rowId, { get signal() { return run.signal; } });
      } catch (error) {
        if (pendingRowVerdicts.size > 0 || settledVerdicts.size > 0) supersedeRowVerdict(rowId);
        warnOnce("validateRow threw", () => `validateRow threw, so the row gets no verdict: ${toSafeText(error)}`);
        continue;
      }
      if (isThenable<RowVerdict>(verdict)) {
        holdRowVerdict(rowId, run, verdict);
        continue;
      }
      if (pendingRowVerdicts.size > 0 || settledVerdicts.size > 0) supersedeRowVerdict(rowId);
      foldRowVerdict(current, ensure, rowId, verdict);
    }
    return next ?? cellErrors;
  };

  return { apply, prune, renameRow };
}
