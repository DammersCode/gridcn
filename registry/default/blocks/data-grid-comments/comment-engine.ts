import { isDev, isThenable } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import {
  cellComments,
  confirmedSnapshot,
  discardConflict,
  discardDraft,
  editDraftKey,
  MAX_REMOTE_BATCH,
  newDraftKey,
  putDraft,
  type AckOutcome,
  type Conflict,
  type Draft,
  type Emit,
} from "./comment-state";
import { createFetchScheduler } from "./comment-fetch";
import { defaultCanModify, authorLabelName } from "./default-gate";
import { createCommentStore, type CommentStore } from "./comment-store";
import { createWriteIdGenerator, defaultCreateId } from "./create-id";
import { resolveCommentsLabels } from "./labels";
import type {
  ApplyRemoteVerdict,
  CellComment,
  CommentAction,
  CommentAuthor,
  CommentChange,
  CommentRejectedCtx,
  CommentRejectReason,
  OrphanedCommentsCtx,
  UseDataGridCommentsOptions,
} from "./types";
import { cleanText, isSafeId, parseSaveAnswer, resolveBounds, validateAuthor, validateChange, type Bounds } from "./validate";

const MAX_BUSY_ROWS = 10_000;
const EXPIRE_INTERVAL_MS = 60_000;

/** What the engine needs to know about the grid it is mounted in; the Mount component supplies it. */
export type GridAdapter = {
  readOnly(): boolean;
  /** `"saving"` while the row's `onSave` promise is pending. */
  saveStatus(rowId: string): string | undefined;
  /** Scrolls to the cell, makes it active, and opens the popover once the cell renders; `false` for a hole, a filtered-out row, or a hidden column. */
  open(ref: { rowId: string; columnId: string }, by: "keyboard" | "pointer" | "menu"): boolean;
};

/** The writer: none (anonymous), a valid user, or a present but invalid `currentUser`. */
export type CommentUserState = { kind: "anonymous" } | { kind: "user"; user: CommentAuthor } | { kind: "invalid" };

export type WriteResult =
  | { ok: true; settled: Promise<void> }
  | { ok: false; reason: CommentRejectReason | "pending" };

export type WriteBase = { version: number; writeId: string | undefined };

type WriteSpec = {
  action: CommentAction;
  rowId: string;
  columnId: string;
  id?: string;
  text?: string;
  base?: WriteBase;
  reuse?: Conflict;
  forceBase?: number;
};

export type CommentEngine = {
  store: CommentStore;
  attachGrid(adapter: GridAdapter | null): () => void;
  bounds(): Bounds;
  applyRemote(changes: readonly CommentChange[]): ApplyRemoteVerdict;
  getComments(): readonly CellComment[];
  removeComments(rowIds: readonly string[]): number;
  refetch(rowIds?: readonly string[]): void;
  syncProp(next: readonly CellComment[]): void;
  create(input: { rowId: string; columnId: string; text: string }): Promise<WriteResult>;
  edit(id: string, text: string, base?: WriteBase): Promise<WriteResult>;
  remove(id: string, base?: WriteBase): Promise<WriteResult>;
  setResolved(id: string, resolved: boolean, base?: WriteBase): Promise<WriteResult>;
  retry(id: string, text?: string): Promise<WriteResult>;
  saveMine(id: string, text: string): Promise<WriteResult>;
  discard(id: string): void;
  setDraft(draft: Omit<Draft, "key"> & { key?: string }): void;
  discardDraft(key: string): void;
  isRowBusy(rowId: string): boolean;
  fetchState(rowId: string): "idle" | "loading" | "failed" | "ready";
  retryFetch(rowId: string): void;
  observeDataChange(next: readonly unknown[], change: DataChange<unknown>, ctx: { getRowId(row: unknown, index: number): string }): void;
  kickFetch(): void;
  noteRowsRendered(rowIds: readonly string[]): void;
  currentUser(): CommentUserState;
  isDisposed(): boolean;
  openComments(ref: { rowId: string; columnId: string }, by?: "keyboard" | "pointer" | "menu"): boolean;
  start(): void;
  dispose(): void;
};

export type EngineConfig = {
  getOptions(): UseDataGridCommentsOptions;
  now?: () => number;
  initialComments?: readonly CellComment[];
  controlled: boolean;
};

function createWarnOnce(): (key: string, message: string) => void {
  const warned = new Set<string>();
  return (key, message) => {
    if (!isDev() || warned.has(key)) return;
    warned.add(key);
    console.warn(`[data-grid-comments] ${message}`);
  };
}

function callSafely(fn: () => void): void {
  try {
    fn();
  } catch (error) {
    if (isDev()) console.error("[data-grid-comments] a callback threw", error);
  }
}

export function createCommentEngine(config: EngineConfig): CommentEngine {
  const now = config.now ?? (() => Date.now());
  const optionsOf = (): UseDataGridCommentsOptions => config.getOptions();
  const initial = optionsOf();
  let bounds = resolveBounds(initial);
  const store = createCommentStore(bounds, config.controlled);
  const core = store.core;
  const nextWriteId = createWriteIdGenerator();
  const warnOnce = createWarnOnce();
  let grid: GridAdapter | null = null;
  let disposed = false;
  const busyRows = new Set<string>();
  const gateControllers = new Map<string, AbortController>();

  const refreshBounds = (): Bounds => {
    const next = resolveBounds(optionsOf());
    if (next.maxTextLength !== bounds.maxTextLength || next.maxCommentsPerCell !== bounds.maxCommentsPerCell || next.maxComments !== bounds.maxComments || next.maxCachedRows !== bounds.maxCachedRows) {
      bounds = next;
      core.bounds = next;
    }
    return bounds;
  };

  // --- callbacks --------------------------------------------------------------------------------

  const queue: Emit[] = [];
  let firing = false;

  const handleEmit = (emit: Emit): void => {
    const o = optionsOf();
    switch (emit.t) {
      case "change": {
        noteRemoteAdded(emit);
        if (o.onCommentsChange) {
          const handler = o.onCommentsChange;
          const next = confirmedSnapshot(core);
          callSafely(() => handler(next, { changes: emit.changes, source: emit.source }));
        }
        return;
      }
      case "local":
        if (o.onLocalChange) {
          const handler = o.onLocalChange;
          callSafely(() => handler(emit.change));
        }
        return;
      case "rejected":
        if (o.onCommentRejected) {
          const handler = o.onCommentRejected;
          callSafely(() => handler(emit.ctx));
        }
        return;
      case "refetch":
        fetcher.clearFailed(emit.rowIds);
        fetcher.schedule();
        return;
      case "warn":
        if (!(emit.unlessFetch && o.fetchComments)) warnOnce(emit.message, emit.message);
    }
  };

  const fire = (emits: readonly Emit[]): void => {
    queue.push(...emits);
    if (firing) return;
    firing = true;
    try {
      for (let emit = queue.shift(); emit !== undefined; emit = queue.shift()) handleEmit(emit);
    } finally {
      firing = false;
    }
  };

  function noteRemoteAdded(emit: Extract<Emit, { t: "change" }>): void {
    if (emit.source !== "remote" && emit.source !== "fetch") return;
    const open = store.ui.getState().open;
    if (!open) return;
    for (const change of emit.changes) {
      if (change.kind !== "upsert") continue;
      const c = change.comment;
      if (c.rowId !== open.rowId || c.columnId !== open.columnId) continue;
      if (c.version !== 1) continue;
      const labels = resolveCommentsLabels(optionsOf().labels);
      store.announce(labels.announceAdded(authorLabelName(c.author, labels.unknownAuthor)));
      return;
    }
  }

  const dispatch = (event: Parameters<CommentStore["dispatch"]>[0]) => {
    const result = store.dispatch(event);
    fire(result.emits);
    return result;
  };

  // --- seed and prop ----------------------------------------------------------------------------

  if (config.initialComments && config.initialComments.length > 0) {
    dispatch({ type: "propChange", next: config.initialComments, now: 0 });
    if (!config.controlled) {
      core.propRaw = new Map();
      core.rawOf = new Map();
    }
    if (core.dropped > 0) warnOnce("seed-dropped", `${core.dropped} seed record(s) were dropped (invalid or over a bound)`);
  }

  let expireTimer: ReturnType<typeof setInterval> | null = null;
  const startExpire = (): void => {
    if (expireTimer !== null || typeof setInterval === "undefined") return;
    expireTimer = setInterval(() => dispatch({ type: "expire", now: now() }), EXPIRE_INTERVAL_MS);
  };

  // --- busy rows --------------------------------------------------------------------------------

  function isBusy(rowId: string): boolean {
    if (!busyRows.has(rowId)) return false;
    if (grid?.saveStatus(rowId) === "saving") return true;
    busyRows.delete(rowId);
    return false;
  }

  const fetcher = createFetchScheduler({
    store,
    controlled: config.controlled,
    now,
    optionsOf,
    dispatch,
    refreshBounds,
    isBusy,
    isDisposed: () => disposed,
    warn: warnOnce,
    callSafely,
  });
  store.onVisibleChange = fetcher.onVisibleChange;

  // --- writes -----------------------------------------------------------------------------------

  function userState(): CommentUserState {
    const user = optionsOf().currentUser;
    if (user === undefined) return { kind: "anonymous" };
    const valid = validateAuthor(user);
    if (valid) return { kind: "user", user: valid };
    warnOnce("invalid-user", "`currentUser` is present but invalid (`id` must be 1..128 characters without control characters); every comment write is refused");
    return { kind: "invalid" };
  }

  const userOf = (state: CommentUserState): CommentAuthor | undefined => (state.kind === "user" ? state.user : undefined);

  function writeIsBlocked(rowId: string): CommentRejectReason | null {
    const o = optionsOf();
    if (o.readOnly === true) return "read-only";
    if (grid?.readOnly() && !o.allowWhenReadOnly) return "read-only";
    if (userState().kind === "invalid") return "invalid";
    if (isBusy(rowId)) return "row-busy";
    return null;
  }

  function rejectBeforeWrite(action: CommentAction, reason: CommentRejectReason, change?: CommentChange, message?: string): WriteResult {
    const handler = optionsOf().onCommentRejected;
    if (handler) {
      const ctx: CommentRejectedCtx = { action, reason };
      if (change) ctx.change = change;
      if (message) ctx.message = message;
      callSafely(() => handler(ctx));
    }
    return { ok: false, reason };
  }

  const gateKey = (spec: WriteSpec): string => spec.id ?? newDraftKey(spec.rowId, spec.columnId);

  async function runGate(spec: WriteSpec, user: CommentAuthor | undefined, prev: CellComment | undefined): Promise<boolean | "error" | "superseded"> {
    const o = optionsOf();
    const key = gateKey(spec);
    gateControllers.get(key)?.abort();
    const controller = new AbortController();
    gateControllers.set(key, controller);
    try {
      let verdict: boolean | Promise<boolean>;
      if (spec.action === "create") {
        verdict = o.canCreate ? o.canCreate({ rowId: spec.rowId, columnId: spec.columnId, user, signal: controller.signal }) : true;
      } else {
        const comment = prev as CellComment;
        if (spec.action === "update" || spec.action === "delete") {
          const gate = spec.action === "update" ? o.canEdit : o.canDelete;
          verdict = gate ? gate({ comment, action: spec.action, user, signal: controller.signal }) : defaultCanModify(comment, user);
        } else {
          verdict = o.canResolve ? o.canResolve({ comment, action: spec.action, user, signal: controller.signal }) : true;
        }
      }
      const result = isThenable(verdict) ? await verdict : verdict;
      if (controller.signal.aborted) return disposed ? false : "superseded";
      return result === true;
    } catch {
      return "error";
    } finally {
      if (gateControllers.get(key) === controller) gateControllers.delete(key);
    }
  }

  async function execute(spec: WriteSpec): Promise<WriteResult> {
    const o = optionsOf();
    refreshBounds();
    const prev = spec.id ? core.confirmed.get(spec.id) : undefined;
    if (spec.action !== "create" && !prev) return { ok: false, reason: "invalid" };
    if (spec.id && core.pending.has(spec.id)) return { ok: false, reason: "pending" };
    const blocked = writeIsBlocked(spec.rowId);
    if (blocked) return rejectBeforeWrite(spec.action, blocked);
    if ((spec.action === "resolve" || spec.action === "reopen") && o.enableResolve === false) return rejectBeforeWrite(spec.action, "forbidden");
    const user = userOf(userState());

    let id = spec.id;
    if (spec.action === "create") {
      try {
        id = spec.reuse ? spec.reuse.id : (o.createId ?? defaultCreateId)();
      } catch {
        return rejectBeforeWrite("create", "error");
      }
      if (!isSafeId(id) || core.confirmed.has(id) || core.tombstones.has(id) || core.pending.has(id)) return rejectBeforeWrite("create", "invalid");
    }
    const commentId = id as string;

    let text: string | undefined;
    if (spec.text !== undefined) {
      if (spec.text.length > bounds.maxTextLength * 4) return rejectBeforeWrite(spec.action, "limit");
      let normalized = spec.text;
      if (o.normalizeText) {
        try {
          normalized = o.normalizeText(spec.text);
        } catch {
          return rejectBeforeWrite(spec.action, "error");
        }
      }
      text = cleanText(normalized);
      if (text.length < 1) return rejectBeforeWrite(spec.action, "invalid");
      if (text.length > bounds.maxTextLength) return rejectBeforeWrite(spec.action, "limit");
    }

    const verdict = await runGate({ ...spec, id: spec.action === "create" ? undefined : commentId }, user, prev);
    if (disposed) return { ok: false, reason: "error" };
    if (verdict === "superseded") return { ok: false, reason: "pending" };
    if (verdict === "error") return rejectBeforeWrite(spec.action, "error");
    if (verdict === false) return rejectBeforeWrite(spec.action, "forbidden");

    // after the await: re-read the store and re-check
    const blockedLate = writeIsBlocked(spec.rowId);
    if (blockedLate) return rejectBeforeWrite(spec.action, blockedLate);
    const userNow = userOf(userState());
    const confirmedNow = core.confirmed.get(commentId);
    if (spec.action !== "create" && !confirmedNow) return rejectBeforeWrite(spec.action, "invalid");
    if (core.pending.has(commentId)) return { ok: false, reason: "pending" };
    if (spec.action === "create" && (core.confirmed.has(commentId) || core.tombstones.has(commentId))) return rejectBeforeWrite("create", "invalid");

    const ts = now();
    const writeId = spec.reuse ? spec.reuse.writeId : nextWriteId();
    const baseVersion = spec.reuse ? spec.reuse.baseVersion : (spec.forceBase ?? confirmedNow?.version ?? 0);
    const base = confirmedNow;
    let record: CellComment;
    let change: CommentChange;
    if (spec.reuse) {
      record = spec.reuse.record;
      change = spec.reuse.change;
    } else if (spec.action === "create") {
      record = Object.freeze({ id: commentId, rowId: spec.rowId, columnId: spec.columnId, text: text as string, ...(userNow ? { author: userNow } : {}), createdAt: ts, updatedAt: ts, version: 1, writeId, resolved: false });
      change = Object.freeze({ kind: "upsert" as const, comment: record, baseVersion: 0 });
    } else if (spec.action === "delete") {
      record = base as CellComment;
      change = Object.freeze({ kind: "delete" as const, id: commentId, rowId: record.rowId, columnId: record.columnId, version: baseVersion + 1, writeId, baseVersion });
    } else {
      const source = base as CellComment;
      const next: CellComment = { ...source, updatedAt: ts, version: baseVersion + 1, writeId };
      if (spec.action === "update") next.text = text as string;
      else if (spec.action === "resolve") {
        next.resolved = true;
        if (userNow) next.resolvedBy = userNow;
        else delete next.resolvedBy;
        next.resolvedAt = ts;
      } else {
        next.resolved = false;
        delete next.resolvedBy;
        delete next.resolvedAt;
      }
      record = Object.freeze(next);
      change = Object.freeze({ kind: "upsert" as const, comment: record, baseVersion });
    }

    // the draft base against the confirmed record: a mismatch is a stale conflict, never an overwrite
    if (spec.base && base && !spec.reuse && (spec.base.version !== base.version || spec.base.writeId !== base.writeId)) {
      const stale: Conflict = {
        id: commentId,
        rowId: record.rowId,
        columnId: record.columnId,
        action: spec.action,
        reason: "stale",
        writeId,
        baseVersion,
        baseWriteId: base.writeId,
        change,
        record,
        thrown: false,
        text: spec.action === "update" ? text : undefined,
        shownVersion: base.version,
        discardOnly: false,
      };
      core.conflicts.set(commentId, stale);
      if (text !== undefined && spec.action === "update") {
        putDraft(core, { key: editDraftKey(commentId), kind: "edit", commentId, rowId: record.rowId, columnId: record.columnId, text, baseVersion: spec.base.version, baseWriteId: spec.base.writeId });
      }
      store.bumpDrafts();
      return rejectBeforeWrite(spec.action, "stale", change);
    }

    const applied = dispatch({ type: "localWrite", action: spec.action, change, record, baseWriteId: base?.writeId, now: ts });
    if (!applied.ok) return rejectBeforeWrite(spec.action, "limit", change);
    if (spec.action === "create") discardDraft(core, newDraftKey(spec.rowId, spec.columnId));
    else if (spec.action === "update") discardDraft(core, editDraftKey(commentId));

    const settled = settleWrite(spec.action, commentId, writeId, change, base);
    return { ok: true, settled };
  }

  function settleWrite(action: CommentAction, id: string, writeId: string, change: CommentChange, prev: CellComment | undefined): Promise<void> {
    const o = optionsOf();
    const settle = (outcome: AckOutcome): void => {
      dispatch({ type: "ack", id, writeId, outcome, now: now() });
    };
    if (!o.onCommentSave) {
      settle({ kind: "void", server: false });
      return Promise.resolve();
    }
    let result: unknown;
    try {
      result = o.onCommentSave({ action, change, prev });
    } catch (error) {
      settle({ kind: "throw", error });
      return Promise.resolve();
    }
    if (!isThenable(result)) {
      settle(parseSaveAnswer(result, refreshBounds()));
      return Promise.resolve();
    }
    return (result as Promise<unknown>).then(
      (value) => settle(parseSaveAnswer(value, refreshBounds())),
      (error: unknown) => settle({ kind: "throw", error }),
    );
  }

  // --- observer ---------------------------------------------------------------------------------

  const observeDataChange: CommentEngine["observeDataChange"] = (next, change, ctx) => {
    if (disposed) return;
    if (change.source === "id-swap") {
      const rowIndex = new Map<unknown, number>();
      next.forEach((row, i) => rowIndex.set(row, i));
      const map = new Map<string, string>();
      for (const op of change.ops) {
        if (op.type !== "update") continue;
        const index = rowIndex.get(op.row);
        if (index === undefined) continue;
        const newId = ctx.getRowId(op.row, index);
        if (newId !== op.rowId) map.set(op.rowId, newId);
      }
      if (map.size === 0) return;
      for (const [oldId, newId] of map) if (busyRows.delete(oldId)) busyRows.add(newId);
      fetcher.remapRows(map);
      const open = store.ui.getState().open;
      dispatch({ type: "idSwap", map });
      if (open && map.has(open.rowId)) store.ui.setState({ open: { ...open, rowId: map.get(open.rowId) as string } });
      return;
    }
    const deleted: string[] = [];
    for (const op of change.ops) {
      if (op.type === "insert") {
        if (grid?.saveStatus(op.rowId) === "saving" && busyRows.size < MAX_BUSY_ROWS) busyRows.add(op.rowId);
      } else if (op.type === "delete") {
        busyRows.delete(op.rowId);
        if (core.index.has(op.rowId)) deleted.push(op.rowId);
      }
    }
    if (deleted.length === 0) return;
    const comments: CellComment[] = [];
    for (const rowId of deleted) {
      const columns = core.index.get(rowId);
      if (!columns) continue;
      for (const [columnId] of columns) for (const entry of cellComments(core, rowId, columnId)) comments.push(entry.comment);
    }
    if (comments.length === 0) return;
    const handler = optionsOf().onOrphanedComments;
    if (handler) {
      const ctxOut: OrphanedCommentsCtx = { comments, rowIds: deleted, source: change.source };
      callSafely(() => handler(ctxOut));
    }
  };

  const engine: CommentEngine = {
    store,
    attachGrid(adapter) {
      grid = adapter;
      return () => {
        if (grid === adapter) grid = null;
      };
    },
    bounds: () => bounds,
    applyRemote(changes) {
      const b = refreshBounds();
      const list = Array.isArray(changes) ? changes : [];
      const batch = list.slice(0, MAX_REMOTE_BATCH);
      const valid: { index: number; change: CommentChange }[] = [];
      const invalid: number[] = [];
      batch.forEach((raw, index) => {
        const change = validateChange(raw, b);
        if (change) valid.push({ index, change });
        else invalid.push(index);
      });
      if (invalid.length > 0) warnOnce("remote-invalid", `${invalid.length} remote change(s) were dropped (invalid)`);
      const result = dispatch({ type: "remote", changes: valid, invalid, truncated: Math.max(0, list.length - batch.length), now: now() });
      return result.verdict as ApplyRemoteVerdict;
    },
    getComments() {
      return confirmedSnapshot(core).slice(0, bounds.maxComments);
    },
    removeComments(rowIds) {
      const list = rowIds.slice(0, MAX_REMOTE_BATCH);
      const open = store.ui.getState().open;
      const result = dispatch({ type: "remove", rowIds: list, now: now() });
      if (open && list.includes(open.rowId)) store.close();
      return result.removed ?? 0;
    },
    refetch(rowIds) {
      fetcher.refetch(rowIds ? rowIds.slice(0, MAX_REMOTE_BATCH) : null);
    },
    syncProp(next) {
      refreshBounds();
      dispatch({ type: "propChange", next, now: now() });
      if (core.dropped > 0) warnOnce("prop-dropped", `${core.dropped} record(s) of the comments prop were dropped (invalid or over a bound)`);
    },
    create: (input) => execute({ action: "create", rowId: input.rowId, columnId: input.columnId, text: input.text }),
    edit: (id, text, base) => {
      const c = core.confirmed.get(id);
      return c ? execute({ action: "update", id, rowId: c.rowId, columnId: c.columnId, text, base }) : Promise.resolve({ ok: false as const, reason: "invalid" as const });
    },
    remove: (id, base) => {
      const c = core.confirmed.get(id);
      return c ? execute({ action: "delete", id, rowId: c.rowId, columnId: c.columnId, base }) : Promise.resolve({ ok: false as const, reason: "invalid" as const });
    },
    setResolved: (id, resolved, base) => {
      const c = core.confirmed.get(id);
      return c ? execute({ action: resolved ? "resolve" : "reopen", id, rowId: c.rowId, columnId: c.columnId, base }) : Promise.resolve({ ok: false as const, reason: "invalid" as const });
    },
    retry(id, text) {
      const conflict = core.conflicts.get(id);
      if (!conflict) return Promise.resolve({ ok: false as const, reason: "invalid" as const });
      const unchanged = conflict.text === undefined || text === undefined || text === conflict.text;
      discardConflict(core, id);
      store.bumpDrafts();
      if (conflict.thrown && unchanged) {
        const spec: WriteSpec = { action: conflict.action, id: conflict.action === "create" ? undefined : id, rowId: conflict.rowId, columnId: conflict.columnId, reuse: conflict };
        return execute(spec);
      }
      return execute({
        action: conflict.action,
        id: conflict.action === "create" ? undefined : id,
        rowId: conflict.rowId,
        columnId: conflict.columnId,
        text: text ?? conflict.text,
        base: conflict.action === "create" ? undefined : { version: conflict.baseVersion, writeId: conflict.baseWriteId },
      });
    },
    saveMine(id, text) {
      const conflict = core.conflicts.get(id);
      if (!conflict) return Promise.resolve({ ok: false as const, reason: "invalid" as const });
      discardConflict(core, id);
      store.bumpDrafts();
      const base = core.confirmed.get(id);
      return execute({
        action: conflict.action,
        id: conflict.action === "create" ? undefined : id,
        rowId: conflict.rowId,
        columnId: conflict.columnId,
        text,
        forceBase: conflict.shownVersion ?? base?.version,
      });
    },
    discard(id) {
      const conflict = core.conflicts.get(id);
      discardConflict(core, id);
      if (conflict) {
        discardDraft(core, conflict.action === "create" ? newDraftKey(conflict.rowId, conflict.columnId) : editDraftKey(id));
      }
      store.bumpDrafts();
    },
    setDraft(draft) {
      putDraft(core, { ...draft, key: draft.key ?? (draft.kind === "new" ? newDraftKey(draft.rowId, draft.columnId) : editDraftKey(draft.commentId as string)) });
      store.bumpDrafts();
    },
    discardDraft(key) {
      discardDraft(core, key);
      store.bumpDrafts();
    },
    isRowBusy: isBusy,
    fetchState: (rowId) => fetcher.fetchState(rowId),
    retryFetch: (rowId) => fetcher.retryFetch(rowId),
    observeDataChange,
    kickFetch: () => fetcher.schedule(),
    noteRowsRendered(rowIds) {
      store.setVisibleRowIds(rowIds);
    },
    currentUser: userState,
    isDisposed: () => disposed,
    openComments: (ref, by = "pointer") => grid?.open(ref, by) ?? false,
    start() {
      disposed = false;
      startExpire();
      store.onVisibleChange = fetcher.onVisibleChange;
      fetcher.schedule();
    },
    dispose() {
      disposed = true;
      fetcher.dispose();
      if (expireTimer !== null) clearInterval(expireTimer);
      expireTimer = null;
      for (const controller of gateControllers.values()) controller.abort();
      gateControllers.clear();
      store.onVisibleChange = null;
    },
  };
  return engine;
}
