// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCommentEngine, type CommentEngine } from "../comment-engine";
import { DEFAULT_COMMENTS_LABELS } from "../labels";
import type { CellComment, CommentRejectedCtx, UseDataGridCommentsOptions } from "../types";

const alice = { id: "alice", name: "Alice" };
const bob = { id: "bob", name: "Bob" };
const target = { rowId: "r1", columnId: "name", text: "hi" };

function record(overrides: Partial<CellComment> = {}): CellComment {
  return { id: "c1", rowId: "r1", columnId: "name", text: "hello", createdAt: 1000, updatedAt: 1000, version: 1, resolved: false, ...overrides };
}

const engines: CommentEngine[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
  vi.restoreAllMocks();
});

function make(extra: UseDataGridCommentsOptions = {}, initial: CellComment[] = [], controlled = false) {
  const rejected: CommentRejectedCtx[] = [];
  const options: UseDataGridCommentsOptions = { onCommentRejected: (ctx) => rejected.push(ctx), ...extra };
  const engine = createCommentEngine({ getOptions: () => options, controlled, initialComments: initial });
  engines.push(engine);
  return { engine, options, rejected };
}

const live = (engine: CommentEngine, id = "c1") => engine.store.core.confirmed.get(id);
const upsert = (comment: CellComment) => [{ kind: "upsert" as const, comment }];

describe("anonymous local writes", () => {
  it("creates, edits, resolves, reopens, and deletes with no options", async () => {
    const { engine } = make();
    expect((await engine.create(target)).ok).toBe(true);
    const created = [...engine.store.core.confirmed.values()][0] as CellComment;
    expect("author" in created).toBe(false);
    expect((await engine.edit(created.id, "changed")).ok).toBe(true);
    expect((await engine.setResolved(created.id, true)).ok).toBe(true);
    expect(live(engine, created.id)?.resolved).toBe(true);
    expect("resolvedBy" in (live(engine, created.id) as CellComment)).toBe(false);
    expect((await engine.setResolved(created.id, false)).ok).toBe(true);
    expect((await engine.remove(created.id)).ok).toBe(true);
    expect(live(engine, created.id)).toBeUndefined();
  });

  it("stamps the author and resolver only when a valid user exists", async () => {
    const { engine } = make({ currentUser: alice });
    await engine.create(target);
    const created = [...engine.store.core.confirmed.values()][0] as CellComment;
    expect(created.author).toEqual(alice);
    await engine.setResolved(created.id, true);
    expect(live(engine, created.id)?.resolvedBy).toEqual(alice);
  });

  it("refuses a present but invalid currentUser and warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { engine, rejected } = make({ currentUser: { id: "" } });
    expect(await engine.create(target)).toEqual({ ok: false, reason: "invalid" });
    expect(await engine.create(target)).toEqual({ ok: false, reason: "invalid" });
    expect(rejected[0]?.reason).toBe("invalid");
    expect(engine.currentUser()).toEqual({ kind: "invalid" });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("reports the three user states", () => {
    expect(make().engine.currentUser()).toEqual({ kind: "anonymous" });
    expect(make({ currentUser: alice }).engine.currentUser()).toEqual({ kind: "user", user: alice });
  });

  it("readOnly refuses every write path", async () => {
    const { engine, rejected } = make({ readOnly: true, allowWhenReadOnly: true }, [record()]);
    expect(await engine.create(target)).toEqual({ ok: false, reason: "read-only" });
    expect(await engine.edit("c1", "x")).toEqual({ ok: false, reason: "read-only" });
    expect(await engine.setResolved("c1", true)).toEqual({ ok: false, reason: "read-only" });
    expect(await engine.remove("c1")).toEqual({ ok: false, reason: "read-only" });
    expect(rejected.map((r) => r.reason)).toEqual(["read-only", "read-only", "read-only", "read-only"]);
  });

  it("applies the default gate: anyone on an anonymous record, only the author on an authored one", async () => {
    const anonymous = make({ currentUser: bob }, [record()]);
    expect((await anonymous.engine.edit("c1", "by bob")).ok).toBe(true);
    const authored = make({ currentUser: bob }, [record({ author: alice })]);
    expect(await authored.engine.edit("c1", "x")).toEqual({ ok: false, reason: "forbidden" });
    const signedOut = make({}, [record({ author: alice })]);
    expect(await signedOut.engine.remove("c1")).toEqual({ ok: false, reason: "forbidden" });
  });

  it("passes the action to the gates so reopen differs from resolve", async () => {
    const actions: string[] = [];
    const { engine } = make({ canResolve: ({ action }) => (actions.push(action), action === "resolve") }, [record()]);
    expect((await engine.setResolved("c1", true)).ok).toBe(true);
    expect(await engine.setResolved("c1", false)).toEqual({ ok: false, reason: "forbidden" });
    expect(actions).toEqual(["resolve", "reopen"]);
  });

  it("enableResolve false refuses resolve and reopen, including on resolved records", async () => {
    const { engine } = make({ enableResolve: false }, [record({ resolved: true })]);
    expect(await engine.setResolved("c1", false)).toEqual({ ok: false, reason: "forbidden" });
    expect(await engine.setResolved("c1", true)).toEqual({ ok: false, reason: "forbidden" });
    expect(live(engine)?.resolved).toBe(true);
    expect((await engine.edit("c1", "still editable")).ok).toBe(true);
  });

  it("writes in controlled mode without onCommentSave", async () => {
    const seen: number[] = [];
    const { engine } = make({ onCommentsChange: (next) => seen.push(next.length) }, [], true);
    expect((await engine.create(target)).ok).toBe(true);
    expect(seen).toEqual([1]);
  });

  it("a superseded async gate does not write: a double submit creates one comment", async () => {
    let releaseFirst: (value: boolean) => void = () => {};
    let calls = 0;
    const canCreate = (): Promise<boolean> => {
      calls += 1;
      return calls === 1 ? new Promise<boolean>((resolve) => (releaseFirst = resolve)) : Promise.resolve(true);
    };
    const { engine } = make({ canCreate });
    const first = engine.create(target);
    const second = engine.create(target);
    releaseFirst(true);
    const results = await Promise.all([first, second]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(engine.store.core.confirmed.size).toBe(1);
  });
});

describe("author rule: absent to present once", () => {
  it("accepts an author added at a higher version and refuses a strip", () => {
    const { engine } = make({}, [record()]);
    expect(engine.applyRemote(upsert(record({ version: 2, author: alice, writeId: "w2" }))).applied).toBe(1);
    expect(live(engine)?.author).toEqual(alice);
    const strip = engine.applyRemote(upsert(record({ version: 3, writeId: "w3" })));
    expect(strip.skipped).toEqual([{ index: 0, reason: "invalid" }]);
    expect(live(engine)?.author).toEqual(alice);
  });

  it("refuses an author id change", () => {
    const { engine } = make({}, [record({ author: alice })]);
    expect(engine.applyRemote(upsert(record({ version: 2, author: bob }))).skipped[0]?.reason).toBe("invalid");
  });

  it("lets a same-writeId echo add the author after a void ack", async () => {
    const { engine } = make({ onCommentSave: () => undefined });
    await engine.create(target);
    const local = [...engine.store.core.confirmed.values()][0] as CellComment;
    expect(engine.applyRemote(upsert({ ...local, author: alice })).applied).toBe(1);
    expect(live(engine, local.id)?.author).toEqual(alice);
  });

  it("still drops a same-writeId echo that adds nothing", async () => {
    const { engine } = make({ currentUser: alice, onCommentSave: () => undefined });
    await engine.create(target);
    const local = [...engine.store.core.confirmed.values()][0] as CellComment;
    expect(engine.applyRemote(upsert(local)).skipped[0]?.reason).toBe("duplicate");
  });

  it("rejects a save answer that strips the author", async () => {
    const { engine, rejected } = make({
      currentUser: alice,
      onCommentSave: ({ change }) => ({ comment: change.kind === "upsert" ? { ...change.comment, author: undefined } : null }) as never,
    });
    await engine.create(target);
    expect(rejected[0]?.reason).toBe("invalid");
  });
});

describe("labels without a name", () => {
  it("branch on an empty name", () => {
    expect(DEFAULT_COMMENTS_LABELS.edit("", "now")).toBe("Edit comment, now");
    expect(DEFAULT_COMMENTS_LABELS.remove("", "now")).toBe("Delete comment, now");
    expect(DEFAULT_COMMENTS_LABELS.confirmRemove("", "now")).toBe("Confirm delete of comment, now");
    expect(DEFAULT_COMMENTS_LABELS.resolve("", "now")).toBe("Resolve comment, now");
    expect(DEFAULT_COMMENTS_LABELS.reopen("", "now")).toBe("Reopen comment, now");
    expect(DEFAULT_COMMENTS_LABELS.announceAdded("")).toBe("Comment added");
    expect(DEFAULT_COMMENTS_LABELS.edit("Ada", "now")).toBe("Edit comment by Ada, now");
  });

  it("drop the open sentence without a chord and omit unresolved counts when resolve is off", () => {
    expect(DEFAULT_COMMENTS_LABELS.announce(2, 1, "")).toBe("2 comments, 1 unresolved.");
    expect(DEFAULT_COMMENTS_LABELS.announce(1, 1, "Shift+F2")).toContain("Press Shift+F2 to open.");
    expect(DEFAULT_COMMENTS_LABELS.announceCount(1, "Shift+F2")).toBe("1 comment. Press Shift+F2 to open.");
  });
});
