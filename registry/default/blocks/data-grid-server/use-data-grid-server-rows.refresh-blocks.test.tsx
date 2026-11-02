import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, DataGridRoot, defineColumns, type DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { useDataGridServerRows, type ServerRowsAnswer, type ServerRowsRequest, type UseDataGridServerRowsScrollResult } from "./use-data-grid-server-rows";

type Row = { id: string; name: string };
type Held = { request: ServerRowsRequest<number>; resolve: () => void; reject: () => void };

const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text" }] as const);
const SIZE = 10;
const TOTAL = 100;
const rowAt = (index: number, shift: number, suffix: string): Row => (index < shift ? { id: `new${index}`, name: `New ${index}` } : { id: `r${index - shift}`, name: `Person ${index - shift}${suffix}` });

type Source = "counted" | "cursor";

function setup(source: Source, { getRowId = (row: Row) => row.id, total = TOTAL }: { getRowId?: (row: Row) => string; total?: number } = {}) {
  let shift = 0;
  let suffix = "";
  let hold = false;
  const held: Held[] = [];
  const fetchRows = vi.fn((request: ServerRowsRequest<number>) => {
    const { start, end } = request;
    const from = source === "cursor" ? (request.cursor ?? 0) : start;
    const stop = source === "counted" ? Math.min(end, total) : end;
    const answer = (): ServerRowsAnswer<Row, number> => ({
      rows: Array.from({ length: stop - from }, (_, i) => rowAt(from + i, shift, suffix)),
      ...(source === "counted" ? { totalRowCount: total } : { nextCursor: from + (stop - from) }),
    });
    if (!hold) return Promise.resolve(answer());
    return new Promise<ServerRowsAnswer<Row, number>>((resolve, reject) => held.push({ request, resolve: () => resolve(answer()), reject: () => reject(new Error("boom")) }));
  });
  let server!: UseDataGridServerRowsScrollResult<Row>;
  let store!: StoreApi<DataGridStoreState>;
  const saves: Array<() => void> = [];
  const onSave = (_change: DataChange<Row>) => new Promise<void>((resolve) => saves.push(resolve));
  function Probe() {
    store = useDataGridStoreApi() as unknown as StoreApi<DataGridStoreState>;
    return null;
  }
  function Harness() {
    server = useDataGridServerRows<Row, number>({ mode: "scroll", getRowId, fetchRows, blockSize: SIZE, overscan: 0 });
    return (
      <DataGridProvider {...server.providerProps} columns={columns} onSave={onSave}>
        <DataGridRoot>
          <Probe />
        </DataGridRoot>
      </DataGridProvider>
    );
  }
  render(<Harness />);
  return {
    server: () => server,
    state: () => store.getState(),
    held,
    saves,
    setShift: (next: number) => (shift = next),
    setSuffix: (next: string) => (suffix = next),
    holdAnswers: () => (hold = true),
    window: (end: number, start = 0) => act(() => server.gridProps.onRenderedRowsChange?.({ start, end })),
    ids: () => server.gridProps.data.filter((row) => row !== undefined).map((row) => row.id),
    nameOf: (id: string) => server.gridProps.data.find((row) => row?.id === id)?.name,
    ready: () => waitFor(() => expect(server.loading).toBe(false)),
    land: async (start: number) => {
      const index = held.findIndex((entry) => entry.request.start === start);
      expect(index).toBeGreaterThanOrEqual(0);
      await act(async () => held.splice(index, 1)[0]!.resolve());
    },
    fail: async (start: number) => {
      const index = held.findIndex((entry) => entry.request.start === start);
      expect(index).toBeGreaterThanOrEqual(0);
      await act(async () => held.splice(index, 1)[0]!.reject());
    },
    waitHeld: (start: number) => waitFor(() => expect(held.some((entry) => entry.request.start === start)).toBe(true)),
  };
}

async function loadTwoBlocks(t: ReturnType<typeof setup>) {
  await t.ready();
  t.window(15);
  await waitFor(() => expect(t.server().gridProps.data[SIZE]).toBeDefined());
  await t.ready();
}

afterEach(() => vi.restoreAllMocks());

describe("a protected row that crosses a block boundary during a refresh", () => {
  it("keeps its local value across separate commits, sequential source", async () => {
    const t = setup("cursor");
    await loadTwoBlocks(t);
    act(() => t.state().actions.commitCellValue({ rowId: "r9", columnId: "name" }, "Saved"));
    t.holdAnswers();
    t.setShift(1);
    t.setSuffix("!");
    act(() => t.server().refresh());
    await t.waitHeld(0);
    await t.land(0);
    await waitFor(() => expect(t.server().gridProps.data[0]?.id).toBe("new0"));
    await t.waitHeld(SIZE);
    await t.land(SIZE);
    await waitFor(() => expect(t.nameOf("r10")).toBe("Person 10!"));
    expect(t.nameOf("r9")).toBe("Saved");
    expect(t.ids().filter((id) => id === "r9")).toHaveLength(1);
  });

  it.each([
    ["old slot first", [0, SIZE]],
    ["new slot first", [SIZE, 0]],
  ] as const)("keeps its local value when blocks land in either order, counted source (%s)", async (_label, order) => {
    const t = setup("counted");
    await loadTwoBlocks(t);
    act(() => t.state().actions.commitCellValue({ rowId: "r9", columnId: "name" }, "Saved"));
    t.holdAnswers();
    t.setShift(1);
    t.setSuffix("!");
    act(() => t.server().refresh());
    await t.waitHeld(0);
    await t.waitHeld(SIZE);
    await t.land(order[0]);
    await t.land(order[1]);
    await waitFor(() => expect(t.nameOf("r8")).toBe("Person 8!"));
    await waitFor(() => expect(t.nameOf("r10")).toBe("Person 10!"));
    expect(t.nameOf("r9")).toBe("Saved");
    expect(t.ids().filter((id) => id === "r9")).toHaveLength(1);
  });

  it("leaves no loaded hole at the old slot when the other block fails, counted source", async () => {
    const t = setup("counted");
    await loadTwoBlocks(t);
    act(() => t.state().actions.commitCellValue({ rowId: "r9", columnId: "name" }, "Saved"));
    t.holdAnswers();
    t.setShift(1);
    act(() => t.server().refresh());
    await t.waitHeld(0);
    await t.waitHeld(SIZE);
    await t.land(SIZE);
    await waitFor(() => expect(t.nameOf("r9")).toBe("Saved"));
    await t.fail(0);
    await waitFor(() => expect(t.server().status).toBe("error"));
    const data = t.server().gridProps.data;
    const loaded = t.server().getLoadedRanges();
    for (let i = 0; i < data.length; i++) {
      if (data[i] === undefined) expect(loaded.some((range) => i >= range.start && i < range.end)).toBe(false);
    }
  });
});

describe("a retried refresh block", () => {
  it("still keeps a row whose save is pending, counted source", async () => {
    const t = setup("counted");
    await loadTwoBlocks(t);
    act(() => t.state().actions.commitCellValue({ rowId: "r3", columnId: "name" }, "Saved"));
    t.holdAnswers();
    t.setSuffix("!");
    act(() => t.server().refresh());
    await t.waitHeld(0);
    await t.waitHeld(SIZE);
    await t.fail(0);
    await t.land(SIZE);
    await waitFor(() => expect(t.server().status).toBe("error"));
    act(() => t.server().retry());
    await t.waitHeld(0);
    await t.land(0);
    await waitFor(() => expect(t.nameOf("r4")).toBe("Person 4!"));
    expect(t.state().saveStatus.get("r3")).toBe("saving");
    expect(t.nameOf("r3")).toBe("Saved");
  });
});

describe("the end of a refresh snapshot", () => {
  it("does not outlive a failed refresh block that nobody retried", async () => {
    const t = setup("counted");
    await loadTwoBlocks(t);
    act(() => t.state().actions.commitCellValue({ rowId: "r3", columnId: "name" }, "Saved"));
    t.holdAnswers();
    t.setSuffix("!");
    act(() => t.server().refresh());
    await t.waitHeld(0);
    await t.waitHeld(SIZE);
    await t.fail(0);
    await t.land(SIZE);
    await waitFor(() => expect(t.server().status).toBe("error"));
    await act(async () => t.saves.splice(0).forEach((resolve) => resolve()));
    expect(t.state().saveStatus.get("r3")).toBeUndefined();
    act(() => t.server().refresh());
    await t.waitHeld(0);
    await t.waitHeld(SIZE);
    await t.land(0);
    await t.land(SIZE);
    await waitFor(() => expect(t.nameOf("r3")).toBe("Person 3!"));
  });

  it("does not outlive a failed refresh block once the window moved away from it", async () => {
    const t = setup("counted");
    await loadTwoBlocks(t);
    act(() => t.state().actions.commitCellValue({ rowId: "r3", columnId: "name" }, "Saved"));
    t.holdAnswers();
    t.setSuffix("!");
    act(() => t.server().refresh());
    await t.waitHeld(0);
    await t.waitHeld(SIZE);
    await t.fail(0);
    await t.land(SIZE);
    await act(async () => t.saves.splice(0).forEach((resolve) => resolve()));
    t.window(55, 50);
    act(() => t.server().evict({ start: 0, end: SIZE }));
    t.window(15);
    await t.waitHeld(0);
    await t.land(0);
    await waitFor(() => expect(t.nameOf("r3")).toBe("Person 3!"));
  });

  it("ends with the refresh's own blocks, not with a failed window-driven block", async () => {
    const t = setup("counted");
    await loadTwoBlocks(t);
    act(() => t.state().actions.commitCellValue({ rowId: "r3", columnId: "name" }, "Saved"));
    t.holdAnswers();
    t.setSuffix("!");
    act(() => t.server().refresh());
    t.window(35);
    await t.waitHeld(0);
    await t.waitHeld(SIZE);
    await t.waitHeld(2 * SIZE);
    await t.fail(2 * SIZE);
    await t.land(0);
    await t.land(SIZE);
    await waitFor(() => expect(t.nameOf("r4")).toBe("Person 4!"));
    act(() => t.state().actions.commitCellValue({ rowId: "r5", columnId: "name" }, "Edited"));
    await act(async () => t.saves.splice(0).forEach((resolve) => resolve()));
    act(() => t.server().evict({ start: 0, end: SIZE }));
    t.window(15);
    await t.waitHeld(0);
    await t.land(0);
    await waitFor(() => expect(t.nameOf("r5")).toBe("Person 5!"));
  });
});

describe("a retried refresh block after the window moved away", () => {
  it("still keeps a row whose save is pending", async () => {
    const t = setup("counted");
    await loadTwoBlocks(t);
    act(() => t.state().actions.commitCellValue({ rowId: "r3", columnId: "name" }, "Saved"));
    t.holdAnswers();
    t.setSuffix("!");
    act(() => t.server().refresh());
    await t.waitHeld(0);
    await t.waitHeld(SIZE);
    await t.fail(0);
    await t.land(SIZE);
    t.window(55, 50);
    await waitFor(() => expect(t.server().status).toBe("error"));
    act(() => t.server().retry());
    await t.waitHeld(0);
    await t.land(0);
    await waitFor(() => expect(t.nameOf("r4")).toBe("Person 4!"));
    expect(t.state().saveStatus.get("r3")).toBe("saving");
    expect(t.nameOf("r3")).toBe("Saved");
  });
});

describe("retry while a refresh runs", () => {
  it("keeps a row edited in a block still in flight, counted source", async () => {
    const t = setup("counted");
    await loadTwoBlocks(t);
    act(() => t.state().actions.commitCellValue({ rowId: "r3", columnId: "name" }, "Saved"));
    t.holdAnswers();
    t.setSuffix("!");
    act(() => t.server().refresh());
    await t.waitHeld(0);
    await t.waitHeld(SIZE);
    await t.fail(0);
    await waitFor(() => expect(t.server().status).toBe("error"));
    act(() => t.state().actions.commitCellValue({ rowId: "r12", columnId: "name" }, "Edited"));
    await act(async () => t.saves.splice(0).forEach((resolve) => resolve()));
    act(() => t.server().retry());
    await t.waitHeld(0);
    await t.land(SIZE);
    await t.land(0);
    await waitFor(() => expect(t.nameOf("r13")).toBe("Person 13!"));
    expect(t.nameOf("r12")).toBe("Edited");
  });
});

describe("retry of a window-driven block on a sequential source", () => {
  it("leaves no hole and no duplicate row when a saving row moved", async () => {
    const t = setup("cursor");
    await loadTwoBlocks(t);
    act(() => t.state().actions.commitCellValue({ rowId: "r19", columnId: "name" }, "Saved"));
    t.holdAnswers();
    t.setShift(1);
    t.window(25);
    await t.waitHeld(2 * SIZE);
    await t.fail(2 * SIZE);
    await waitFor(() => expect(t.server().status).toBe("error"));
    act(() => t.server().retry());
    await t.waitHeld(2 * SIZE);
    await t.land(2 * SIZE);
    await waitFor(() => expect(t.nameOf("r20")).toBeDefined());
    const data = t.server().gridProps.data;
    const loaded = data.slice(0, 29);
    expect(loaded.every((row) => row !== undefined)).toBe(true);
    const ids = loaded.map((row) => row!.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(t.nameOf("r19")).toBe("Saved");
  });
});

describe("the refresh guard on a huge sparse source", () => {
  it("never walks the whole row array", async () => {
    const t = setup("counted", { total: 2_000_000 });
    await loadTwoBlocks(t);
    act(() => t.state().actions.commitCellValue({ rowId: "r3", columnId: "name" }, "Saved"));
    const walked: number[] = [];
    const original = Array.prototype.forEach;
    vi.spyOn(Array.prototype, "forEach").mockImplementation(function (this: unknown[], ...args: Parameters<typeof original>) {
      if (this.length >= 1_000_000) walked.push(this.length);
      return original.apply(this, args);
    });
    t.holdAnswers();
    act(() => t.server().refresh());
    await t.waitHeld(0);
    act(() => t.state().actions.commitCellValue({ rowId: "r4", columnId: "name" }, "Edited"));
    await t.land(0);
    await t.land(SIZE);
    await waitFor(() => expect(t.server().loading).toBe(false));
    expect(t.nameOf("r3")).toBe("Saved");
    expect(walked).toEqual([]);
  }, 60_000);
});

describe("the refresh guard cost", () => {
  it.each<Source>(["counted", "cursor"])("looks up only the protected rows while a save is pending, %s source", async (source) => {
    const calls = { count: 0 };
    const t = setup(source, { getRowId: (row) => (calls.count++, row.id) });
    await t.ready();
    for (let end = 15; end <= 45; end += 10) {
      t.window(end);
      await t.ready();
    }
    act(() => t.state().actions.commitCellValue({ rowId: "r3", columnId: "name" }, "Saved"));
    await t.ready();
    const before = calls.count;
    for (let end = 55; end <= 95; end += 10) {
      t.window(end);
      await t.ready();
    }
    expect(t.state().saveStatus.get("r3")).toBe("saving");
    expect(calls.count - before).toBeLessThan(10);
  });
});
