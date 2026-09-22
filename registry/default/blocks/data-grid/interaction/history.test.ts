import { describe, it, expect } from "vitest";
import { applyChange, createHistory, invertChange } from "./history";
import type { DataChange, DataOp } from "../types";

type Row = { id: string; name: string; age: number };

const getRowId = (row: Row) => row.id;

const rows: Row[] = [
  { id: "a", name: "Alice", age: 30 },
  { id: "b", name: "Bob", age: 25 },
  { id: "c", name: "Cara", age: 40 },
];

// Bit-identical copy of the pre-plan-004 implementation; the fuzz below is the semantic acceptance test for the rewrite.
function applyChangeLegacy<TData>(
  data: readonly TData[],
  change: DataChange<TData>,
  getRowId: (row: TData) => string,
): TData[] {
  let result = data.slice();
  const inserts: Extract<DataOp<TData>, { type: "insert" }>[] = [];
  for (const op of change.ops) {
    switch (op.type) {
      case "update": {
        const idx = result.findIndex((row) => getRowId(row) === op.rowId);
        if (idx === -1) break;
        result[idx] = op.row;
        break;
      }
      case "delete": {
        const idx = result.findIndex((row) => getRowId(row) === op.rowId);
        if (idx === -1) break;
        result = result.slice(0, idx).concat(result.slice(idx + 1));
        break;
      }
      case "insert":
        inserts.push(op);
        break;
    }
  }
  for (const op of [...inserts].sort((a, b) => a.index - b.index)) {
    const at = Math.min(op.index, result.length);
    result = result.slice(0, at).concat([op.row], result.slice(at));
  }
  return result;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("applyChange characterization fuzz", () => {
  it("matches the sequential legacy implementation across 500 random batches", () => {
    const rand = mulberry32(42);
    for (let iteration = 0; iteration < 500; iteration++) {
      const n = 1 + Math.floor(rand() * 500);
      const poolLength = Math.max(1, Math.floor(n / 2));
      const data: Row[] = Array.from({ length: n }, (_, i) => ({ id: `r-${i % poolLength}`, name: `name-${i}`, age: i }));
      const presentIds = Array.from({ length: poolLength }, (_, i) => `r-${i}`);
      const absentIds = Array.from({ length: 5 }, (_, i) => `absent-${i}`);
      const ops: DataOp<Row>[] = [];
      const opCount = Math.floor(rand() * 81);
      for (let j = 0; j < opCount; j++) {
        const rowId = rand() < 0.6 ? presentIds[Math.floor(rand() * presentIds.length)]! : absentIds[Math.floor(rand() * absentIds.length)]!;
        const opKind = rand();
        if (opKind < 0.5) {
          ops.push({ type: "update", rowId, row: { id: rowId, name: "updated", age: 1 }, prev: { id: rowId, name: "prev", age: 0 } });
        } else if (opKind < 0.8) {
          ops.push({ type: "delete", rowId, row: { id: rowId, name: "deleted", age: 2 }, index: Math.floor(rand() * (n + 1)) });
        } else {
          const insertId = `ins-${iteration}-${j}`;
          ops.push({ type: "insert", rowId: insertId, row: { id: insertId, name: "inserted", age: 3 }, index: Math.floor(rand() * (n + 6)) });
        }
      }
      if (ops.length > 0) {
        const repeated = ops[0]!;
        if (repeated.type === "insert") {
          const repeatId = `ins-${iteration}-repeat`;
          ops.push({ type: "insert", rowId: repeatId, row: { id: repeatId, name: "inserted", age: 3 }, index: repeated.index });
        } else {
          ops.push({ ...repeated });
        }
      }
      const change: DataChange<Row> = { source: "edit", ops };
      expect(applyChange(data, change, getRowId), `fuzz iteration ${iteration}`).toEqual(applyChangeLegacy(data, change, getRowId));
    }
  });
});

describe("invertChange", () => {
  it("swaps row/prev and re-tags source for update ops", () => {
    const change: DataChange<Row> = {
      source: "edit",
      ops: [
        {
          type: "update",
          rowId: "a",
          row: { id: "a", name: "Alicia", age: 30 },
          prev: { id: "a", name: "Alice", age: 30 },
          cells: [{ columnId: "name", value: "Alicia", prev: "Alice" }],
        },
      ],
    };
    const inverted = invertChange(change);
    expect(inverted.source).toBe("history");
    expect(inverted.ops).toEqual([
      {
        type: "update",
        rowId: "a",
        row: { id: "a", name: "Alice", age: 30 },
        prev: { id: "a", name: "Alicia", age: 30 },
        cells: [{ columnId: "name", value: "Alice", prev: "Alicia" }],
      },
    ]);
  });

  it("turns insert into delete and vice versa, preserving rowId/index", () => {
    const insert: DataChange<Row> = {
      source: "row-op",
      ops: [{ type: "insert", rowId: "d", row: { id: "d", name: "Dana", age: 22 }, index: 1 }],
    };
    expect(invertChange(insert).ops).toEqual([
      { type: "delete", rowId: "d", row: { id: "d", name: "Dana", age: 22 }, index: 1 },
    ]);

    const del: DataChange<Row> = {
      source: "row-op",
      ops: [{ type: "delete", rowId: "b", row: rows[1]!, index: 1 }],
    };
    expect(invertChange(del).ops).toEqual([{ type: "insert", rowId: "b", row: rows[1], index: 1 }]);
  });

  it("swaps from/to for move ops (the row sits at `to` after the batch)", () => {
    const move: DataChange<Row> = {
      source: "row-op",
      ops: [{ type: "move", rowId: "a", row: rows[0]!, from: 0, to: 2 }],
    };
    expect(invertChange(move).ops).toEqual([{ type: "move", rowId: "a", row: rows[0], from: 2, to: 0 }]);
  });

  it("reverses op order for multi-op batches", () => {
    const change: DataChange<Row> = {
      source: "delete",
      ops: [
        { type: "delete", rowId: "a", row: rows[0]!, index: 0 },
        { type: "delete", rowId: "b", row: rows[1]!, index: 1 },
      ],
    };
    const inverted = invertChange(change);
    expect(inverted.ops.map((op) => op.rowId)).toEqual(["b", "a"]);
    expect(inverted.ops.every((op) => op.type === "insert")).toBe(true);
  });
});

describe("applyChange", () => {
  it("replaces the row found by id for update ops, ignoring stored index", () => {
    const change: DataChange<Row> = {
      source: "edit",
      ops: [
        {
          type: "update",
          rowId: "b",
          row: { id: "b", name: "Bobby", age: 26 },
          prev: rows[1]!,
        },
      ],
    };
    const result = applyChange(rows, change, getRowId);
    expect(result).not.toBe(rows);
    expect(result.find((r) => r.id === "b")).toEqual({ id: "b", name: "Bobby", age: 26 });
    expect(result).toHaveLength(3);
  });

  it("removes the row found by id for delete ops", () => {
    const change: DataChange<Row> = {
      source: "delete",
      ops: [{ type: "delete", rowId: "a", row: rows[0]!, index: 0 }],
    };
    const result = applyChange(rows, change, getRowId);
    expect(result.map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("inserts at min(index, length)", () => {
    const change: DataChange<Row> = {
      source: "row-op",
      ops: [{ type: "insert", rowId: "d", row: { id: "d", name: "Dana", age: 22 }, index: 99 }],
    };
    const result = applyChange(rows, change, getRowId);
    expect(result.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("applies move ops as a delete-by-id + insert at the post-move slot", () => {
    const change: DataChange<Row> = {
      source: "row-op",
      ops: [{ type: "move", rowId: "a", row: rows[0]!, from: 0, to: 2 }],
    };
    const result = applyChange(rows, change, getRowId);
    expect(result.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("round-trips a move batch through applyChange/invertChange", () => {
    const change: DataChange<Row> = {
      source: "row-op",
      ops: [{ type: "move", rowId: "c", row: rows[2]!, from: 2, to: 0 }],
    };
    const moved = applyChange(rows, change, getRowId);
    expect(moved.map((r) => r.id)).toEqual(["c", "a", "b"]);
    const restored = applyChange(moved, invertChange(change), getRowId);
    expect(restored.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("skips unknown ids silently for update/delete", () => {
    const change: DataChange<Row> = {
      source: "edit",
      ops: [
        {
          type: "update",
          rowId: "ghost",
          row: { id: "ghost", name: "Nope", age: 1 },
          prev: { id: "ghost", name: "Nope", age: 1 },
        },
        { type: "delete", rowId: "also-ghost", row: rows[0]!, index: 0 },
      ],
    };
    const result = applyChange(rows, change, getRowId);
    expect(result).toEqual(rows);
  });

  it("does not mutate the input array", () => {
    const original = rows.map((r) => ({ ...r }));
    const change: DataChange<Row> = {
      source: "edit",
      ops: [{ type: "update", rowId: "a", row: { id: "a", name: "X", age: 0 }, prev: rows[0]! }],
    };
    applyChange(rows, change, getRowId);
    expect(rows).toEqual(original);
  });
});

describe("createHistory", () => {
  it("round-trips undo/redo restoring deep-equal data", () => {
    const history = createHistory<Row>();
    const change: DataChange<Row> = {
      source: "edit",
      ops: [
        {
          type: "update",
          rowId: "a",
          row: { id: "a", name: "Alicia", age: 31 },
          prev: rows[0]!,
        },
      ],
    };
    history.push(change);

    let data = applyChange(rows, change, getRowId);
    expect(data.find((r) => r.id === "a")).toEqual({ id: "a", name: "Alicia", age: 31 });

    const undoChange = history.undo();
    expect(undoChange).not.toBeNull();
    data = applyChange(data, undoChange!, getRowId);
    expect(data).toEqual(rows);

    const redoChange = history.redo();
    expect(redoChange).toEqual({ ...change, source: "history" });
    data = applyChange(data, redoChange!, getRowId);
    expect(data.find((r) => r.id === "a")).toEqual({ id: "a", name: "Alicia", age: 31 });
  });

  it("id-keyed update survives the array being re-sorted between push and undo", () => {
    const history = createHistory<Row>();
    const change: DataChange<Row> = {
      source: "edit",
      ops: [
        {
          type: "update",
          rowId: "c",
          row: { id: "c", name: "Cara", age: 41 },
          prev: rows[2]!,
        },
      ],
    };
    history.push(change);

    let data = applyChange(rows, change, getRowId);
    // re-sort by age ascending — row "c" is no longer at its original index
    data = [...data].sort((x, y) => x.age - y.age);
    expect(data.map((r) => r.id)).toEqual(["b", "a", "c"]);

    const undoChange = history.undo();
    data = applyChange(data, undoChange!, getRowId);
    const restored = data.find((r) => r.id === "c");
    expect(restored).toEqual(rows[2]);
  });

  it("re-tags redo's change source 'history' so push() ignores it (feedback-loop guard)", () => {
    const history = createHistory<Row>();
    const change: DataChange<Row> = {
      source: "edit",
      ops: [{ type: "update", rowId: "a", row: { id: "a", name: "Alicia", age: 31 }, prev: rows[0]! }],
    };
    history.push(change);
    history.undo();
    const redoChange = history.redo();
    expect(redoChange?.source).toBe("history");

    // simulate a pipeline where applied changes flow back into push()
    history.push(redoChange!);
    expect(history.size).toBe(1);
    expect(history.canRedo).toBe(false);
  });

  it("round-trips a multi-row delete batch (snapshot indices) through invertChange/applyChange", () => {
    const change: DataChange<Row> = {
      source: "delete",
      ops: [
        { type: "delete", rowId: "a", row: rows[0]!, index: 0 },
        { type: "delete", rowId: "b", row: rows[1]!, index: 1 },
      ],
    };
    const deleted = applyChange(rows, change, getRowId);
    expect(deleted.map((r) => r.id)).toEqual(["c"]);

    const restored = applyChange(deleted, invertChange(change), getRowId);
    expect(restored).toEqual(rows);
  });

  it("evicts the oldest entry once capacity is exceeded", () => {
    const history = createHistory<Row>({ capacity: 2 });
    const makeChange = (rowId: string): DataChange<Row> => ({
      source: "edit",
      ops: [
        {
          type: "update",
          rowId,
          row: { id: rowId, name: "x", age: 0 },
          prev: { id: rowId, name: "y", age: 1 },
        },
      ],
    });

    history.push(makeChange("1"));
    history.push(makeChange("2"));
    history.push(makeChange("3"));
    expect(history.size).toBe(2);

    const first = history.undo();
    expect(first?.ops[0]!.rowId).toBe("3");
    const second = history.undo();
    expect(second?.ops[0]!.rowId).toBe("2");
    expect(history.canUndo).toBe(false);
    expect(history.undo()).toBeNull();
  });

  it("discards the redo branch when a new change is pushed", () => {
    const history = createHistory<Row>();
    const makeChange = (rowId: string): DataChange<Row> => ({
      source: "edit",
      ops: [
        {
          type: "update",
          rowId,
          row: { id: rowId, name: "x", age: 0 },
          prev: { id: rowId, name: "y", age: 1 },
        },
      ],
    });

    history.push(makeChange("1"));
    history.undo();
    expect(history.canRedo).toBe(true);

    history.push(makeChange("2"));
    expect(history.canRedo).toBe(false);
    expect(history.redo()).toBeNull();
  });

  it("ignores pushes with source 'history' to prevent feedback loops", () => {
    const history = createHistory<Row>();
    history.push({
      source: "history",
      ops: [{ type: "update", rowId: "a", row: rows[0]!, prev: rows[0]! }],
    });
    expect(history.size).toBe(0);
    expect(history.canUndo).toBe(false);
  });

  it("round-trips an insert through push/undo/redo (undo removes by id, redo re-inserts)", () => {
    const history = createHistory<Row>();
    const change: DataChange<Row> = {
      source: "row-op",
      ops: [{ type: "insert", rowId: "d", row: { id: "d", name: "Dana", age: 22 }, index: 3 }],
    };
    history.push(change);

    let data = applyChange(rows, change, getRowId);
    expect(data.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);

    data = applyChange(data, history.undo()!, getRowId);
    expect(data.map((r) => r.id)).toEqual(["a", "b", "c"]);

    data = applyChange(data, history.redo()!, getRowId);
    expect(data.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("round-trips a delete through push/undo/redo (undo re-inserts, redo removes by id)", () => {
    const history = createHistory<Row>();
    const change: DataChange<Row> = {
      source: "delete",
      ops: [{ type: "delete", rowId: "b", row: rows[1]!, index: 1 }],
    };
    history.push(change);

    let data = applyChange(rows, change, getRowId);
    expect(data.map((r) => r.id)).toEqual(["a", "c"]);

    data = applyChange(data, history.undo()!, getRowId);
    expect(data.map((r) => r.id)).toEqual(["a", "b", "c"]);

    data = applyChange(data, history.redo()!, getRowId);
    expect(data.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("clear() empties both stacks", () => {
    const history = createHistory<Row>();
    history.push({
      source: "edit",
      ops: [{ type: "update", rowId: "a", row: rows[0]!, prev: rows[0]! }],
    });
    history.undo();
    history.clear();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.size).toBe(0);
  });
});

// Shared CI runners are several × slower than a dev machine; the ceiling guards the
// order of magnitude, not machine jitter.
const CI_FACTOR = process.env["CI"] ? 2 : 1;

describe("applyChange scale guard (100k rows)", () => {
  it("applies a 500-op batch scattered through the end of the data without an O(n^2) freeze", () => {
    const n = 100_000;
    const data: Row[] = Array.from({ length: n }, (_, i) => ({ id: `r-${i}`, name: `name-${i}`, age: i }));
    const ops: DataOp<Row>[] = [];
    for (let i = 0; i < 250; i++) {
      const id = `r-${n - 1 - i * 200}`;
      ops.push({ type: "update", rowId: id, row: { id, name: "updated", age: 1 }, prev: { id, name: "prev", age: 0 } });
    }
    for (let i = 0; i < 125; i++) {
      const id = `r-${n - 500 - i * 200}`;
      ops.push({ type: "delete", rowId: id, row: { id, name: "deleted", age: 2 }, index: n - 500 - i * 200 });
    }
    for (let i = 0; i < 125; i++) {
      const id = `ins-${i}`;
      ops.push({ type: "insert", rowId: id, row: { id, name: "inserted", age: 3 }, index: n - 1 - i * 200 });
    }
    const change: DataChange<Row> = { source: "edit", ops };

    let warmupMs = 0;
    const start = performance.now();
    applyChange(data, change, getRowId);
    warmupMs = performance.now() - start;
    const startTimed = performance.now();
    for (let i = 0; i < 3; i++) applyChange(data, change, getRowId);
    const ms = (performance.now() - startTimed) / 3;
    console.log(`applyChange 100k rows / 500-op batch: warmup=${warmupMs.toFixed(2)}ms mean=${ms.toFixed(2)}ms`);
    // ~5x the measured ~15ms local mean (×CI_FACTOR on CI); catches an accidental O(n^2).
    expect(ms).toBeLessThan(80 * CI_FACTOR);
  });
});
