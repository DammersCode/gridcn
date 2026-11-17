// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCommentEngine, type CommentEngine } from "../comment-engine";
import type { CellComment, CommentChange, CommentRejectedCtx, CommentSaveCtx, CommentsChangeCtx, UseDataGridCommentsOptions } from "../types";

const alice = { id: "alice", name: "Alice" };
const bob = { id: "bob", name: "Bob" };

function record(overrides: Partial<CellComment> = {}): CellComment {
  return { id: "c1", rowId: "r1", columnId: "name", text: "hello", author: alice, createdAt: 1000, updatedAt: 1000, version: 1, resolved: false, ...overrides };
}

type Harness = {
  engine: CommentEngine;
  options: UseDataGridCommentsOptions;
  changes: CommentsChangeCtx[];
  local: CommentChange[];
  rejected: CommentRejectedCtx[];
};

const engines: CommentEngine[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
  vi.useRealTimers();
});

function make(extra: UseDataGridCommentsOptions = {}, config: { initial?: CellComment[]; controlled?: boolean } = {}): Harness {
  const changes: CommentsChangeCtx[] = [];
  const local: CommentChange[] = [];
  const rejected: CommentRejectedCtx[] = [];
  const options: UseDataGridCommentsOptions = {
    currentUser: alice,
    onCommentsChange: (_next, ctx) => changes.push(ctx),
    onLocalChange: (change) => local.push(change),
    onCommentRejected: (ctx) => rejected.push(ctx),
    ...extra,
  };
  const engine = createCommentEngine({ getOptions: () => options, controlled: config.controlled ?? false, initialComments: config.initial, now: () => Date.now() });
  engines.push(engine);
  return { engine, options, changes, local, rejected };
}

const live = (h: Harness, id = "c1") => h.engine.store.core.confirmed.get(id);

describe("local writes without onCommentSave", () => {
  it("creates, confirms at once, and fires onCommentsChange(ack) and onLocalChange once", async () => {
    const h = make();
    const result = await h.engine.create({ rowId: "r1", columnId: "name", text: "  hi  " });
    expect(result.ok).toBe(true);
    const [created] = [...h.engine.store.core.confirmed.values()];
    expect(created?.text).toBe("hi");
    expect(created?.version).toBe(1);
    expect(h.changes.map((c) => c.source)).toEqual(["ack"]);
    expect(h.local).toHaveLength(1);
    expect(h.rejected).toHaveLength(0);
  });

  it("edits, resolves, reopens, and deletes with rising versions and a tombstone", async () => {
    const h = make({}, { initial: [record()] });
    await h.engine.edit("c1", "changed");
    expect(live(h)?.version).toBe(2);
    await h.engine.setResolved("c1", true);
    expect(live(h)).toMatchObject({ version: 3, resolved: true, resolvedBy: { id: "alice" } });
    await h.engine.setResolved("c1", false);
    expect(live(h)?.resolved).toBe(false);
    expect(live(h)?.resolvedBy).toBeUndefined();
    await h.engine.remove("c1");
    expect(live(h)).toBeUndefined();
    expect(h.engine.store.core.tombstones.get("c1")?.version).toBe(5);
    expect(h.local).toHaveLength(4);
  });

  it("refuses edit and delete of another author's comment with reason forbidden", async () => {
    const h = make({ currentUser: bob }, { initial: [record()] });
    expect(await h.engine.edit("c1", "x")).toEqual({ ok: false, reason: "forbidden" });
    expect(await h.engine.remove("c1")).toEqual({ ok: false, reason: "forbidden" });
    expect(h.rejected.map((r) => r.reason)).toEqual(["forbidden", "forbidden"]);
    expect(live(h)?.text).toBe("hello");
  });

  it("refuses an invalid current user (invalid) and over the text bound (limit)", async () => {
    const noUser = make({ currentUser: { id: "" } });
    expect((await noUser.engine.create({ rowId: "r1", columnId: "name", text: "x" })).ok).toBe(false);
    expect(noUser.rejected[0]?.reason).toBe("invalid");
    const small = make({ maxTextLength: 5 });
    expect(await small.engine.create({ rowId: "r1", columnId: "name", text: "123456" })).toEqual({ ok: false, reason: "limit" });
    expect(await small.engine.create({ rowId: "r1", columnId: "name", text: "   " })).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses an invalid createId and a throwing normalizeText or gate", async () => {
    const badId = make({ createId: () => "bad\u0000id" });
    expect((await badId.engine.create({ rowId: "r1", columnId: "name", text: "x" })).ok).toBe(false);
    expect(badId.rejected[0]).toMatchObject({ reason: "invalid" });
    expect(badId.rejected[0]?.change).toBeUndefined();
    const norm = make({ normalizeText: () => { throw new Error("x"); } });
    await norm.engine.create({ rowId: "r1", columnId: "name", text: "x" });
    expect(norm.rejected[0]?.reason).toBe("error");
    const gate = make({ canCreate: () => Promise.reject(new Error("no")) });
    await gate.engine.create({ rowId: "r1", columnId: "name", text: "x" });
    expect(gate.rejected[0]?.reason).toBe("error");
  });

  it("enforces maxCommentsPerCell and maxComments with reason limit", async () => {
    const cell = make({ maxCommentsPerCell: 1 });
    await cell.engine.create({ rowId: "r1", columnId: "name", text: "a" });
    expect(await cell.engine.create({ rowId: "r1", columnId: "name", text: "b" })).toEqual({ ok: false, reason: "limit" });
    await cell.engine.create({ rowId: "r1", columnId: "other", text: "c" });
    const total = make({ maxComments: 1 });
    await total.engine.create({ rowId: "r1", columnId: "name", text: "a" });
    expect((await total.engine.create({ rowId: "r2", columnId: "name", text: "b" })).ok).toBe(false);
  });

  it("applies normalizeText to local writes only", async () => {
    const h = make({ normalizeText: (t) => t.toUpperCase() });
    await h.engine.create({ rowId: "r1", columnId: "name", text: "abc" });
    expect([...h.engine.store.core.confirmed.values()][0]?.text).toBe("ABC");
  });
});

describe("onCommentSave", () => {
  it("shows the optimistic record at baseVersion+1 and confirms on a void acknowledgement", async () => {
    let release: () => void = () => {};
    const seen: CommentSaveCtx[] = [];
    const h = make({
      onCommentSave: (ctx) => {
        seen.push(ctx);
        return new Promise<void>((resolve) => { release = resolve; });
      },
    }, { initial: [record()] });
    const result = await h.engine.edit("c1", "edited");
    expect(result.ok).toBe(true);
    expect(seen[0]).toMatchObject({ action: "update", prev: { version: 1 } });
    expect(seen[0]?.change).toMatchObject({ kind: "upsert", baseVersion: 1, comment: { version: 2 } });
    expect(live(h)?.version).toBe(1);
    const entry = h.engine.store.core.pending.get("c1");
    expect(entry?.record.version).toBe(2);
    expect(h.changes).toHaveLength(0);
    release();
    if (result.ok) await result.settled;
    expect(live(h)).toMatchObject({ version: 2, text: "edited" });
    expect(h.changes.map((c) => c.source)).toEqual(["ack"]);
    expect(h.local).toHaveLength(1);
  });

  it("rolls back on a rejection, keeps the text as a draft, and fires onCommentRejected once", async () => {
    const h = make({ onCommentSave: () => ({ rejected: { reason: "forbidden", message: "nope" } }) }, { initial: [record()] });
    const result = await h.engine.edit("c1", "mine");
    if (result.ok) await result.settled;
    expect(live(h)?.text).toBe("hello");
    expect(h.rejected).toHaveLength(1);
    expect(h.rejected[0]).toMatchObject({ reason: "forbidden", message: "nope", action: "update" });
    expect(h.engine.store.core.drafts.get("e\u0001c1")?.text).toBe("mine");
    expect(h.local).toHaveLength(0);
  });

  it("fires onCommentRejected for an unknown comment id", async () => {
    const h = make();
    expect(await h.engine.edit("missing", "x")).toEqual({ ok: false, reason: "invalid" });
    expect(await h.engine.remove("missing")).toEqual({ ok: false, reason: "invalid" });
    expect(await h.engine.setResolved("missing", true)).toEqual({ ok: false, reason: "invalid" });
    expect(h.rejected.map((r) => [r.action, r.reason])).toEqual([["update", "invalid"], ["delete", "invalid"], ["resolve", "invalid"]]);
  });

  it("applies a stale rejection's current record and emits it as ack", async () => {
    const current = record({ version: 3, text: "theirs", writeId: "w-x" });
    const h = make({ onCommentSave: () => ({ rejected: { reason: "stale", current } }), currentUser: alice, canEdit: () => true }, { initial: [record()] });
    const result = await h.engine.edit("c1", "mine");
    if (result.ok) await result.settled;
    expect(live(h)).toMatchObject({ version: 3, text: "theirs" });
    expect(h.changes.at(-1)?.source).toBe("ack");
    expect(h.rejected[0]).toMatchObject({ reason: "stale" });
    expect(h.engine.store.core.conflicts.get("c1")?.reason).toBe("stale");
  });

  it("confirms a stale answer that carries the write's own writeId (no onCommentRejected)", async () => {
    let own: CellComment | undefined;
    const h = make({
      canEdit: () => true,
      onCommentSave: (ctx) => {
        own = ctx.change.kind === "upsert" ? ctx.change.comment : undefined;
        return { rejected: { reason: "stale", current: own } };
      },
    }, { initial: [record()] });
    const result = await h.engine.edit("c1", "mine");
    if (result.ok) await result.settled;
    expect(live(h)?.text).toBe("mine");
    expect(h.rejected).toHaveLength(0);
    expect(h.local).toHaveLength(1);
  });

  it("treats a throw as unknown outcome: rollback, conflict keeps the writeId, an echo confirms it", async () => {
    let writeId = "";
    const h = make({
      onCommentSave: (ctx) => {
        writeId = ctx.change.kind === "upsert" ? (ctx.change.comment.writeId as string) : "";
        throw new Error("network");
      },
    }, { initial: [record()] });
    const result = await h.engine.edit("c1", "mine");
    if (result.ok) await result.settled;
    expect(h.rejected[0]).toMatchObject({ reason: "error" });
    expect(live(h)?.text).toBe("hello");
    const conflict = h.engine.store.core.conflicts.get("c1");
    expect(conflict).toMatchObject({ thrown: true, writeId });
    const echo = record({ version: 2, text: "mine", writeId });
    const verdict = h.engine.applyRemote([{ kind: "upsert", comment: echo }]);
    expect(verdict.applied).toBe(1);
    expect(live(h)?.text).toBe("mine");
    expect(h.engine.store.core.conflicts.has("c1")).toBe(false);
    expect(h.local).toHaveLength(1);
  });

  it("retries a thrown write with the same writeId and baseVersion", async () => {
    const sent: CommentSaveCtx[] = [];
    let fail = true;
    const h = make({
      onCommentSave: (ctx) => {
        sent.push(ctx);
        if (fail) throw new Error("x");
      },
    }, { initial: [record()] });
    const first = await h.engine.edit("c1", "mine");
    if (first.ok) await first.settled;
    fail = false;
    const retry = await h.engine.retry("c1", "mine");
    if (retry.ok) await retry.settled;
    expect(sent).toHaveLength(2);
    expect(sent[1]?.change).toEqual(sent[0]?.change);
    expect(live(h)?.text).toBe("mine");
  });

  it("a retry with edited text takes a fresh writeId", async () => {
    const sent: CommentSaveCtx[] = [];
    let fail = true;
    const h = make({ onCommentSave: (ctx) => { sent.push(ctx); if (fail) throw new Error("x"); } }, { initial: [record()] });
    const first = await h.engine.edit("c1", "mine");
    if (first.ok) await first.settled;
    fail = false;
    const retry = await h.engine.retry("c1", "mine v2");
    if (retry.ok) await retry.settled;
    const a = sent[0]?.change.kind === "upsert" ? sent[0].change.comment.writeId : "";
    const b = sent[1]?.change.kind === "upsert" ? sent[1].change.comment.writeId : "";
    expect(a).not.toBe(b);
  });

  it("an echo before the acknowledgement confirms the write once, and the late ack changes nothing", async () => {
    let release: () => void = () => {};
    const h = make({ onCommentSave: () => new Promise<void>((r) => { release = r; }) }, { initial: [record()] });
    const result = await h.engine.edit("c1", "mine");
    const writeId = h.engine.store.core.pending.get("c1")?.writeId;
    h.engine.applyRemote([{ kind: "upsert", comment: record({ version: 2, text: "mine", writeId }) }]);
    expect(live(h)?.text).toBe("mine");
    expect(h.local).toHaveLength(1);
    release();
    if (result.ok) await result.settled;
    expect(h.local).toHaveLength(1);
    expect(h.rejected).toHaveLength(0);
  });

  it("supersedes a pending edit when a remote delete arrives and offers the text as a new draft", async () => {
    let release: () => void = () => {};
    const h = make({ onCommentSave: () => new Promise<void>((r) => { release = r; }) }, { initial: [record()] });
    const result = await h.engine.edit("c1", "my edit");
    h.engine.applyRemote([{ kind: "delete", id: "c1", rowId: "r1", columnId: "name", version: 2, writeId: "zzz" }]);
    expect(live(h)).toBeUndefined();
    expect(h.engine.store.core.drafts.get("n\u0001r1\u0001name")?.text).toBe("my edit");
    release();
    if (result.ok) await result.settled;
    expect(h.local).toHaveLength(0);
    expect(h.rejected).toHaveLength(0);
  });

  it("detects a stale draft base on submit and shows the conflict instead of overwriting", async () => {
    const h = make({ canEdit: () => true }, { initial: [record()] });
    h.engine.applyRemote([{ kind: "upsert", comment: record({ version: 2, text: "theirs", writeId: "w9", author: alice }) }]);
    const result = await h.engine.edit("c1", "mine", { version: 1, writeId: undefined });
    expect(result).toEqual({ ok: false, reason: "stale" });
    expect(live(h)?.text).toBe("theirs");
    expect(h.engine.store.core.conflicts.get("c1")?.reason).toBe("stale");
    const saved = await h.engine.saveMine("c1", "mine");
    expect(saved.ok).toBe(true);
    expect(live(h)).toMatchObject({ text: "mine", version: 3 });
  });

  it("blocks a second write while one is pending", async () => {
    let release: () => void = () => {};
    const h = make({ onCommentSave: () => new Promise<void>((r) => { release = r; }) }, { initial: [record()] });
    const first = await h.engine.edit("c1", "a");
    expect(await h.engine.edit("c1", "b")).toEqual({ ok: false, reason: "pending" });
    release();
    if (first.ok) await first.settled;
  });

  it("settles an acknowledgement after dispose without starting new writes", async () => {
    let release: () => void = () => {};
    const h = make({ onCommentSave: () => new Promise<void>((r) => { release = r; }) }, { initial: [record()] });
    const result = await h.engine.edit("c1", "a");
    h.engine.dispose();
    release();
    if (result.ok) await result.settled;
    expect(live(h)?.text).toBe("a");
  });
});

describe("applyRemote", () => {
  it("applies, reports duplicates, stale, invalid, and truncation", () => {
    const h = make({}, { initial: [record()] });
    const verdict = h.engine.applyRemote([
      { kind: "upsert", comment: record({ version: 2, text: "v2", writeId: "w2" }) },
      { kind: "upsert", comment: record({ version: 2, text: "v2", writeId: "w2" }) },
      { kind: "upsert", comment: record({ version: 1, text: "old", writeId: "w0" }) },
      { kind: "upsert", comment: { ...record(), text: "" } },
      { kind: "upsert", comment: record({ id: "c2", version: 1, writeId: "w3" }) },
    ]);
    expect(verdict.applied).toBe(2);
    expect(verdict.skipped.map((s) => s.reason).sort()).toEqual(["duplicate", "invalid", "stale"]);
    expect(h.changes.at(-1)).toMatchObject({ source: "remote" });
    expect(h.changes.at(-1)?.changes).toHaveLength(2);
  });

  it("tombstones block older upserts and a remote delete for an unknown id is ignored", () => {
    const h = make({}, { initial: [record()] });
    h.engine.applyRemote([{ kind: "delete", id: "c1", rowId: "r1", columnId: "name", version: 2 }]);
    expect(live(h)).toBeUndefined();
    const verdict = h.engine.applyRemote([
      { kind: "upsert", comment: record({ version: 2, writeId: "w" }) },
      { kind: "delete", id: "nope", rowId: "r1", columnId: "name", version: 4 },
    ]);
    expect(verdict.skipped.map((s) => s.reason).sort()).toEqual(["tombstoned", "unknown"]);
  });

  it("drops a record that changes the address or the author of a known id", () => {
    const h = make({}, { initial: [record()] });
    const verdict = h.engine.applyRemote([
      { kind: "upsert", comment: record({ version: 2, rowId: "r9", writeId: "a" }) },
      { kind: "upsert", comment: record({ version: 2, author: bob, writeId: "b" }) },
    ]);
    expect(verdict.skipped.map((s) => s.reason)).toEqual(["invalid", "invalid"]);
  });

  it("breaks a same-version tie by updatedAt, then by the larger writeId", () => {
    const h = make({}, { initial: [record()] });
    h.engine.applyRemote([{ kind: "upsert", comment: record({ version: 2, writeId: "aaa", updatedAt: 10 }) }]);
    expect(h.engine.applyRemote([{ kind: "upsert", comment: record({ version: 2, writeId: "bbb", updatedAt: 20, text: "later" }) }]).applied).toBe(1);
    expect(h.engine.applyRemote([{ kind: "upsert", comment: record({ version: 2, writeId: "zzz", updatedAt: 20, text: "bigger" }) }]).applied).toBe(1);
    expect(live(h)?.text).toBe("bigger");
    expect(h.engine.applyRemote([{ kind: "upsert", comment: record({ version: 2, writeId: "aaa", updatedAt: 20, text: "smaller" }) }]).applied).toBe(0);
  });

  it("a delete beats an upsert at the same version", () => {
    const h = make({}, { initial: [record({ version: 2, writeId: "aaa" })] });
    const verdict = h.engine.applyRemote([{ kind: "delete", id: "c1", rowId: "r1", columnId: "name", version: 2, writeId: "bbb" }]);
    expect(verdict.applied).toBe(1);
    expect(live(h)).toBeUndefined();
  });

  it("caps the batch at 10,000 changes", () => {
    const h = make();
    const batch: CommentChange[] = Array.from({ length: 10_005 }, () => ({ kind: "delete", id: "x", rowId: "r", columnId: "c", version: 1 }));
    expect(h.engine.applyRemote(batch).truncated).toBe(5);
  });

  it("rejects hostile records: markup stays text, control chars in ids and names are handled, long text drops", () => {
    const h = make({}, { initial: [] });
    const verdict = h.engine.applyRemote([
      { kind: "upsert", comment: record({ id: "h1", text: "<img src=x onerror=alert(1)>", author: { id: "m", name: "Eve\u202e\u0000X" }, writeId: "w" }) },
      { kind: "upsert", comment: record({ id: "bad\u0007id", writeId: "w" }) },
      { kind: "upsert", comment: record({ id: "h3", text: "x".repeat(9000), writeId: "w" }) },
      { kind: "upsert", comment: Object.create(null) as CellComment },
    ]);
    expect(verdict.applied).toBe(1);
    expect(h.engine.store.core.confirmed.get("h1")?.author?.name).toBe("EveX");
    expect(h.engine.store.core.confirmed.get("h1")?.text).toBe("<img src=x onerror=alert(1)>");
    expect(Object.isFrozen(h.engine.store.core.confirmed.get("h1"))).toBe(true);
  });
});

describe("removeComments, refetch, id swap, orphans", () => {
  it("removeComments emits source remove, tombstones, and discards pending state", async () => {
    let release: () => void = () => {};
    const h = make({ onCommentSave: () => new Promise<void>((r) => { release = r; }) }, { initial: [record(), record({ id: "c2", rowId: "r2" })] });
    const edit = await h.engine.edit("c1", "x");
    expect(h.engine.removeComments(["r1", "nope"])).toBe(1);
    expect(h.changes.at(-1)).toMatchObject({ source: "remove" });
    expect(h.engine.store.core.pending.has("c1")).toBe(false);
    expect(h.engine.store.core.tombstones.get("c1")?.version).toBe(2);
    release();
    if (edit.ok) await edit.settled;
    expect(live(h, "c2")).toBeDefined();
    expect(live(h)).toBeUndefined();
  });

  it("re-keys comments, drafts, and aliases on an id swap", async () => {
    const h = make({}, { initial: [record()] });
    h.engine.edit("c1", "x").catch(() => {});
    await Promise.resolve();
    h.engine.store.dispatch({ type: "idSwap", map: new Map([["r1", "r1-server"]]) });
    expect(live(h)?.rowId).toBe("r1-server");
    expect(h.engine.store.core.index.has("r1")).toBe(false);
    const verdict = h.engine.applyRemote([{ kind: "upsert", comment: record({ version: 9, rowId: "r1", writeId: "late" }) }]);
    expect(verdict.applied).toBe(1);
    expect(live(h)?.rowId).toBe("r1-server");
  });

  it("fires onOrphanedComments only for deleted rows that have comments, and keeps the comments", () => {
    const orphaned: unknown[] = [];
    const h = make({ onOrphanedComments: (ctx) => orphaned.push(ctx) }, { initial: [record()] });
    const ctx = { getRowId: (row: unknown) => String(row) };
    h.engine.observeDataChange([], { source: "edit", ops: [{ type: "delete", rowId: "other", row: "other", index: 0 }] }, ctx);
    expect(orphaned).toHaveLength(0);
    h.engine.observeDataChange([], { source: "history", ops: [{ type: "delete", rowId: "r1", row: "r1", index: 0 }] }, ctx);
    expect(orphaned).toMatchObject([{ rowIds: ["r1"], source: "history", comments: [{ id: "c1" }] }]);
    expect(live(h)).toBeDefined();
  });

  it("an id-swap data change remaps through the observer", () => {
    const h = make({}, { initial: [record()] });
    const row = { id: "server-1" };
    h.engine.observeDataChange([row], { source: "id-swap", ops: [{ type: "update", rowId: "r1", row, prev: { id: "r1" } }] }, { getRowId: (r) => (r as { id: string }).id });
    expect(live(h)?.rowId).toBe("server-1");
    expect(h.changes.at(-1)).toMatchObject({ source: "id-swap" });
  });
});

describe("controlled mode", () => {
  it("treats the prop as the app's state: silent sync, typed-field diff, forgotten comments", () => {
    const a = record();
    const h = make({}, { initial: [a], controlled: true });
    expect(live(h)).toBeDefined();
    h.engine.syncProp([a]);
    h.engine.syncProp([{ ...a, text: "app edit", version: 1 }]);
    expect(live(h)?.text).toBe("app edit");
    expect(h.changes).toHaveLength(0);
    h.engine.syncProp([]);
    expect(live(h)).toBeUndefined();
    expect(h.engine.store.core.tombstones.size).toBe(0);
  });

  it("keeps the app's original objects in next for records the add-on did not change", async () => {
    const original = { ...record(), extra: "kept" } as CellComment;
    const nexts: (readonly CellComment[])[] = [];
    const h = make({ onCommentsChange: (next) => nexts.push(next) }, { initial: [original, record({ id: "c2" })], controlled: true });
    await h.engine.edit("c2", "changed");
    const last = nexts.at(-1) as readonly CellComment[];
    expect(last.find((c) => c.id === "c1")).toBe(original);
    expect(last.find((c) => c.id === "c2")?.text).toBe("changed");
  });

  it("a lagging prop (same content) changes nothing; a prop echo of a pending write fires onLocalChange once", async () => {
    let release: () => void = () => {};
    const h = make({ onCommentSave: () => new Promise<void>((r) => { release = r; }) }, { initial: [record()], controlled: true });
    const result = await h.engine.edit("c1", "mine");
    const writeId = h.engine.store.core.pending.get("c1")?.writeId;
    h.engine.syncProp([record()]);
    expect(h.engine.store.core.pending.has("c1")).toBe(true);
    h.engine.syncProp([record({ version: 2, text: "mine", writeId })]);
    expect(h.local).toHaveLength(1);
    release();
    if (result.ok) await result.settled;
    expect(h.local).toHaveLength(1);
  });
});

describe("fetchComments", () => {
  it("loads rendered rows, applies the answer, removes absent untouched comments, and marks rows fetched", async () => {
    vi.useFakeTimers();
    const answers: string[][] = [];
    const h = make({
      fetchComments: async ({ rowIds }) => {
        answers.push([...rowIds]);
        return [record({ id: "f1", rowId: "r1", writeId: "w" })];
      },
    }, { initial: [record({ id: "stale-one", rowId: "r1", writeId: "w0" })] });
    h.engine.noteRowsRendered(["r1", "r2"]);
    await vi.advanceTimersByTimeAsync(200);
    expect(answers).toEqual([["r1", "r2"]]);
    expect(live(h, "f1")).toBeDefined();
    expect(live(h, "stale-one")).toBeUndefined();
    expect(h.changes.map((c) => c.source)).toContain("fetch");
    expect(h.engine.fetchState("r1")).toBe("ready");
    expect(h.engine.store.core.tombstones.has("stale-one")).toBe(false);
  });

  it("reports a failed request through onFetchError and retries on the next render with a 2 s gap", async () => {
    vi.useFakeTimers();
    const errors: unknown[] = [];
    let calls = 0;
    const h = make({
      fetchComments: async () => {
        calls += 1;
        if (calls === 1) throw new Error("down");
        return [];
      },
      onFetchError: (ctx) => errors.push(ctx),
    });
    h.engine.noteRowsRendered(["r1"]);
    await vi.advanceTimersByTimeAsync(200);
    expect(errors).toHaveLength(1);
    expect(h.engine.fetchState("r1")).toBe("failed");
    await vi.advanceTimersByTimeAsync(2500);
    expect(calls).toBe(2);
    expect(h.engine.fetchState("r1")).toBe("ready");
  });

  it("an answer over 10,000 records is a failure with reason limit", async () => {
    vi.useFakeTimers();
    const errors: { reason: string }[] = [];
    const h = make({
      fetchComments: async () => Array.from({ length: 10_001 }, (_, i) => record({ id: `x${i}` })),
      onFetchError: (ctx) => errors.push(ctx),
    });
    h.engine.noteRowsRendered(["r1"]);
    await vi.advanceTimersByTimeAsync(200);
    expect(errors[0]?.reason).toBe("limit");
    expect(h.engine.store.core.confirmed.size).toBe(0);
  });

  it("does not drop a comment touched after the request started", async () => {
    vi.useFakeTimers();
    let resolve: (value: CellComment[]) => void = () => {};
    const h = make({ fetchComments: () => new Promise<CellComment[]>((r) => { resolve = r; }) }, { initial: [record()] });
    h.engine.noteRowsRendered(["r1"]);
    await vi.advanceTimersByTimeAsync(200);
    h.engine.applyRemote([{ kind: "upsert", comment: record({ version: 2, writeId: "n" }) }]);
    resolve([]);
    await vi.advanceTimersByTimeAsync(10);
    expect(live(h)?.version).toBe(2);
  });

  it("evicts the least recently rendered rows in uncontrolled mode but never a row with a draft", async () => {
    vi.useFakeTimers();
    const h = make({ maxCachedRows: 1, fetchComments: async ({ rowIds }) => rowIds.map((rowId) => record({ id: `c-${rowId}`, rowId, writeId: "w" })) });
    h.engine.noteRowsRendered(["r1"]);
    await vi.advanceTimersByTimeAsync(200);
    h.engine.setDraft({ kind: "new", rowId: "r1", columnId: "name", text: "typing", baseVersion: 0, baseWriteId: undefined });
    h.engine.noteRowsRendered(["r2"]);
    await vi.advanceTimersByTimeAsync(200);
    expect(live(h, "c-r1")).toBeDefined();
    h.engine.discardDraft("n\u0001r1\u0001name");
    h.engine.noteRowsRendered(["r3"]);
    await vi.advanceTimersByTimeAsync(200);
    expect(live(h, "c-r1")).toBeUndefined();
    expect(live(h, "c-r3")).toBeDefined();
  });
});

describe("row-busy gate", () => {
  it("refuses a write on a row whose insert is still saving and allows it after the status clears", async () => {
    const h = make({}, { initial: [record({ rowId: "temp-1" })] });
    let status: string | undefined = "saving";
    h.engine.attachGrid({ readOnly: () => false, saveStatus: () => status, open: () => true });
    h.engine.observeDataChange([], { source: "row-operation", ops: [{ type: "insert", rowId: "temp-1", row: {}, index: 0 }] }, { getRowId: () => "temp-1" });
    expect(await h.engine.edit("c1", "x")).toEqual({ ok: false, reason: "row-busy" });
    expect(h.rejected[0]?.reason).toBe("row-busy");
    status = undefined;
    expect((await h.engine.edit("c1", "x")).ok).toBe(true);
  });

  it("refuses with read-only unless allowWhenReadOnly", async () => {
    const h = make({}, { initial: [record()] });
    h.engine.attachGrid({ readOnly: () => true, saveStatus: () => undefined, open: () => true });
    expect(await h.engine.edit("c1", "x")).toEqual({ ok: false, reason: "read-only" });
    h.options.allowWhenReadOnly = true;
    expect((await h.engine.edit("c1", "x")).ok).toBe(true);
  });
});

describe("callbacks", () => {
  it("isolates a throwing callback so the others still run", async () => {
    const calls: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = make({
      onCommentsChange: () => { throw new Error("boom"); },
      onLocalChange: () => calls.push("local"),
    });
    await h.engine.create({ rowId: "r1", columnId: "name", text: "x" });
    expect(calls).toEqual(["local"]);
    spy.mockRestore();
  });
});

describe("review fixes", () => {
  it("a fetch aborted by scrolling away is not stuck loading and refetches when the row returns", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const h = make({ fetchComments: async () => { calls += 1; return []; } });
    h.engine.noteRowsRendered(["r1"]);
    await vi.advanceTimersByTimeAsync(200);
    h.engine.noteRowsRendered(["r2"]);
    await vi.advanceTimersByTimeAsync(500);
    h.engine.noteRowsRendered(["r1"]);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.engine.fetchState("r1")).toBe("ready");
    expect(calls).toBeGreaterThan(0);
  });

  it("an edited retry keeps the conflict's base version, so a newer remote edit is not overwritten silently", async () => {
    let fail = true;
    const h = make({ canEdit: () => true, onCommentSave: () => { if (fail) throw new Error("x"); } }, { initial: [record()] });
    const first = await h.engine.edit("c1", "mine");
    if (first.ok) await first.settled;
    h.engine.applyRemote([{ kind: "upsert", comment: record({ version: 2, text: "theirs", writeId: "w-t" }) }]);
    fail = false;
    const retry = await h.engine.retry("c1", "mine edited");
    expect(retry).toEqual({ ok: false, reason: "stale" });
    expect(live(h)?.text).toBe("theirs");
  });

  it("a create over the per-cell limit keeps the typed draft", async () => {
    const h = make({ maxCommentsPerCell: 1 });
    await h.engine.create({ rowId: "r1", columnId: "name", text: "a" });
    h.engine.setDraft({ kind: "new", rowId: "r1", columnId: "name", text: "typed", baseVersion: 0, baseWriteId: undefined });
    expect((await h.engine.create({ rowId: "r1", columnId: "name", text: "typed" })).ok).toBe(false);
    expect(h.engine.store.core.drafts.get("n\u0001r1\u0001name")?.text).toBe("typed");
  });

  it("a remote delete moves the text of an open edit draft to the new-comment draft", () => {
    const h = make({}, { initial: [record()] });
    h.engine.setDraft({ kind: "edit", commentId: "c1", rowId: "r1", columnId: "name", text: "typing", baseVersion: 1, baseWriteId: undefined });
    h.engine.applyRemote([{ kind: "delete", id: "c1", rowId: "r1", columnId: "name", version: 2, writeId: "z" }]);
    expect(h.engine.store.core.drafts.get("n\u0001r1\u0001name")?.text).toBe("typing");
    expect(h.engine.store.core.drafts.has("e\u0001c1")).toBe(false);
  });

  it("a stale rejection with current null on an edit offers the text as a new-comment draft", async () => {
    const h = make({ canEdit: () => true, onCommentSave: () => ({ rejected: { reason: "stale", current: null } }) }, { initial: [record()] });
    const r = await h.engine.edit("c1", "my words");
    if (r.ok) await r.settled;
    expect(h.engine.store.core.drafts.get("n\u0001r1\u0001name")?.text).toBe("my words");
  });

  it("skips null entries and throwing getters in a controlled prop or a fetch answer", async () => {
    const h = make({}, { initial: [null as unknown as CellComment, record()], controlled: true });
    expect(live(h)).toBeDefined();
    const trap = { get id(): string { throw new Error("boom"); } } as unknown as CellComment;
    h.engine.syncProp([record(), trap]);
    expect(h.engine.applyRemote([trap as never]).skippedCount).toBe(1);
  });

  it("an id swap in controlled mode reports the new row id in next", async () => {
    const nexts: (readonly CellComment[])[] = [];
    const h = make({ onCommentsChange: (n) => nexts.push(n) }, { initial: [record()], controlled: true });
    h.engine.store.dispatch({ type: "idSwap", map: new Map([["r1", "r1-server"]]) });
    expect(h.engine.getComments()[0]?.rowId).toBe("r1-server");
  });
});

describe("development warnings", () => {
  it("warns once per engine instance, so a second grid with the same misuse warns too", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = { ...record(), version: -1 };
    make({}, { initial: [bad] });
    make({}, { initial: [bad] });
    make({}, { initial: [bad] }).engine.syncProp([bad]);
    const seedWarnings = warn.mock.calls.filter((call) => String(call[0]).includes("seed record(s) were dropped"));
    expect(seedWarnings).toHaveLength(3);
    warn.mockRestore();
  });
});

describe("stale rejection warning", () => {
  const staleWithoutCurrent = { onCommentSave: () => ({ rejected: { reason: "stale" as const } }), canEdit: () => true };

  async function editStale(extra: UseDataGridCommentsOptions): Promise<number> {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = make({ ...staleWithoutCurrent, ...extra }, { initial: [record()] });
    const result = await h.engine.edit("c1", "mine");
    if (result.ok) await result.settled;
    const count = warn.mock.calls.filter((call) => String(call[0]).includes("stale rejection without")).length;
    warn.mockRestore();
    return count;
  }

  it("warns when the save gives no current record and fetchComments is unset", async () => {
    expect(await editStale({})).toBe(1);
  });

  it("stays silent when fetchComments refetches the row", async () => {
    expect(await editStale({ fetchComments: async () => [] })).toBe(0);
  });
});
