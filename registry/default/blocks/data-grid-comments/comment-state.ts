import type {
  ApplyRemoteSkipReason,
  ApplyRemoteVerdict,
  CellComment,
  CommentAction,
  CommentChange,
  CommentRejectedCtx,
  CommentRejectReason,
  CommentSaveRejectReason,
  CommentSource,
} from "./types";
import type { Bounds } from "./validate";

export const TOMBSTONE_TTL_MS = 10 * 60_000;
export const MAX_TOMBSTONES = 10_000;
export const MAX_REMOTE_BATCH = 10_000;
export const MAX_ALIASES = 10_000;
export const MAX_DRAFTS = 50;
export const MAX_FETCH_LOG = 1000;
export const OWN_WRITE_GRACE_MS = 30_000;
export const EMITTED_MEMORY_MS = 30_000;
export const MAX_EMITTED = 10_000;
export const MAX_LISTED_SKIPS = 100;

export type Pending = {
  writeId: string;
  action: CommentAction;
  baseVersion: number;
  baseWriteId: string | undefined;
  change: CommentChange;
  /** The optimistic record shown while saving; the confirmed record for a delete. */
  record: CellComment;
  superseded: boolean;
};

export type Conflict = {
  id: string;
  rowId: string;
  columnId: string;
  action: CommentAction;
  reason: CommentRejectReason;
  message?: string;
  writeId: string;
  baseVersion: number;
  baseWriteId: string | undefined;
  change: CommentChange;
  record: CellComment;
  /** The write's outcome is unknown: an echo of `writeId` still confirms it. */
  thrown: boolean;
  /** The text the user had submitted. */
  text?: string;
  /** Version of the record the conflict UI shows; "Save my version" writes on top of it. */
  shownVersion: number;
  /** A stale answer without `current`: nothing but Discard is offered. */
  discardOnly: boolean;
};

export type Draft = {
  key: string;
  kind: "new" | "edit";
  commentId?: string;
  rowId: string;
  columnId: string;
  text: string;
  baseVersion: number;
  baseWriteId: string | undefined;
};

export type Tombstone = { id: string; rowId: string; columnId: string; version: number; expiresAt: number };

export type FetchRequest = { rowIds: Set<string>; startSeq: number; overflow: boolean; remapped: boolean; log: number };

export type CommentsState = {
  bounds: Bounds;
  controlled: boolean;
  confirmed: Map<string, CellComment>;
  serverConfirmed: Map<string, number>;
  tombstones: Map<string, Tombstone>;
  pending: Map<string, Pending>;
  conflicts: Map<string, Conflict>;
  drafts: Map<string, Draft>;
  index: Map<string, Map<string, Set<string>>>;
  touched: Map<string, number>;
  ownConfirmedAt: Map<string, number>;
  seq: number;
  aliases: Map<string, string>;
  requests: Map<number, FetchRequest>;
  rowRequest: Map<string, number>;
  fetchedRows: Set<string>;
  propRaw: Map<string, CellComment>;
  rawOf: Map<string, { valid: CellComment; raw: CellComment }>;
  emitted: Map<string, number>;
  /** Count of prop or seed records dropped by validation or a bound, for the development warning. */
  dropped: number;
};

export type Emit =
  | { t: "change"; changes: CommentChange[]; source: CommentSource }
  | { t: "local"; change: CommentChange }
  | { t: "rejected"; ctx: CommentRejectedCtx }
  | { t: "refetch"; rowIds: string[] }
  | { t: "warn"; message: string };

export type AckOutcome =
  | { kind: "void"; server: boolean }
  | { kind: "record"; comment: CellComment | null }
  | { kind: "rejected"; reason: CommentSaveRejectReason; message?: string; current?: CellComment | null }
  | { kind: "throw"; error: unknown }
  | { kind: "invalid" };

export type CommentEvent =
  | { type: "localWrite"; action: CommentAction; change: CommentChange; record: CellComment; baseWriteId: string | undefined; now: number }
  | { type: "ack"; id: string; writeId: string; outcome: AckOutcome; now: number }
  | { type: "remote"; changes: readonly { index: number; change: CommentChange }[]; invalid: readonly number[]; truncated: number; now: number }
  | { type: "fetchStart"; requestId: number; rowIds: readonly string[] }
  | { type: "fetchAnswer"; requestId: number; records: readonly CellComment[]; rawIds: ReadonlySet<string>; now: number }
  | { type: "fetchFail"; requestId: number }
  | { type: "propChange"; next: readonly CellComment[]; now: number }
  | { type: "remove"; rowIds: readonly string[]; now: number }
  | { type: "evict"; rowIds: readonly string[]; keepRows: ReadonlySet<string> }
  | { type: "idSwap"; map: ReadonlyMap<string, string> }
  | { type: "invalidateRows"; rowIds: readonly string[] | null }
  | { type: "expire"; now: number };

export type ReduceResult = { emits: Emit[]; verdict?: ApplyRemoteVerdict; ok?: boolean; removed?: number; limited?: number };

export type Ctx = { st: CommentsState; out: Emit[]; changes: CommentChange[]; now: number };
export type Skip = ApplyRemoteSkipReason;

export function createCommentsState(bounds: Bounds, controlled: boolean): CommentsState {
  return {
    bounds,
    controlled,
    confirmed: new Map(),
    serverConfirmed: new Map(),
    tombstones: new Map(),
    pending: new Map(),
    conflicts: new Map(),
    drafts: new Map(),
    index: new Map(),
    touched: new Map(),
    ownConfirmedAt: new Map(),
    seq: 0,
    aliases: new Map(),
    requests: new Map(),
    rowRequest: new Map(),
    fetchedRows: new Set(),
    propRaw: new Map(),
    rawOf: new Map(),
    emitted: new Map(),
    dropped: 0,
  };
}

export const newDraftKey = (rowId: string, columnId: string): string => `n\u0001${rowId}\u0001${columnId}`;
export const editDraftKey = (id: string): string => `e\u0001${id}`;

export function sameAuthor(a: CellComment["author"] | undefined, b: CellComment["author"] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.name === b.name && a.color === b.color;
}

/** Equality over every typed field of a record. */
export function sameRecord(a: CellComment, b: CellComment): boolean {
  return (
    a === b ||
    (a.id === b.id &&
      a.rowId === b.rowId &&
      a.columnId === b.columnId &&
      a.text === b.text &&
      a.version === b.version &&
      a.writeId === b.writeId &&
      a.createdAt === b.createdAt &&
      a.updatedAt === b.updatedAt &&
      a.resolved === b.resolved &&
      a.resolvedAt === b.resolvedAt &&
      sameAuthor(a.author, b.author) &&
      sameAuthor(a.resolvedBy, b.resolvedBy))
  );
}

/** Orders the comments of one cell: `(createdAt, id)` ascending. */
export function compareComments(a: CellComment, b: CellComment): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The record the UI shows for an id: the optimistic record of a live pending write, else the confirmed record. */
export function displayRecord(st: CommentsState, id: string): CellComment | undefined {
  const p = st.pending.get(id);
  if (p && !p.superseded) return p.record;
  return st.confirmed.get(id);
}

/** The comments of one cell in display order, with their saving flag. */
export function cellComments(st: CommentsState, rowId: string, columnId: string): { comment: CellComment; saving: boolean }[] {
  const ids = st.index.get(rowId)?.get(columnId);
  if (!ids) return [];
  const list: { comment: CellComment; saving: boolean }[] = [];
  for (const id of ids) {
    const comment = displayRecord(st, id);
    if (comment) list.push({ comment, saving: st.pending.get(id)?.superseded === false });
  }
  return list.sort((x, y) => compareComments(x.comment, y.comment));
}

export function bump(c: Ctx, id: string): void {
  if (c.st.touched.size > 50_000 && c.st.requests.size === 0) c.st.touched.clear();
  c.st.seq += 1;
  c.st.touched.set(id, c.st.seq);
}

export function indexAdd(st: CommentsState, id: string, rowId: string, columnId: string): void {
  let columns = st.index.get(rowId);
  if (!columns) st.index.set(rowId, (columns = new Map<string, Set<string>>()));
  let ids = columns.get(columnId);
  if (!ids) columns.set(columnId, (ids = new Set<string>()));
  ids.add(id);
}

export function indexRemove(st: CommentsState, id: string, rowId: string, columnId: string): void {
  const columns = st.index.get(rowId);
  const ids = columns?.get(columnId);
  if (!columns || !ids) return;
  ids.delete(id);
  if (ids.size === 0) columns.delete(columnId);
  if (columns.size === 0) st.index.delete(rowId);
}

export function syncIndex(st: CommentsState, id: string, rowId: string, columnId: string): void {
  if (st.confirmed.has(id) || st.pending.has(id)) indexAdd(st, id, rowId, columnId);
  else indexRemove(st, id, rowId, columnId);
}

export function resolveAlias(st: CommentsState, rowId: string): string {
  let current = rowId;
  for (let hop = 0; hop < 5; hop += 1) {
    const next = st.aliases.get(current);
    if (next === undefined) break;
    current = next;
  }
  return current;
}

export function withAlias(st: CommentsState, rec: CellComment): CellComment {
  const rowId = resolveAlias(st, rec.rowId);
  return rowId === rec.rowId ? rec : Object.freeze({ ...rec, rowId });
}

export function changeAlias(st: CommentsState, change: CommentChange): CommentChange {
  if (change.kind === "upsert") {
    const comment = withAlias(st, change.comment);
    return comment === change.comment ? change : Object.freeze({ ...change, comment });
  }
  const rowId = resolveAlias(st, change.rowId);
  return rowId === change.rowId ? change : Object.freeze({ ...change, rowId });
}

export function addrOf(st: CommentsState, id: string): { rowId: string; columnId: string } | undefined {
  const c = st.confirmed.get(id);
  if (c) return c;
  const t = st.tombstones.get(id);
  if (t) return t;
  const p = st.pending.get(id);
  return p?.record;
}

export function cellCount(st: CommentsState, rowId: string, columnId: string): number {
  return st.index.get(rowId)?.get(columnId)?.size ?? 0;
}

export function noteRowActivity(st: CommentsState, rowId: string): void {
  const requestId = st.rowRequest.get(rowId);
  if (requestId === undefined) return;
  const req = st.requests.get(requestId);
  if (!req) return;
  req.log += 1;
  if (req.log > MAX_FETCH_LOG) req.overflow = true;
}

export function addTombstone(c: Ctx, id: string, rowId: string, columnId: string, version: number): void {
  const { st } = c;
  const prior = st.tombstones.get(id);
  st.tombstones.delete(id);
  st.tombstones.set(id, { id, rowId, columnId, version: Math.max(version, prior?.version ?? 0), expiresAt: c.now + TOMBSTONE_TTL_MS });
  while (st.tombstones.size > MAX_TOMBSTONES) {
    const oldest = st.tombstones.keys().next().value;
    if (oldest === undefined) break;
    st.tombstones.delete(oldest);
  }
}

export function markEmitted(c: Ctx, id: string): void {
  if (!c.st.controlled) return;
  c.st.emitted.delete(id);
  c.st.emitted.set(id, c.now);
  while (c.st.emitted.size > MAX_EMITTED) {
    const oldest = c.st.emitted.keys().next().value;
    if (oldest === undefined) break;
    c.st.emitted.delete(oldest);
  }
}

export function setConfirmed(c: Ctx, rec: CellComment, server: boolean, silent = false): void {
  const { st } = c;
  const prev = st.confirmed.get(rec.id);
  if (prev && (prev.rowId !== rec.rowId || prev.columnId !== rec.columnId)) indexRemove(st, rec.id, prev.rowId, prev.columnId);
  st.confirmed.set(rec.id, rec);
  st.ownConfirmedAt.delete(rec.id);
  if (server) st.serverConfirmed.set(rec.id, rec.version);
  else st.serverConfirmed.delete(rec.id);
  const tomb = st.tombstones.get(rec.id);
  if (tomb && rec.version > tomb.version) st.tombstones.delete(rec.id);
  syncIndex(st, rec.id, rec.rowId, rec.columnId);
  bump(c, rec.id);
  noteRowActivity(st, rec.rowId);
  if (!silent) {
    c.changes.push({ kind: "upsert", comment: rec });
    markEmitted(c, rec.id);
  }
}

export function removeConfirmed(c: Ctx, id: string, version: number, writeId: string | undefined, opts: { tombstone: boolean; silent?: boolean }): void {
  const { st } = c;
  const prev = st.confirmed.get(id);
  if (!prev) return;
  st.confirmed.delete(id);
  st.serverConfirmed.delete(id);
  st.rawOf.delete(id);
  syncIndex(st, id, prev.rowId, prev.columnId);
  bump(c, id);
  noteRowActivity(st, prev.rowId);
  if (opts.tombstone) addTombstone(c, id, prev.rowId, prev.columnId, version);
  if (!opts.silent) {
    const change: CommentChange = { kind: "delete", id, rowId: prev.rowId, columnId: prev.columnId, version };
    if (writeId !== undefined) change.writeId = writeId;
    c.changes.push(change);
    markEmitted(c, id);
  }
}

/** Sets or replaces a draft (the composer, an edit). The least recently edited of more than 50 drafts is dropped. */
export function putDraft(st: CommentsState, draft: Draft): void {
  st.drafts.delete(draft.key);
  st.drafts.set(draft.key, draft);
  while (st.drafts.size > MAX_DRAFTS) {
    const oldest = st.drafts.keys().next().value;
    if (oldest === undefined) break;
    st.drafts.delete(oldest);
  }
}

export function discardDraft(st: CommentsState, key: string): void {
  st.drafts.delete(key);
}

export function setConflict(st: CommentsState, conflict: Conflict): void {
  st.conflicts.delete(conflict.id);
  st.conflicts.set(conflict.id, conflict);
  while (st.conflicts.size > MAX_DRAFTS) {
    const oldest = st.conflicts.keys().next().value;
    if (oldest === undefined) break;
    st.conflicts.delete(oldest);
  }
}

export function discardConflict(st: CommentsState, id: string): void {
  st.conflicts.delete(id);
}

/** Moves the text of an open edit draft or conflict to the new-comment draft of the cell, so a deleted comment never takes typed text with it. */
export function keepDraftText(st: CommentsState, id: string, rowId: string, columnId: string): void {
  const text = st.drafts.get(editDraftKey(id))?.text ?? st.conflicts.get(id)?.text;
  const key = newDraftKey(rowId, columnId);
  if (text && !st.drafts.has(key)) putDraft(st, { key, kind: "new", rowId, columnId, text, baseVersion: 0, baseWriteId: undefined });
}

export function dropCommentUi(st: CommentsState, id: string): void {
  st.conflicts.delete(id);
  st.drafts.delete(editDraftKey(id));
}

export function rebaseDraft(st: CommentsState, p: Pending, confirmed: CellComment): void {
  const draft = st.drafts.get(editDraftKey(p.change.kind === "upsert" ? p.change.comment.id : (p.change as { id: string }).id));
  if (draft && draft.baseVersion === p.baseVersion && draft.baseWriteId === p.baseWriteId && confirmed.version === p.baseVersion + 1) {
    draft.baseVersion = confirmed.version;
    draft.baseWriteId = confirmed.writeId;
  }
}

/** The confirmed records; a record the add-on never changed keeps the app object it came from. */
export function confirmedSnapshot(st: CommentsState): CellComment[] {
  const list: CellComment[] = [];
  for (const [id, record] of st.confirmed) {
    const origin = st.rawOf.get(id);
    list.push(origin && origin.valid === record ? origin.raw : record);
  }
  return list;
}
