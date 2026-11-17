import { nextAnnouncement } from "./announcements";
import { isThenable } from "./async-gate";
import { buildRollback } from "../interaction/rollback";
import { createWarnOnce, warnDev } from "../is-dev";
import type { DataWriteContext } from "./data-write";
import { EMPTY_SAVE_STATUS, readRejections, refusedOps, SaveTimeoutError, type RowSaveStatus, type SaveAck, type SaveRejection, type SaveResolution } from "./write-ack";
import type { DataChange, DataOp } from "../types";
import type { DataGridStoreState } from "./types";

type SetState = (partial: Partial<DataGridStoreState>) => void;
type GetState = () => DataGridStoreState;

/** The acknowledged-save bookkeeping of one grid: pending and failed rows, refusal chains, conflict resolution, and the save status it publishes. */
export type SaveTracker = {
  /** Moves everything keyed by `oldId` to `newId`. */
  renameRow(oldId: string, newId: string): void;
  /** Drops the `failed` marks and publishes the status. */
  clearFailed(): void;
  publishSaveStatus(): void;
};

export function createSaveTracker(set: SetState, get: GetState, ctx: DataWriteContext): SaveTracker {
  const warnGateOnce = createWarnOnce();
  const pendingByRow = new Map<string, number>();
  const latestWriteOfRow = new Map<string, number>();
  const failedRows = new Set<string>();
  let writeSeq = 0;
  let pendingSaves = 0;
  let warnedReadOnlyRevert = false;
  // Refused cell value -> the value it replaced, so a second refusal on the same cell reverts past the first refused value.
  const refusedPrev = new Map<string, Map<string, Map<unknown, unknown>>>();
  const MAX_FAILED_ROWS = 10_000;
  const MAX_CHAINED_ROWS = 10_000;
  const dropChains = (rowId: string): void => {
    refusedPrev.delete(rowId);
  };
  const chainRefusedPrev = (ops: DataOp<unknown>[]): DataOp<unknown>[] =>
    ops.map((op) => {
      if (op.type !== "update" || !op.cells) return op;
      const cells = op.cells.map((cell) => {
        const byColumn = refusedPrev.get(op.rowId) ?? new Map<string, Map<unknown, unknown>>();
        const chain = byColumn.get(cell.columnId) ?? new Map<unknown, unknown>();
        const prev = chain.has(cell.prev) ? chain.get(cell.prev) : cell.prev;
        chain.set(cell.value, prev);
        byColumn.set(cell.columnId, chain);
        refusedPrev.set(op.rowId, byColumn);
        return { ...cell, prev };
      });
      return { ...op, cells };
    });
  let warnedCurrentRowId = false;
  /** The `current` rows of the rejections that may replace a row: its id matches, the change holds no insert of it, and no newer write is pending. */
  const usableCurrentRows = (
    s: DataGridStoreState,
    change: DataChange<unknown>,
    rejected: readonly SaveRejection[],
    seq: number,
    deleteOps: ReadonlyMap<string, { index: number }>,
  ): Map<string, unknown> => {
    const usable = new Map<string, unknown>();
    const inserted = new Set(change.ops.flatMap((op) => (op.type === "insert" ? [op.rowId] : [])));
    for (const { rowId, current } of rejected) {
      // A newer write to the row, pending or already accepted, makes the server's row older than the grid's.
      if (current === undefined || inserted.has(rowId) || pendingByRow.has(rowId) || latestWriteOfRow.get(rowId) !== seq) continue;
      const index = deleteOps.get(rowId)?.index ?? 0;
      let currentId: string | undefined;
      try {
        currentId = s.getRowId(current, index);
      } catch {
        currentId = undefined;
      }
      if (currentId !== rowId) {
        if (!warnedCurrentRowId) {
          warnedCurrentRowId = true;
          warnDev(`SaveRejection.current for row "${rowId}" has another id, so it was ignored and the change was reverted in place`);
        }
        continue;
      }
      usable.set(rowId, current);
    }
    return usable;
  };
  /** One `change.ops` entry per `current` row: replace the row in the data, or re-insert a deleted row as the server holds it. */
  const currentRowOps = (s: DataGridStoreState, currentRows: ReadonlyMap<string, unknown>, deleteOps: ReadonlyMap<string, { index: number }>): DataOp<unknown>[] => {
    if (currentRows.size === 0) return [];
    const dataIndexById = ctx.rowIndexCache.resolve(s.data, s.getRowId);
    const ops: DataOp<unknown>[] = [];
    for (const [rowId, current] of currentRows) {
      const index = dataIndexById.get(rowId);
      if (index !== undefined) {
        ops.push({ type: "update", rowId, row: current, prev: s.data[index] });
        continue;
      }
      const deleted = deleteOps.get(rowId);
      if (deleted) ops.push({ type: "insert", rowId, row: current, index: deleted.index });
    }
    return ops;
  };
  /** The `"merge"` updates for rows whose resolver kept the user's intent (`"mine"` or a merged row) on top of the server's row. */
  const mergeOpsOf = (s: DataGridStoreState, currentRows: ReadonlyMap<string, unknown>, answers: ReadonlyMap<string, SaveResolution<unknown>>): DataOp<unknown>[] => {
    const ops: DataOp<unknown>[] = [];
    if (answers.size === 0 || currentRows.size === 0) return ops;
    const dataIndexById = ctx.rowIndexCache.resolve(s.data, s.getRowId);
    for (const [rowId, theirs] of currentRows) {
      const answer = answers.get(rowId);
      if (answer === undefined || answer === "theirs") continue;
      const index = dataIndexById.get(rowId);
      if (index === undefined) continue;
      let target: unknown = s.data[index];
      if (answer !== "mine") {
        const merged = (answer as { row: unknown }).row;
        let mergedId: string | undefined;
        try {
          mergedId = merged === undefined || merged === null ? undefined : s.getRowId(merged, index);
        } catch {
          mergedId = undefined;
        }
        if (mergedId !== rowId) {
          warnGateOnce("merged row id", `resolveSaveConflict returned a row that does not have the id "${rowId}", so the server's row is taken`);
          continue;
        }
        target = merged;
      }
      ops.push({ type: "update", rowId, row: target, prev: theirs });
    }
    return ops;
  };
  /** An acknowledged write in flight; `alias` maps the row ids it was tracked under to the ids a swap gave them since. */
  type LiveWrite = { rowIds: Set<string>; alias: Map<string, string>; origin: Map<string, string> };
  const liveWrites = new Set<LiveWrite>();
  const retargetLiveWrites = (oldId: string, newId: string): void => {
    for (const write of liveWrites) {
      const origin = write.origin.get(oldId) ?? (write.rowIds.has(oldId) && !write.alias.has(oldId) ? oldId : undefined);
      if (origin === undefined) continue;
      write.alias.set(origin, newId);
      write.origin.delete(oldId);
      write.origin.set(newId, origin);
    }
  };
  const resolvingRows = new Map<string, number>();
  const conflictAborts = new Map<string, AbortController>();
  const saveAborts = new Set<AbortController>();
  ctx.abortConflicts = () => {
    for (const controller of conflictAborts.values()) controller.abort();
    conflictAborts.clear();
    for (const controller of saveAborts) controller.abort();
    saveAborts.clear();
  };
  const publishSaveStatus = (): void => {
    const status = new Map<string, RowSaveStatus>();
    for (const rowId of failedRows) status.set(rowId, "failed");
    for (const rowId of pendingByRow.keys()) status.set(rowId, "saving");
    for (const rowId of resolvingRows.keys()) status.set(rowId, "saving");
    for (const rowId of latestWriteOfRow.keys()) if (!status.has(rowId)) latestWriteOfRow.delete(rowId);
    set({ saveStatus: status.size === 0 ? EMPTY_SAVE_STATUS : status, pendingSaveCount: pendingSaves });
  };
  const normalizeResolution = (answer: unknown): SaveResolution<unknown> => {
    if (answer === "mine") return "mine";
    if (typeof answer === "object" && answer !== null && (answer as { row?: unknown }).row != null) return answer as { row: unknown };
    return "theirs";
  };
  ctx.trackWrite = (change, result, controller) => {
    const rowIds = [...new Set(change.ops.map((op) => op.rowId))];
    const write: LiveWrite = { rowIds: new Set(rowIds), alias: new Map(), origin: new Map() };
    const liveId = (rowId: string): string => write.alias.get(rowId) ?? rowId;
    liveWrites.add(write);
    const seq = ++writeSeq;
    for (const rowId of rowIds) {
      pendingByRow.set(rowId, (pendingByRow.get(rowId) ?? 0) + 1);
      latestWriteOfRow.set(rowId, seq);
      failedRows.delete(rowId);
      conflictAborts.get(rowId)?.abort();
      conflictAborts.delete(rowId);
    }
    pendingSaves += 1;
    publishSaveStatus();
    const settle = (ack: SaveAck, error: unknown, failed: boolean): void => {
      if (ctx.disposed) return;
      const ids = rowIds.map(liveId);
      for (const rowId of ids) {
        const left = (pendingByRow.get(rowId) ?? 1) - 1;
        if (left > 0) pendingByRow.set(rowId, left);
        else pendingByRow.delete(rowId);
      }
      pendingSaves -= 1;
      const rejectedAtSettle = readRejections(change, ack, error, failed, warnGateOnce);
      const refusedAtSettle = new Set(rejectedAtSettle.map((entry) => liveId(entry.rowId)));
      // A chain only bridges writes that overlap in flight; an accepted write or an idle row ends it.
      for (const rowId of ids) if (!refusedAtSettle.has(rowId) && !pendingByRow.has(rowId)) dropChains(rowId);
      if (rejectedAtSettle.length === 0) {
        liveWrites.delete(write);
        publishSaveStatus();
        return;
      }
      const originOf = new Map(ids.map((id, i) => [id, rowIds[i]!] as const));
      const view = () => {
        const retarget = write.alias.size > 0;
        const rejected = retarget ? rejectedAtSettle.map((entry) => ({ ...entry, rowId: liveId(entry.rowId) })) : rejectedAtSettle;
        const aliased = retarget ? { ...change, ops: change.ops.map((op) => (write.alias.has(op.rowId) ? { ...op, rowId: liveId(op.rowId) } : op)) } : change;
        const deleteOps = new Map(aliased.ops.flatMap((op) => (op.type === "delete" ? [[op.rowId, op] as const] : [])));
        return { rejected, aliased, deleteOps, refusedRows: new Set(rejected.map((entry) => entry.rowId)) };
      };
      const asked = new Map<string, { controller: AbortController; answer?: SaveResolution<unknown> }>();
      const waiting: PromiseLike<void>[] = [];
      const first = get();
      const resolver = first.readOnly ? undefined : first.resolveSaveConflict;
      const start = view();
      if (resolver) {
        const dataIndexById = ctx.rowIndexCache.resolve(first.data, first.getRowId);
        const messageById = new Map<string, string>();
        for (const entry of start.rejected) if (entry.message !== undefined && !messageById.has(entry.rowId)) messageById.set(entry.rowId, entry.message);
        for (const [rowId, theirs] of usableCurrentRows(first, start.aliased, start.rejected, seq, start.deleteOps)) {
          const index = dataIndexById.get(rowId);
          if (index === undefined) continue;
          const controller = new AbortController();
          conflictAborts.set(rowId, controller);
          const entry: { controller: AbortController; answer?: SaveResolution<unknown> } = { controller };
          asked.set(originOf.get(rowId) ?? rowId, entry);
          const message = messageById.get(rowId);
          let answer: SaveResolution<unknown> | PromiseLike<SaveResolution<unknown>>;
          try {
            answer = resolver({ rowId, mine: first.data[index], theirs, change: start.aliased, ...(message === undefined ? {} : { message }), signal: controller.signal });
          } catch (callbackError) {
            console.error("[data-grid] resolveSaveConflict threw, so the server's row is taken:", callbackError);
            continue;
          }
          if (!isThenable<SaveResolution<unknown>>(answer)) {
            entry.answer = normalizeResolution(answer);
            continue;
          }
          const aborted = new Promise<void>((resolve) => {
            if (controller.signal.aborted) resolve();
            else controller.signal.addEventListener("abort", () => resolve(), { once: true });
          });
          waiting.push(
            Promise.race([
              aborted,
              Promise.resolve(answer).then(
                (resolved) => void (entry.answer = normalizeResolution(resolved)),
                (callbackError: unknown) => void console.error("[data-grid] resolveSaveConflict rejected, so the server's row is taken:", callbackError),
              ),
            ]),
          );
        }
      }
      const finish = (): void => {
        const { rejected, aliased, deleteOps, refusedRows } = view();
        const s = get();
        if (s.readOnly) {
          if (!warnedReadOnlyRevert) {
            warnedReadOnlyRevert = true;
            warnDev("a write was refused while the grid is readOnly, so it was not reverted; the data keeps the refused value");
          }
        } else {
          try {
          if (refusedPrev.size > MAX_CHAINED_ROWS) refusedPrev.clear();
          const currentRows = usableCurrentRows(s, aliased, rejected, seq, deleteOps);
          const answers = new Map<string, SaveResolution<unknown>>();
          for (const [origin, entry] of asked) {
            const id = liveId(origin);
            if (entry.controller.signal.aborted) currentRows.delete(id);
            else if (entry.answer !== undefined) answers.set(id, entry.answer);
          }
          const mergeOps = mergeOpsOf(s, currentRows, answers);
          // A row with a usable `current` gets its content from it; only a move of it reverts in place.
          const plainOps = refusedOps(aliased, rejected).filter((op) => !(currentRows.has(op.rowId) && (op.type === "update" || op.type === "delete")));
          const revert = buildRollback({ ops: chainRefusedPrev(plainOps), source: "rollback" }, s);
          const ops = [...revert.ops, ...currentRowOps(s, currentRows, deleteOps)];
          const serverRowIds = [...currentRows.keys()];
          try {
            if (ops.length > 0) s.actions.commitChange({ ...revert, ops, reverts: change, ...(serverRowIds.length > 0 ? { serverRowIds } : {}) });
          } catch (error) {
            console.error("[data-grid] the revert of a refused save threw in a callback:", error);
          }
          try {
            if (mergeOps.length > 0) s.actions.commitChange({ source: "merge", ops: mergeOps, reverts: change, serverRowIds: mergeOps.map((op) => op.rowId) });
          } catch (error) {
            console.error("[data-grid] the merge of a save conflict threw in a callback:", error);
          }
          } catch (error) {
            console.error("[data-grid] the revert of a refused save failed:", error);
          }
        }
        for (const [origin, entry] of asked) if (conflictAborts.get(liveId(origin)) === entry.controller) conflictAborts.delete(liveId(origin));
        for (const rowId of refusedRows) if (!pendingByRow.has(rowId)) dropChains(rowId);
        for (const { rowId } of rejected) {
          if (latestWriteOfRow.get(rowId) !== seq) continue;
          if (failedRows.size >= MAX_FAILED_ROWS) failedRows.delete(failedRows.values().next().value!);
          failedRows.add(rowId);
        }
        const liveIds = new Set(rowIds.map(liveId));
        const refusedInChange = [...refusedRows].filter((rowId) => liveIds.has(rowId)).length;
        set({ liveAnnouncement: nextAnnouncement(get().liveAnnouncement, "saveRejected", refusedInChange) });
        liveWrites.delete(write);
        publishSaveStatus();
        const onSaveRejected = get().onSaveRejected;
        if (!onSaveRejected) return;
        try {
          onSaveRejected({ change, rejected, error: failed ? error : null });
        } catch (callbackError) {
          console.error("[data-grid] onSaveRejected threw:", callbackError);
        }
      };
      if (waiting.length === 0) {
        finish();
        return;
      }
      const held = [...start.refusedRows].filter((id) => originOf.has(id)).map((id) => originOf.get(id)!);
      for (const rowId of held) resolvingRows.set(rowId, (resolvingRows.get(rowId) ?? 0) + 1);
      publishSaveStatus();
      void Promise.all(waiting).then(() => {
        for (const origin of held) {
          const rowId = liveId(origin);
          const left = (resolvingRows.get(rowId) ?? 1) - 1;
          if (left > 0) resolvingRows.set(rowId, left);
          else resolvingRows.delete(rowId);
        }
        if (ctx.disposed) return;
        finish();
      });
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const settleOnce = (ack: SaveAck, error: unknown, failed: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      saveAborts.delete(controller);
      settle(ack, error, failed);
    };
    saveAborts.add(controller);
    const timeoutMs = get().saveTimeoutMs;
    if (typeof timeoutMs === "number" && timeoutMs > 0 && Number.isFinite(timeoutMs)) {
      timer = setTimeout(() => {
        controller.abort();
        settleOnce(undefined, new SaveTimeoutError(timeoutMs), true);
      }, timeoutMs);
    }
    Promise.resolve(result).then(
      (ack) => settleOnce(ack, undefined, false),
      (error: unknown) => settleOnce(undefined, error, true),
    );
  };

  return {
    renameRow(oldId, newId) {
      for (const map of [pendingByRow, latestWriteOfRow, resolvingRows, conflictAborts] as Map<string, unknown>[]) {
        if (!map.has(oldId)) continue;
        map.set(newId, map.get(oldId));
        map.delete(oldId);
      }
      if (failedRows.delete(oldId)) failedRows.add(newId);
      const chains = refusedPrev.get(oldId);
      if (chains) {
        refusedPrev.set(newId, chains);
        refusedPrev.delete(oldId);
      }
      retargetLiveWrites(oldId, newId);
    },
    clearFailed() {
      if (failedRows.size === 0) return;
      failedRows.clear();
      publishSaveStatus();
    },
    publishSaveStatus,
  };
}
