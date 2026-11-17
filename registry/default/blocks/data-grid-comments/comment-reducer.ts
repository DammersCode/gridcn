import type { ApplyRemoteVerdict, CellComment, CommentChange, CommentRejectedCtx, CommentRejectReason, CommentSource } from "./types";
import { validateComment } from "./validate";
import {
  addrOf,
  addTombstone,
  bump,
  cellCount,
  changeAlias,
  dropCommentUi,
  editDraftKey,
  EMITTED_MEMORY_MS,
  indexAdd,
  indexRemove,
  keepDraftText,
  MAX_ALIASES,
  MAX_LISTED_SKIPS,
  newDraftKey,
  OWN_WRITE_GRACE_MS,
  putDraft,
  rebaseDraft,
  removeConfirmed,
  sameRecord,
  setConfirmed,
  setConflict,
  syncIndex,
  withAlias,
  type AckOutcome,
  type CommentEvent,
  type CommentsState,
  type Conflict,
  type Ctx,
  type Emit,
  type Pending,
  type ReduceResult,
  type Skip,
} from "./comment-state";

function pushLocal(c: Ctx, change: CommentChange): void {
  c.out.push({ t: "local", change });
}

function authoritativeChange(rec: CellComment, p: Pending): CommentChange {
  return { kind: "upsert", comment: rec, baseVersion: p.baseVersion };
}

/** Rule 4(a)/(6): a write is confirmed by `rec`. */
function confirmPendingUpsert(c: Ctx, p: Pending, rec: CellComment, server: boolean, silent: boolean): void {
  const { st } = c;
  st.pending.delete(rec.id);
  setConfirmed(c, rec, server, silent);
  st.ownConfirmedAt.set(rec.id, c.now);
  const conflict = st.conflicts.get(rec.id);
  if (conflict && (conflict.writeId === p.writeId || conflict.thrown)) st.conflicts.delete(rec.id);
  rebaseDraft(st, p, rec);
  pushLocal(c, authoritativeChange(rec, p));
}

function confirmPendingDelete(c: Ctx, p: Pending, version: number, silent: boolean): void {
  const { st } = c;
  const id = p.record.id;
  st.pending.delete(id);
  removeConfirmed(c, id, version, p.writeId, { tombstone: true, silent });
  if (!st.confirmed.has(id)) addTombstone(c, id, p.record.rowId, p.record.columnId, version);
  st.conflicts.delete(id);
  st.drafts.delete(editDraftKey(id));
  syncIndex(st, id, p.record.rowId, p.record.columnId);
  pushLocal(c, { kind: "delete", id, rowId: p.record.rowId, columnId: p.record.columnId, version, writeId: p.writeId, baseVersion: p.baseVersion });
}

/** The thrown write whose echo still confirms it. */
function thrownEcho(st: CommentsState, id: string, writeId: string | undefined, version: number): Conflict | undefined {
  const conflict = st.conflicts.get(id);
  if (!conflict || !conflict.thrown || writeId === undefined || conflict.writeId !== writeId) return undefined;
  return version >= conflict.baseVersion + 1 ? conflict : undefined;
}

function conflictAsPending(conflict: Conflict): Pending {
  return {
    writeId: conflict.writeId,
    action: conflict.action,
    baseVersion: conflict.baseVersion,
    baseWriteId: conflict.baseWriteId,
    change: conflict.change,
    record: conflict.record,
    superseded: false,
  };
}

function tieWins(st: CommentsState, current: CellComment, incoming: CellComment, incomingServer: boolean, fetchUntouched: boolean): boolean {
  if (fetchUntouched) return true;
  const currentServer = st.serverConfirmed.get(current.id) === current.version;
  if (incomingServer && !currentServer) return true;
  if (!incomingServer && currentServer) return false;
  if (incoming.updatedAt !== current.updatedAt) return incoming.updatedAt > current.updatedAt;
  return (incoming.writeId ?? "") > (current.writeId ?? "");
}

type UpsertOpts = { server: boolean; fetchUntouched?: boolean };

/** Rules 3 to 5 for one incoming upsert of a known or unknown id. */
function applyUpsert(c: Ctx, raw: CellComment, opts: UpsertOpts): "applied" | Skip {
  const { st } = c;
  const rec = withAlias(st, raw);
  const id = rec.id;
  const known = addrOf(st, id);
  if (known && (known.rowId !== rec.rowId || known.columnId !== rec.columnId)) return "invalid";
  const confirmed = st.confirmed.get(id);
  if (confirmed && confirmed.author.id !== rec.author.id) return "invalid";
  const p = st.pending.get(id);
  if (p && !p.superseded && p.action !== "delete" && rec.writeId !== undefined && rec.writeId === p.writeId && rec.version >= p.baseVersion + 1) {
    confirmPendingUpsert(c, p, rec, opts.server, false);
    return "applied";
  }
  const thrown = thrownEcho(st, id, rec.writeId, rec.version);
  if (thrown && thrown.action !== "delete") {
    confirmPendingUpsert(c, conflictAsPending(thrown), rec, opts.server, false);
    return "applied";
  }
  const tomb = st.tombstones.get(id);
  if (tomb) {
    const resurrect = rec.version === tomb.version && opts.fetchUntouched === true;
    if (rec.version < tomb.version || (rec.version === tomb.version && !resurrect)) return "tombstoned";
  }
  if (confirmed) {
    if (rec.version < confirmed.version) return "stale";
    if (rec.version === confirmed.version) {
      if (rec.writeId !== undefined && rec.writeId === confirmed.writeId) return "duplicate";
      if (!tieWins(st, confirmed, rec, opts.server, opts.fetchUntouched === true)) return "stale";
    }
  } else if (!tomb || rec.version > tomb.version || opts.fetchUntouched) {
    if (st.confirmed.size + st.pending.size >= st.bounds.maxComments) return "limit";
    if (cellCount(st, rec.rowId, rec.columnId) >= st.bounds.maxCommentsPerCell) return "limit";
  }
  setConfirmed(c, rec, opts.server);
  return "applied";
}

/** Marks the pending write superseded and offers its text as a draft for a new comment. */
function supersedePending(c: Ctx, p: Pending): void {
  const { st } = c;
  p.superseded = true;
  if ((p.action === "update" || p.action === "create") && p.record.text) {
    const key = newDraftKey(p.record.rowId, p.record.columnId);
    if (!st.drafts.has(key)) putDraft(st, { key, kind: "new", rowId: p.record.rowId, columnId: p.record.columnId, text: p.record.text, baseVersion: 0, baseWriteId: undefined });
  }
}

function applyDelete(c: Ctx, change: Extract<CommentChange, { kind: "delete" }>, opts: UpsertOpts): "applied" | Skip {
  const { st } = c;
  const d = changeAlias(st, change) as Extract<CommentChange, { kind: "delete" }>;
  const id = d.id;
  const known = addrOf(st, id);
  if (known && (known.rowId !== d.rowId || known.columnId !== d.columnId)) return "invalid";
  const p = st.pending.get(id);
  if (p && !p.superseded && p.action === "delete" && d.writeId !== undefined && d.writeId === p.writeId && d.version >= p.baseVersion + 1) {
    confirmPendingDelete(c, p, d.version, false);
    return "applied";
  }
  const thrown = thrownEcho(st, id, d.writeId, d.version);
  if (thrown && thrown.action === "delete") {
    confirmPendingDelete(c, conflictAsPending(thrown), d.version, false);
    return "applied";
  }
  const tomb = st.tombstones.get(id);
  if (tomb && d.version <= tomb.version) return "duplicate";
  const confirmed = st.confirmed.get(id);
  if (!confirmed) {
    const inFlight = st.rowRequest.has(d.rowId);
    if (!inFlight && !p) return "unknown";
    addTombstone(c, id, d.rowId, d.columnId, d.version);
    if (p && !p.superseded) supersedePending(c, p);
    return "applied";
  }
  if (d.version < confirmed.version) return "stale";
  if (d.version === confirmed.version && d.writeId !== undefined && d.writeId === confirmed.writeId) return "duplicate";
  removeConfirmed(c, id, d.version, d.writeId, { tombstone: true });
  if (p && !p.superseded) supersedePending(c, p);
  keepDraftText(st, id, confirmed.rowId, confirmed.columnId);
  dropCommentUi(st, id);
  if (opts.server) st.ownConfirmedAt.delete(id);
  return "applied";
}

function finish(c: Ctx, source: CommentSource): void {
  if (c.changes.length > 0) c.out.push({ t: "change", changes: c.changes, source });
}

function rollback(c: Ctx, p: Pending, ctx: { reason: CommentRejectReason; message?: string; current?: CellComment | null; error?: unknown; thrown: boolean; discardOnly?: boolean }): void {
  const { st } = c;
  const id = p.record.id;
  st.pending.delete(id);
  syncIndex(st, id, p.record.rowId, p.record.columnId);
  const text = p.action === "create" || p.action === "update" ? p.record.text : undefined;
  const confirmed = st.confirmed.get(id);
  setConflict(st, {
    id,
    rowId: p.record.rowId,
    columnId: p.record.columnId,
    action: p.action,
    reason: ctx.reason,
    message: ctx.message,
    writeId: p.writeId,
    baseVersion: p.baseVersion,
    baseWriteId: p.baseWriteId,
    change: p.change,
    record: p.record,
    thrown: ctx.thrown,
    text,
    shownVersion: confirmed?.version ?? p.baseVersion,
    discardOnly: ctx.discardOnly === true,
  });
  if (text !== undefined) {
    const asNew = p.action === "create" || !st.confirmed.has(id);
    const key = asNew ? newDraftKey(p.record.rowId, p.record.columnId) : editDraftKey(id);
    putDraft(st, { key, kind: asNew ? "new" : "edit", commentId: asNew ? undefined : id, rowId: p.record.rowId, columnId: p.record.columnId, text, baseVersion: asNew ? 0 : p.baseVersion, baseWriteId: asNew ? undefined : p.baseWriteId });
  }
  const rejected: CommentRejectedCtx = { action: p.action, change: p.change, reason: ctx.reason };
  if (ctx.message !== undefined) rejected.message = ctx.message;
  if (ctx.current !== undefined) rejected.current = ctx.current;
  if (ctx.error !== undefined) rejected.error = ctx.error;
  c.out.push({ t: "rejected", ctx: rejected });
}

function handleAck(c: Ctx, id: string, writeId: string, outcome: AckOutcome): void {
  const { st } = c;
  const p = st.pending.get(id);
  if (!p || p.writeId !== writeId) {
    if (outcome.kind === "record" && outcome.comment) applyUpsert(c, outcome.comment, { server: true });
    else if (outcome.kind === "rejected" && outcome.current && outcome.current.writeId === writeId) applyUpsert(c, outcome.current, { server: true });
    return;
  }
  if (p.superseded) {
    st.pending.delete(id);
    syncIndex(st, id, p.record.rowId, p.record.columnId);
    return;
  }
  const confirmed = st.confirmed.get(id);
  const tomb = st.tombstones.get(id);
  const nextVersion = p.baseVersion + 1;
  const supersede = (): void => {
    st.pending.delete(id);
    syncIndex(st, id, p.record.rowId, p.record.columnId);
  };

  if (outcome.kind === "throw") return rollback(c, p, { reason: "error", error: outcome.error, thrown: true });
  if (outcome.kind === "invalid") return rollback(c, p, { reason: "invalid", thrown: false });

  if (outcome.kind === "rejected") {
    const current = outcome.current;
    if (outcome.reason === "stale") {
      if (current && current.writeId === p.writeId) {
        applyUpsert(c, current, { server: true });
        if (st.pending.get(id) === p) confirmPendingUpsert(c, p, withAlias(st, current), true, false);
        return;
      }
      if (current === null && p.action === "delete") return confirmPendingDelete(c, p, Math.max(nextVersion, confirmed?.version ?? 0), false);
      if (current) {
        st.pending.delete(id);
        applyUpsert(c, current, { server: true });
        st.pending.set(id, p);
        rollback(c, p, { reason: "stale", message: outcome.message, current, thrown: false });
        return;
      }
      if (current === null) {
        st.pending.delete(id);
        const known = st.confirmed.get(id);
        if (known) removeConfirmed(c, id, known.version + 1, undefined, { tombstone: true });
        st.pending.set(id, p);
        rollback(c, p, { reason: "stale", message: outcome.message, current: null, thrown: false });
        return;
      }
      c.out.push({ t: "refetch", rowIds: [p.record.rowId] });
      c.out.push({ t: "warn", message: "a stale rejection without `current` leaves Discard only; return `current` from the save, or set `fetchComments`", unlessFetch: true });
      return rollback(c, p, { reason: "stale", message: outcome.message, thrown: false, discardOnly: true });
    }
    return rollback(c, p, { reason: outcome.reason, message: outcome.message, current: outcome.current, thrown: false });
  }

  const asDelete = p.action === "delete" || (outcome.kind === "record" && outcome.comment === null);
  if (asDelete) {
    if (!confirmed) return supersede();
    if (confirmed.version > nextVersion) return supersede();
    return confirmPendingDelete(c, p, nextVersion, false);
  }

  const server = outcome.kind === "void" ? outcome.server : true;
  if (tomb && !confirmed) return supersede();
  if (outcome.kind === "record" && outcome.comment) {
    const rec = withAlias(st, outcome.comment);
    if (rec.id !== id || rec.rowId !== p.record.rowId || rec.columnId !== p.record.columnId) return rollback(c, p, { reason: "invalid", thrown: false });
    if (confirmed && rec.version < confirmed.version) return supersede();
    if (confirmed && rec.version === confirmed.version && confirmed.writeId !== rec.writeId && !tieWins(st, confirmed, rec, true, false)) return supersede();
    return confirmPendingUpsert(c, p, rec, true, false);
  }
  if (confirmed && confirmed.version > nextVersion) return supersede();
  if (confirmed && confirmed.version === nextVersion && confirmed.writeId !== p.writeId && !tieWins(st, confirmed, p.record, server, false)) return supersede();
  confirmPendingUpsert(c, p, p.record, server, false);
}

function handleLocalWrite(c: Ctx, e: Extract<CommentEvent, { type: "localWrite" }>): boolean {
  const { st } = c;
  const id = e.record.id;
  if (st.pending.has(id)) return false;
  if (e.action === "create") {
    if (st.confirmed.has(id) || st.tombstones.has(id)) return false;
    if (st.confirmed.size + st.pending.size >= st.bounds.maxComments) return false;
    if (cellCount(st, e.record.rowId, e.record.columnId) >= st.bounds.maxCommentsPerCell) return false;
  } else if (!st.confirmed.has(id)) {
    return false;
  }
  st.pending.set(id, {
    writeId: e.change.kind === "upsert" ? (e.change.comment.writeId as string) : (e.change.writeId as string),
    action: e.action,
    baseVersion: e.change.baseVersion ?? 0,
    baseWriteId: e.baseWriteId,
    change: e.change,
    record: e.record,
    superseded: false,
  });
  const conflict = st.conflicts.get(id);
  if (conflict) st.conflicts.delete(id);
  syncIndex(st, id, e.record.rowId, e.record.columnId);
  bump(c, id);
  return true;
}

function handleRemote(c: Ctx, e: Extract<CommentEvent, { type: "remote" }>): ApplyRemoteVerdict {
  const skipped: { index: number; reason: Skip }[] = [];
  let skippedCount = 0;
  let applied = 0;
  const note = (index: number, reason: Skip): void => {
    skippedCount += 1;
    if (skipped.length < MAX_LISTED_SKIPS) skipped.push({ index, reason });
  };
  for (const index of e.invalid) note(index, "invalid");
  for (const { index, change } of e.changes) {
    const result = change.kind === "upsert" ? applyUpsert(c, change.comment, { server: false }) : applyDelete(c, change, { server: false });
    if (result === "applied") applied += 1;
    else note(index, result);
  }
  skipped.sort((a, b) => a.index - b.index);
  return { applied, skippedCount, skipped, truncated: e.truncated };
}

function handleFetchAnswer(c: Ctx, e: Extract<CommentEvent, { type: "fetchAnswer" }>): number {
  const { st } = c;
  const req = st.requests.get(e.requestId);
  if (!req) return 0;
  st.requests.delete(e.requestId);
  for (const row of req.rowIds) if (st.rowRequest.get(row) === e.requestId) st.rowRequest.delete(row);
  if (req.overflow || req.remapped) {
    c.out.push({ t: "refetch", rowIds: Array.from(req.rowIds) });
    return 0;
  }
  let limited = 0;
  for (const record of e.records) {
    if (!req.rowIds.has(record.rowId)) continue;
    const untouched = (st.touched.get(record.id) ?? 0) <= req.startSeq;
    if (applyUpsert(c, record, { server: true, fetchUntouched: untouched }) === "limit") limited += 1;
  }
  for (const row of req.rowIds) {
    const columns = st.index.get(row);
    if (columns) {
      for (const ids of Array.from(columns.values())) {
        for (const id of Array.from(ids)) {
          const rec = st.confirmed.get(id);
          if (!rec || e.rawIds.has(id)) continue;
          if ((st.touched.get(id) ?? 0) > req.startSeq) continue;
          if (st.pending.has(id) || st.conflicts.has(id) || st.drafts.has(editDraftKey(id))) continue;
          const own = st.ownConfirmedAt.get(id);
          if (own !== undefined && c.now - own < OWN_WRITE_GRACE_MS) continue;
          removeConfirmed(c, id, rec.version, undefined, { tombstone: false });
        }
      }
    }
    st.fetchedRows.add(row);
  }
  const cap = Math.max(st.bounds.maxCachedRows * 4, 4000);
  while (st.fetchedRows.size > cap) {
    const oldest = st.fetchedRows.values().next().value;
    if (oldest === undefined) break;
    st.fetchedRows.delete(oldest);
  }
  return limited;
}

function forgetSilently(c: Ctx, id: string): void {
  const { st } = c;
  const rec = st.confirmed.get(id);
  if (!rec) return;
  removeConfirmed(c, id, rec.version, undefined, { tombstone: false, silent: true });
  st.fetchedRows.delete(rec.rowId);
}

function processPropRecord(c: Ctx, raw: CellComment): void {
  const { st } = c;
  const valid = validateComment(raw, st.bounds);
  if (!valid) {
    st.dropped += 1;
    return;
  }
  const rec = withAlias(st, valid);
  st.emitted.delete(rec.id);
  const p = st.pending.get(rec.id);
  if (p && !p.superseded && p.action !== "delete" && rec.writeId !== undefined && rec.writeId === p.writeId && rec.version >= p.baseVersion + 1) {
    confirmPendingUpsert(c, p, rec, true, true);
    st.rawOf.set(rec.id, { valid: rec, raw });
    return;
  }
  const confirmed = st.confirmed.get(rec.id);
  if (confirmed && sameRecord(confirmed, rec)) {
    st.rawOf.set(rec.id, { valid: confirmed, raw });
    return;
  }
  if (!confirmed && st.confirmed.size + st.pending.size >= st.bounds.maxComments) {
    st.dropped += 1;
    return;
  }
  if (!confirmed && cellCount(st, rec.rowId, rec.columnId) >= st.bounds.maxCommentsPerCell) {
    st.dropped += 1;
    return;
  }
  setConfirmed(c, rec, true, true);
  st.rawOf.set(rec.id, { valid: rec, raw });
}

function handlePropChange(c: Ctx, next: readonly CellComment[]): void {
  const { st } = c;
  const nextMap = new Map<string, CellComment>();
  for (const record of next) {
    if (typeof record !== "object" || record === null) {
      st.dropped += 1;
      continue;
    }
    let id: unknown;
    try {
      id = (record as { id?: unknown }).id;
    } catch {
      st.dropped += 1;
      continue;
    }
    if (typeof id === "string" && !nextMap.has(id)) nextMap.set(id, record);
  }
  const previous = st.propRaw;
  st.propRaw = nextMap;
  for (const [id, record] of nextMap) {
    const before = previous.get(id);
    if (before === record) continue;
    if (before && typeof before === "object" && sameRecord(before, record)) continue;
    processPropRecord(c, record);
  }
  for (const id of previous.keys()) {
    if (nextMap.has(id)) continue;
    st.emitted.delete(id);
    st.rawOf.delete(id);
    forgetSilently(c, id);
  }
}

function reconcileEmitted(c: Ctx): void {
  const { st } = c;
  for (const [id, at] of Array.from(st.emitted)) {
    if (c.now - at < EMITTED_MEMORY_MS) continue;
    st.emitted.delete(id);
    const fromProp = st.propRaw.get(id);
    if (!fromProp) {
      forgetSilently(c, id);
      continue;
    }
    const current = st.confirmed.get(id);
    if (!current || !sameRecord(current, fromProp)) processPropRecord(c, fromProp);
  }
}

function handleRemove(c: Ctx, rowIds: readonly string[]): number {
  const { st } = c;
  let removed = 0;
  for (const row of rowIds) {
    st.fetchedRows.delete(row);
    const columns = st.index.get(row);
    if (!columns) continue;
    const ids = Array.from(columns.values()).flatMap((set) => Array.from(set));
    for (const id of ids) {
      const confirmed = st.confirmed.get(id);
      const p = st.pending.get(id);
      const known = confirmed ?? p?.record;
      if (!known) continue;
      const version = Math.max(confirmed?.version ?? 0, (p?.baseVersion ?? 0) + 1);
      st.pending.delete(id);
      if (confirmed) removeConfirmed(c, id, version, undefined, { tombstone: true });
      else {
        addTombstone(c, id, known.rowId, known.columnId, version);
        syncIndex(st, id, known.rowId, known.columnId);
        c.changes.push({ kind: "delete", id, rowId: known.rowId, columnId: known.columnId, version });
        bump(c, id);
      }
      dropCommentUi(st, id);
      st.drafts.delete(newDraftKey(known.rowId, known.columnId));
      removed += 1;
    }
  }
  return removed;
}

function handleEvict(c: Ctx, e: Extract<CommentEvent, { type: "evict" }>): void {
  const { st } = c;
  for (const row of e.rowIds) {
    if (e.keepRows.has(row)) continue;
    const columns = st.index.get(row);
    let blocked = false;
    if (columns) {
      for (const ids of columns.values()) {
        for (const id of ids) {
          if (st.pending.has(id) || st.conflicts.has(id) || st.drafts.has(editDraftKey(id))) blocked = true;
        }
        for (const column of columns.keys()) if (st.drafts.has(newDraftKey(row, column))) blocked = true;
      }
    }
    if (blocked) continue;
    if (columns) {
      for (const id of Array.from(columns.values()).flatMap((set) => Array.from(set))) {
        const rec = st.confirmed.get(id);
        if (rec) removeConfirmed(c, id, rec.version, undefined, { tombstone: false, silent: true });
      }
    }
    st.fetchedRows.delete(row);
  }
}

function handleIdSwap(c: Ctx, map: ReadonlyMap<string, string>): void {
  const { st } = c;
  for (const [oldId, newId] of map) {
    if (oldId === newId) continue;
    st.aliases.set(oldId, newId);
    while (st.aliases.size > MAX_ALIASES) {
      const oldest = st.aliases.keys().next().value;
      if (oldest === undefined) break;
      st.aliases.delete(oldest);
    }
    const columns = st.index.get(oldId);
    const ids = columns ? Array.from(columns.values()).flatMap((set) => Array.from(set)) : [];
    for (const id of ids) {
      const confirmed = st.confirmed.get(id);
      if (confirmed) {
        const moved = Object.freeze({ ...confirmed, rowId: newId });
        indexRemove(st, id, oldId, confirmed.columnId);
        st.confirmed.set(id, moved);
        indexAdd(st, id, newId, moved.columnId);
        st.rawOf.delete(id);
        c.changes.push({ kind: "upsert", comment: moved });
        bump(c, id);
      }
      const p = st.pending.get(id);
      if (p) {
        const record = Object.freeze({ ...p.record, rowId: newId });
        const change: CommentChange = p.change.kind === "upsert" ? { ...p.change, comment: record } : { ...p.change, rowId: newId };
        st.pending.set(id, { ...p, record, change });
        if (!confirmed) {
          indexRemove(st, id, oldId, p.record.columnId);
          indexAdd(st, id, newId, record.columnId);
        }
      }
      const conflict = st.conflicts.get(id);
      if (conflict) st.conflicts.set(id, { ...conflict, rowId: newId });
      const draft = st.drafts.get(editDraftKey(id));
      if (draft) draft.rowId = newId;
    }
    if (columns) {
      for (const column of columns.keys()) {
        const key = newDraftKey(oldId, column);
        const draft = st.drafts.get(key);
        if (draft) {
          st.drafts.delete(key);
          putDraft(st, { ...draft, key: newDraftKey(newId, column), rowId: newId });
        }
      }
    }
    for (const [id, tomb] of st.tombstones) if (tomb.rowId === oldId) st.tombstones.set(id, { ...tomb, rowId: newId });
    if (st.fetchedRows.delete(oldId)) st.fetchedRows.add(newId);
    const requestId = st.rowRequest.get(oldId);
    if (requestId !== undefined) {
      const req = st.requests.get(requestId);
      if (req) req.remapped = true;
    }
  }
}

/** Applies one event to the state. The reducer mutates `st` in place (copying 100k records per event would break the cost budget) and is deterministic: time and ids arrive in the event. */
export function reduce(st: CommentsState, event: CommentEvent): ReduceResult {
  const out: Emit[] = [];
  const c: Ctx = { st, out, changes: [], now: "now" in event ? event.now : 0 };
  switch (event.type) {
    case "localWrite": {
      const ok = handleLocalWrite(c, event);
      return { emits: out, ok };
    }
    case "ack":
      handleAck(c, event.id, event.writeId, event.outcome);
      finish(c, "ack");
      return { emits: out };
    case "remote": {
      const verdict = handleRemote(c, event);
      finish(c, "remote");
      return { emits: out, verdict };
    }
    case "fetchStart": {
      const rowIds = new Set(event.rowIds);
      st.requests.set(event.requestId, { rowIds, startSeq: st.seq, overflow: false, remapped: false, log: 0 });
      for (const row of rowIds) st.rowRequest.set(row, event.requestId);
      return { emits: out };
    }
    case "fetchAnswer": {
      const limited = handleFetchAnswer(c, event);
      finish(c, "fetch");
      return { emits: out, limited };
    }
    case "fetchFail": {
      const req = st.requests.get(event.requestId);
      if (req) {
        st.requests.delete(event.requestId);
        for (const row of req.rowIds) if (st.rowRequest.get(row) === event.requestId) st.rowRequest.delete(row);
      }
      return { emits: out };
    }
    case "propChange":
      handlePropChange(c, event.next);
      return { emits: out };
    case "remove": {
      const removed = handleRemove(c, event.rowIds);
      finish(c, "remove");
      return { emits: out, removed };
    }
    case "evict":
      handleEvict(c, event);
      return { emits: out };
    case "idSwap":
      handleIdSwap(c, event.map);
      finish(c, "id-swap");
      return { emits: out };
    case "invalidateRows": {
      if (event.rowIds === null) st.fetchedRows.clear();
      else for (const row of event.rowIds) st.fetchedRows.delete(row);
      for (const req of st.requests.values()) {
        if (event.rowIds === null || event.rowIds.some((row) => req.rowIds.has(row))) req.remapped = true;
      }
      return { emits: out };
    }
    case "expire": {
      for (const [id, tomb] of st.tombstones) if (tomb.expiresAt <= event.now) st.tombstones.delete(id);
      for (const [id, at] of st.ownConfirmedAt) if (event.now - at >= OWN_WRITE_GRACE_MS) st.ownConfirmedAt.delete(id);
      if (st.controlled) reconcileEmitted(c);
      return { emits: out };
    }
  }
}

/** The confirmed records as `next` for `onCommentsChange`; records the add-on did not change keep the app's original objects. */
