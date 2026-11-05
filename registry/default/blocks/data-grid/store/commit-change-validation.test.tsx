import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, DataChange } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from ".";

type Row = { id: string; name: string; email: string };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "email", header: "Email", accessorKey: "email" },
];

const initial = (): Row[] => [
  { id: "a", name: "A", email: "a@x" },
  { id: "b", name: "B", email: "b@x" },
];

const needsAt = (row: Row): Record<string, string> | null => (row.email.includes("@") ? null : { email: "needs @" });

function mount(props: Partial<DataGridSyncProps<Row>> = {}) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const tree = (next: Partial<DataGridSyncProps<Row>>) => (
    <DataGridProvider columns={columns} getRowId={(row: Row) => row.id} defaultData={initial()} {...next}>
      <Probe />
    </DataGridProvider>
  );
  const view = render(tree(props));
  const state = () => api!.getState();
  return {
    state,
    rerender: (next: Partial<DataGridSyncProps<Row>>) => view.rerender(tree(next)),
    commit: (change: DataChange<unknown>) => act(() => state().actions.commitChange(change)),
    errors: () => Object.fromEntries(state().cellErrors),
  };
}

const flush = () => act(async () => {});
const insertOf = (row: Row, index: number) => ({ type: "insert" as const, rowId: row.id, row, index });
const replaceAll = (rows: Row[]): DataChange<unknown> => ({
  source: "import",
  ops: [...initial().map((row, index) => ({ type: "delete" as const, rowId: row.id, row, index })), ...rows.map(insertOf)],
});

afterEach(() => vi.restoreAllMocks());

describe("commitChange runs validateRow for imports and app changes", () => {
  it("validates the inserted rows of an import replace and surfaces their errors", () => {
    const validateRow = vi.fn(needsAt);
    const m = mount({ validateRow });
    m.commit(replaceAll([{ id: "n1", name: "N1", email: "bad" }, { id: "n2", name: "N2", email: "ok@x" }]));
    expect(validateRow.mock.calls.map(([row]) => (row as Row).id).sort()).toEqual(["n1", "n2"]);
    expect(m.errors()).toEqual({ "n1:email": "needs @" });
  });

  it("never validates the rows an import deletes", () => {
    const validateRow = vi.fn(needsAt);
    const m = mount({ validateRow });
    m.commit(replaceAll([{ id: "n1", name: "N1", email: "ok@x" }]));
    expect(validateRow.mock.calls.map(([, rowId]) => rowId)).toEqual(["n1"]);
  });

  it("validates an app update and clears the error once the row is fixed", () => {
    const m = mount({ validateRow: needsAt });
    const a = initial()[0]!;
    m.commit({ source: "app", ops: [{ type: "update", rowId: "a", row: { ...a, email: "bad" }, prev: a }] });
    expect(m.errors()).toEqual({ "a:email": "needs @" });
    m.commit({ source: "app", ops: [{ type: "update", rowId: "a", row: { ...a, email: "fixed@x" }, prev: { ...a, email: "bad" } }] });
    expect(m.errors()).toEqual({});
  });

  it.each(["history", "rollback", "merge", "id-swap", "stream", "edit"] as const)("does not run for source %s", (source) => {
    const validateRow = vi.fn(needsAt);
    const m = mount({ validateRow });
    const a = initial()[0]!;
    m.commit({ source, ops: [{ type: "update", rowId: "a", row: { ...a, name: "A2" }, prev: a }] });
    expect(validateRow).not.toHaveBeenCalled();
  });

  it("does nothing on a readOnly grid", () => {
    const validateRow = vi.fn(needsAt);
    const m = mount({ validateRow, readOnly: true });
    m.commit(replaceAll([{ id: "n1", name: "N1", email: "bad" }]));
    expect(validateRow).not.toHaveBeenCalled();
    expect(m.errors()).toEqual({});
  });

  it("an async verdict lands in cellErrors after the commit", async () => {
    const m = mount({ validateRow: (row: Row) => Promise.resolve(needsAt(row)) });
    m.commit(replaceAll([{ id: "n1", name: "N1", email: "bad" }]));
    expect(m.errors()).toEqual({});
    await flush();
    expect(m.errors()).toEqual({ "n1:email": "needs @" });
  });

  it("a newer commit supersedes a pending verdict of the same row", async () => {
    const answers = [Promise.resolve({ email: "stale" }), Promise.resolve(null)];
    const m = mount({ validateRow: (() => answers.shift()!) as never });
    m.commit(replaceAll([{ id: "n1", name: "N1", email: "bad" }]));
    const n1 = { id: "n1", name: "N1", email: "bad" };
    m.commit({ source: "app", ops: [{ type: "update", rowId: "n1", row: { ...n1, email: "ok@x" }, prev: n1 }] });
    await flush();
    expect(m.errors()).toEqual({});
  });

  it("a verdict for a row an import replaced meanwhile is dropped", async () => {
    let resolve!: (value: Record<string, string>) => void;
    const pending = new Promise<Record<string, string>>((res) => {
      resolve = res;
    });
    const m = mount({ validateRow: (() => pending) as never });
    m.commit(replaceAll([{ id: "n1", name: "N1", email: "bad" }]));
    m.commit({ source: "import", ops: [{ type: "delete", rowId: "n1", row: { id: "n1", name: "N1", email: "bad" }, index: 0 }] });
    resolve({ email: "late" });
    await flush();
    expect(m.errors()).toEqual({});
  });

  it("controlled data: the errors survive the consumer echo", () => {
    let data = initial();
    const onDataChange = (next: readonly Row[]) => {
      data = [...next];
    };
    const m = mount({ data, defaultData: undefined, onDataChange, validateRow: needsAt });
    m.commit(replaceAll([{ id: "n1", name: "N1", email: "bad" }]));
    m.rerender({ data, defaultData: undefined, onDataChange, validateRow: needsAt });
    expect(m.errors()).toEqual({ "n1:email": "needs @" });
  });

  it("server pagination: a page of imported rows is validated by its row ids", () => {
    const m = mount({ validateRow: needsAt, totalRowCount: 500 });
    m.commit(replaceAll([{ id: "p2-1", name: "P", email: "bad" }]));
    expect(m.errors()).toEqual({ "p2-1:email": "needs @" });
  });

  it("lazy (scroll) rows: an app update validates the loaded row and never a hole", () => {
    const validateRow = vi.fn(needsAt);
    const sparse = new Array<Row | undefined>(4);
    sparse[0] = initial()[0];
    sparse[2] = initial()[1];
    const m = mount({
      data: sparse as Row[],
      defaultData: undefined,
      validateRow,
      totalRowCount: 4,
      getRowId: ((row: Row | undefined, index: number) => (row ? row.id : `hole-${index}`)) as never,
    });
    const a = initial()[0]!;
    m.commit({ source: "app", ops: [{ type: "update", rowId: "a", row: { ...a, email: "bad" }, prev: a }] });
    expect(validateRow).toHaveBeenCalledTimes(1);
    expect(m.errors()).toEqual({ "a:email": "needs @" });
  });

  it("validates 100k imported rows in one commit within a sane budget", () => {
    const validateRow = vi.fn(needsAt);
    const m = mount({ validateRow });
    const rows = Array.from({ length: 100_000 }, (_, i) => ({ id: `n${i}`, name: `N${i}`, email: i % 1000 === 0 ? "bad" : "ok@x" }));
    const start = performance.now();
    m.commit(replaceAll(rows));
    const elapsed = performance.now() - start;
    expect(validateRow).toHaveBeenCalledTimes(100_000);
    expect(m.state().cellErrors.size).toBe(100);
    expect(elapsed).toBeLessThan(3000);
  });
});
