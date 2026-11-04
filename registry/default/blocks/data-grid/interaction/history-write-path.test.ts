import { describe, expect, it } from "vitest";
import { createHistory } from "./history";
import type { DataChange } from "../types";

type Row = { id: string; name: string; age: number };

const a: Row = { id: "a", name: "Alice", age: 30 };
const b: Row = { id: "b", name: "Bob", age: 25 };

function edit(row: Row, name: string): DataChange<Row> {
  return { source: "edit", ops: [{ type: "update", rowId: row.id, row: { ...row, name }, prev: row }] };
}

describe("createHistory restore", () => {
  it("puts an undone entry back on the undo stack and off the redo stack", () => {
    const history = createHistory<Row>();
    history.push(edit(a, "x"));
    const inverted = history.undo()!;
    expect(history.restore(inverted)).toBe(true);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
  });

  it("puts a redone entry back on the redo stack and off the undo stack", () => {
    const history = createHistory<Row>();
    history.push(edit(a, "x"));
    history.undo();
    const replay = history.redo()!;
    expect(history.restore(replay)).toBe(true);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
  });

  it("restores only once", () => {
    const history = createHistory<Row>();
    history.push(edit(a, "x"));
    const inverted = history.undo()!;
    expect(history.restore(inverted)).toBe(true);
    expect(history.restore(inverted)).toBe(false);
    expect(history.size).toBe(1);
  });

  it("returns false and drops a refused undo whose redo branch a newer change discarded", () => {
    const history = createHistory<Row>();
    history.push(edit(a, "x"));
    const inverted = history.undo()!;
    history.push(edit(b, "y"));
    expect(history.restore(inverted)).toBe(false);
    expect(history.size).toBe(1);
  });

  it("drops a refused redo when a newer change sits above it", () => {
    const history = createHistory<Row>();
    history.push(edit(a, "x"));
    history.undo();
    const replay = history.redo()!;
    history.push(edit(b, "y"));
    expect(history.restore(replay)).toBe(false);
    expect(history.size).toBe(1);
    expect(history.canRedo).toBe(false);
  });

  it("discard resolves the change an undo returned to its entry", () => {
    const history = createHistory<Row>();
    history.push(edit(a, "x"));
    const inverted = history.undo()!;
    expect(history.discard(inverted)).toBe(true);
    expect(history.canRedo).toBe(false);
  });
});

describe("createHistory sources", () => {
  it("does not record merge or id-swap changes", () => {
    const history = createHistory<Row>();
    history.push({ ...edit(a, "x"), source: "merge" });
    history.push({ ...edit(a, "x"), source: "id-swap" });
    expect(history.size).toBe(0);
  });
});

describe("createHistory replaceRowId", () => {
  const server: Row = { id: "a2", name: "Alice", age: 31 };

  it("rewrites op ids and takes the differing fields into every snapshot of the row", () => {
    const history = createHistory<Row>();
    history.push(edit(a, "x"));
    expect(history.replaceRowId("a", "a2", a, server)).toBe(true);
    const inverted = history.undo()!;
    const [op] = inverted.ops;
    expect(op).toMatchObject({ type: "update", rowId: "a2", row: { id: "a2", name: "Alice", age: 31 } });
  });

  it("leaves ops of other rows untouched", () => {
    const history = createHistory<Row>();
    const other = edit(b, "y");
    history.push(other);
    history.replaceRowId("a", "a2", a, server);
    expect(history.undo()).toMatchObject({ ops: [{ rowId: "b", row: b }] });
  });

  it("patches insert and delete snapshots", () => {
    const history = createHistory<Row>();
    history.push({ source: "delete", ops: [{ type: "delete", rowId: "a", row: a, index: 0 }] });
    history.replaceRowId("a", "a2", a, server);
    expect(history.undo()!.ops[0]).toMatchObject({ type: "insert", rowId: "a2", row: { id: "a2", age: 31 } });
  });

  it("keeps the entry findable by the original change object", () => {
    const history = createHistory<Row>();
    const change = edit(a, "x");
    history.push(change);
    history.replaceRowId("a", "a2", a, server);
    expect(history.discard(change)).toBe(true);
    expect(history.canUndo).toBe(false);
  });

  it("drops an entry whose snapshot is not a plain object", () => {
    class Model {
      constructor(
        readonly id: string,
        readonly name: string,
      ) {}
    }
    const history = createHistory<Model>();
    const prev = new Model("a", "Alice");
    history.push({ source: "edit", ops: [{ type: "update", rowId: "a", row: new Model("a", "x"), prev }] });
    history.replaceRowId("a", "a2", { id: "a", name: "Alice" } as never, { id: "a2", name: "Alice" } as never);
    expect(history.canUndo).toBe(false);
  });

  it("drops an entry when the old or new row is not a plain object", () => {
    const history = createHistory<Row>();
    history.push(edit(a, "x"));
    history.replaceRowId("a", "a2", a, null as never);
    expect(history.canUndo).toBe(false);
  });
});

describe("createHistory dropRows", () => {
  it("removes the ops on the given ids and keeps the rest of an entry", () => {
    const history = createHistory<Row>();
    history.push({
      source: "paste",
      ops: [
        { type: "update", rowId: "a", row: { ...a, name: "x" }, prev: a },
        { type: "update", rowId: "b", row: { ...b, name: "y" }, prev: b },
      ],
    });
    history.dropRows(["a"]);
    expect(history.undo()!.ops).toMatchObject([{ rowId: "b" }]);
  });

  it("removes an entry that is left without ops, from both stacks", () => {
    const history = createHistory<Row>();
    history.push(edit(a, "x"));
    history.push(edit(a, "y"));
    history.undo();
    history.dropRows(["a"]);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it("keeps entries that do not touch the ids", () => {
    const history = createHistory<Row>();
    history.push(edit(b, "y"));
    history.dropRows(["a"]);
    expect(history.size).toBe(1);
  });
});
