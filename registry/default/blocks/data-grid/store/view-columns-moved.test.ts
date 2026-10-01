import { afterEach, describe, expect, it, vi } from "vitest";
import { createDataGridStore } from "./create-store";
import { visibleColumnsMoved } from "./compute";
import type { AnyColumnDef, InternalSyncProps } from "./types";

vi.mock("./compute", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./compute")>();
  return { ...actual, visibleColumnsMoved: vi.fn(actual.visibleColumnsMoved) };
});

type Row = { id: string; name: string; age: number };

const columns = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "age", header: "Age", accessorKey: "age" },
];

function makeStore() {
  const store = createDataGridStore({
    data: [{ id: "1", name: "a", age: 1 }],
    columns,
    getRowId: (row) => (row as Row).id,
    enableColumnReorder: true,
    enableColumnPinning: true,
  } as InternalSyncProps);
  store.getState().actions._registerPresenceViewSpaceActive(() => true);
  return store;
}

function moveColumns(store: ReturnType<typeof makeStore>) {
  const { actions } = store.getState();
  actions.setColumnOrder("age", "name", "before");
  actions.setColumnPin("name", "left");
  actions.setColumnHidden("name", true);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(visibleColumnsMoved).mockClear();
});

describe("visibleColumnsMoved", () => {
  const name = columns[0] as AnyColumnDef;
  const age = columns[1] as AnyColumnDef;

  it("is false for the same array and for an appended trailing column", () => {
    const visible = [name];
    expect(visibleColumnsMoved(visible, visible)).toBe(false);
    expect(visibleColumnsMoved([name], [name, age])).toBe(false);
  });

  it("is true for a shrink and for a changed prefix", () => {
    expect(visibleColumnsMoved([name, age], [name])).toBe(true);
    expect(visibleColumnsMoved([name, age], [age, name])).toBe(true);
    expect(visibleColumnsMoved([age], [name, age])).toBe(true);
  });
});

describe("view-column compare for the presence warning", () => {
  it("runs in development when a view-space presence entry is active", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    moveColumns(makeStore());
    expect(visibleColumnsMoved).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not run outside development", () => {
    vi.stubEnv("NODE_ENV", "production");
    const store = makeStore();
    moveColumns(store);
    store.getState().actions._syncProps({
      data: [{ id: "1", name: "a", age: 1 }],
      columns: [...columns].reverse(),
      getRowId: (row: unknown) => (row as Row).id,
    } as InternalSyncProps);
    expect(visibleColumnsMoved).not.toHaveBeenCalled();
  });
});
