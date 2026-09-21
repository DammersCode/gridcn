import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { CellPatch, ColumnDef, DataChange, FilterSpec, SortSpec } from "../data-grid";
import {
  DataGridProvider,
  useDataGridActions,
  useDataGridActiveCell,
  useDataGridEditing,
  useDataGridRow,
  useDataGridSearchMatches,
  useDataGridSelection,
  useDataGridViewIndex,
  useDataGridViewStale,
} from "../store";
import { INCREMENTAL_PATCH_LIMIT } from "../sort-filter";
import { INCREMENTAL_VIEW_ASSERT_RATE, setIncrementalAssertRate } from "./compute";
import { createRowIndexCache, diffRowIndex, resolveReorder, touchesViewInputs } from "./row-index";
import * as sortFilter from "../sort-filter";

type Row = { id: string; name: string; price: number; note?: string };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "price", header: "Price", accessorKey: "price" },
  { id: "note", header: "Note", accessorKey: "note" },
  { id: "computed", header: "Computed", accessorFn: (r: Row) => r.price * 2 },
];

function rows(): Row[] {
  return [
    { id: "a", name: "Charlie", price: 30 },
    { id: "b", name: "Alice", price: 25 },
    { id: "c", name: "Bob", price: 40 },
  ];
}

const getRowId = (r: Row) => r.id;

type HarnessProps = {
  data?: Row[];
  defaultData?: Row[];
  sortState?: SortSpec[];
  filterState?: FilterSpec[];
  onDataChange?: (next: readonly Row[], change: DataChange<Row>) => void;
  columnsOverride?: readonly ColumnDef<Row, unknown>[];
  createRow?: (index: number) => Row;
  readOnly?: boolean;
};

/** Everything the streaming tests read, in one hook so a single `act()` sees a consistent snapshot. */
function useHarness() {
  return {
    actions: useDataGridActions(),
    viewIndex: useDataGridViewIndex(),
    viewStale: useDataGridViewStale(),
    searchMatches: useDataGridSearchMatches(),
    firstRow: useDataGridRow(0) as Row | undefined,
  };
}

function renderHarness(props: HarnessProps = {}) {
  const { data, defaultData, columnsOverride, ...rest } = props;
  const resolved = data ?? (defaultData ? undefined : rows());
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider
        data={resolved}
        defaultData={defaultData}
        columns={columnsOverride ?? columns}
        getRowId={getRowId}
        {...rest}
      >
        {children}
      </DataGridProvider>
    );
  }
  return renderHook(() => useHarness(), { wrapper: Wrapper });
}

/** Reads the store's current data array out of the last `onDataChange` payload. */
function lastData(onDataChange: ReturnType<typeof vi.fn>): readonly Row[] {
  return onDataChange.mock.calls.at(-1)![0] as readonly Row[];
}

describe("updateCells — patch application", () => {
  it("applies a patch addressed by row id", () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({ onDataChange });
    act(() => result.current.actions.updateCells([{ rowId: "b", columnId: "price", value: 99 }]));
    expect(lastData(onDataChange)[1]).toMatchObject({ id: "b", price: 99 });
  });

  it("resolves ids independent of view order under an active sort", () => {
    const onDataChange = vi.fn();
    // sorted by name: Alice(b), Bob(c), Charlie(a) — data order is a, b, c.
    const { result } = renderHarness({ onDataChange, sortState: [{ columnId: "name", direction: "asc" }] });
    expect(result.current.viewIndex).toEqual([1, 2, 0]);
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "price", value: 7 }]));
    const next = lastData(onDataChange);
    expect(next[0]).toMatchObject({ id: "a", price: 7 });
    expect(next[1]).toMatchObject({ id: "b", price: 25 });
  });

  it("ignores an unknown rowId", () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({ onDataChange });
    act(() => result.current.actions.updateCells([{ rowId: "nope", columnId: "price", value: 1 }]));
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("ignores an unknown columnId", () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({ onDataChange });
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "nope", value: 1 }]));
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("skips a readOnly column", () => {
    const onDataChange = vi.fn();
    const readOnlyColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name", readOnly: true },
      { id: "price", header: "Price", accessorKey: "price" },
    ];
    const { result } = renderHarness({ onDataChange, columnsOverride: readOnlyColumns });
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "name", value: "X" }]));
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("skips an accessorFn-only column, which has no write path", () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({ onDataChange });
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "computed", value: 1 }]));
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("skips a no-op value", () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({ onDataChange });
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "price", value: 30 }]));
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("dedupes duplicate patches to one cell, last write wins, prev held at the pre-batch value", () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({ onDataChange });
    act(() =>
      result.current.actions.updateCells([
        { rowId: "a", columnId: "price", value: 31 },
        { rowId: "a", columnId: "price", value: 32 },
      ]),
    );
    const change = onDataChange.mock.calls.at(-1)![1] as DataChange<Row>;
    expect(change.ops).toHaveLength(1);
    expect(change.ops[0]).toMatchObject({ type: "update", rowId: "a" });
    expect(change.ops[0]!.type === "update" && change.ops[0]!.cells).toEqual([
      { columnId: "price", value: 32, prev: 30 },
    ]);
  });

  it("writes a hidden column, which a streaming producer must be able to reach", () => {
    const onDataChange = vi.fn();
    const hiddenColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "price", header: "Price", accessorKey: "price", hidden: true },
    ];
    const { result } = renderHarness({ onDataChange, columnsOverride: hiddenColumns });
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "price", value: 55 }]));
    expect(lastData(onDataChange)[0]).toMatchObject({ id: "a", price: 55 });
  });

  it("preserves the identity of untouched rows", () => {
    const onDataChange = vi.fn();
    const data = rows();
    const { result } = renderHarness({ onDataChange, data });
    act(() => result.current.actions.updateCells([{ rowId: "b", columnId: "price", value: 99 }]));
    const next = lastData(onDataChange);
    expect(next[0]).toBe(data[0]);
    expect(next[2]).toBe(data[2]);
    expect(next[1]).not.toBe(data[1]);
  });

  it("emits one batched DataChange tagged stream, with id-keyed ops", () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({ onDataChange });
    act(() =>
      result.current.actions.updateCells([
        { rowId: "a", columnId: "price", value: 1 },
        { rowId: "c", columnId: "price", value: 2 },
      ]),
    );
    expect(onDataChange).toHaveBeenCalledTimes(1);
    const change = onDataChange.mock.calls[0]![1] as DataChange<Row>;
    expect(change.source).toBe("stream");
    expect(change.ops.map((op) => op.rowId).sort()).toEqual(["a", "c"]);
  });

  it("honors an explicit source, so a batch can be made undoable", () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({ onDataChange });
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "price", value: 1 }], { source: "edit" }));
    expect((onDataChange.mock.calls[0]![1] as DataChange<Row>).source).toBe("edit");
  });

  it("does nothing for an empty patch list", () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({ onDataChange });
    act(() => result.current.actions.updateCells([]));
    expect(onDataChange).not.toHaveBeenCalled();
  });
});

describe("updateCells — validation", () => {
  const validated: readonly ColumnDef<Row, unknown>[] = [
    { id: "name", header: "Name", accessorKey: "name" },
    {
      id: "price",
      header: "Price",
      accessorKey: "price",
      validate: (value: unknown) => (typeof value === "number" && value < 0 ? "must be >= 0" : null),
    },
  ];

  it("silently skips a cell that fails validate and keeps the rest of the batch", () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({
      onDataChange,
      columnsOverride: validated,
    });
    act(() =>
      result.current.actions.updateCells([
        { rowId: "a", columnId: "price", value: -5 },
        { rowId: "b", columnId: "price", value: 12 },
      ]),
    );
    const next = lastData(onDataChange);
    expect(next[0]!.price).toBe(30);
    expect(next[1]!.price).toBe(12);
  });

  it("skipValidation writes the value unchecked", () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({
      onDataChange,
      columnsOverride: validated,
    });
    act(() =>
      result.current.actions.updateCells([{ rowId: "a", columnId: "price", value: -5 }], { skipValidation: true }),
    );
    expect(lastData(onDataChange)[0]!.price).toBe(-5);
  });
});

describe("updateCells — async validation", () => {
  /** Async schema over `price`: negatives reject, everything else rounds. */
  const asyncPrice = {
    "~standard": {
      version: 1,
      vendor: "mock",
      validate: async (value: unknown) =>
        typeof value === "number" && value < 0 ? { issues: [{ message: "must be >= 0" }] } : { value: Math.round(value as number) },
    },
  };

  const asyncColumns: readonly ColumnDef<Row, unknown>[] = [
    { id: "name", header: "Name", accessorKey: "name" },
    { id: "price", header: "Price", accessorKey: "price", validate: asyncPrice as never },
  ];

  it("applies nothing until the schema resolves, then commits in ONE DataChange", async () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({ onDataChange, columnsOverride: asyncColumns });

    act(() =>
      result.current.actions.updateCells([
        { rowId: "a", columnId: "price", value: 12.4 },
        { rowId: "b", columnId: "price", value: 7.6 },
      ]),
    );
    expect(onDataChange).not.toHaveBeenCalled();
    expect(result.current.firstRow!.price).toBe(30);

    await vi.waitFor(() => expect(onDataChange).toHaveBeenCalledTimes(1));
    const next = lastData(onDataChange);
    expect(next[0]!.price).toBe(12); // the schema's transformed value, not the raw input
    expect(next[1]!.price).toBe(8);
  });

  it("drops a failing cell silently and still commits the rest", async () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({ onDataChange, columnsOverride: asyncColumns });
    act(() =>
      result.current.actions.updateCells([
        { rowId: "a", columnId: "price", value: -5 },
        { rowId: "b", columnId: "price", value: 12 },
      ]),
    );
    await vi.waitFor(() => expect(onDataChange).toHaveBeenCalledTimes(1));
    const next = lastData(onDataChange);
    expect(next[0]!.price).toBe(30);
    expect(next[1]!.price).toBe(12);
  });

  it("a batch where every cell fails commits nothing at all", async () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({ onDataChange, columnsOverride: asyncColumns });
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "price", value: -5 }]));
    // Nothing to wait FOR here (proving an absence) — await the same schema fn this batch runs, so the
    // wait is sized to the real async dependency instead of a guessed tick count.
    await act(() => asyncPrice["~standard"].validate(-5) as Promise<unknown>);
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("skipValidation stays the trusted-feed fast path — synchronous, no await", () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({ onDataChange, columnsOverride: asyncColumns });
    act(() =>
      result.current.actions.updateCells([{ rowId: "a", columnId: "price", value: -5 }], { skipValidation: true }),
    );
    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect(lastData(onDataChange)[0]!.price).toBe(-5);
  });

  it("defer/viewStale only ever sees validated values: viewStale flips on the APPLY, not the hold", async () => {
    const { result } = renderHarness({
      columnsOverride: asyncColumns,
      sortState: [{ columnId: "price", direction: "asc" }],
    });
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "price", value: 1.2 }]));
    expect(result.current.viewStale).toBe(false);
    await vi.waitFor(() => expect(result.current.viewStale).toBe(true));
  });

  it("a newer batch supersedes a held one — the older resolution never lands", async () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({ onDataChange, columnsOverride: asyncColumns });
    act(() => {
      result.current.actions.updateCells([{ rowId: "a", columnId: "price", value: 11 }]);
      result.current.actions.updateCells([{ rowId: "a", columnId: "price", value: 22 }]);
    });
    await vi.waitFor(() => expect(onDataChange).toHaveBeenCalledTimes(1));
    expect(lastData(onDataChange)[0]!.price).toBe(22);
  });

  it("a sync column in the same grid keeps the fully synchronous path", () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({ onDataChange, columnsOverride: asyncColumns });
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "name", value: "Zoe" }]));
    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect(lastData(onDataChange)[0]!.name).toBe("Zoe");
  });

  /** Standard Schema whose validate() returns a plain result, not a Promise — still enters the async branch via patchesNeedAsyncCheck's structural test. */
  const syncNote = {
    "~standard": {
      version: 1,
      vendor: "mock",
      validate: (value: unknown) => ({ value }),
    },
  };

  it("a sync-Standard-Schema batch on another row does not discard a held async batch", async () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({
      onDataChange,
      columnsOverride: [...asyncColumns, { id: "note", header: "Note", accessorKey: "note", validate: syncNote as never }],
    });
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "price", value: 11 }]));
    act(() => result.current.actions.updateCells([{ rowId: "b", columnId: "note", value: "synced" }]));
    await vi.waitFor(() => expect(onDataChange).toHaveBeenCalledTimes(2));
    const next = lastData(onDataChange);
    expect(next[0]!.price).toBe(11);
    expect(next[1]!.note).toBe("synced");
  });
});

describe("updateCells — sort/filter reconciliation", () => {
  it("preserves viewIndex identity under the default defer", () => {
    const { result } = renderHarness({ sortState: [{ columnId: "name", direction: "asc" }] });
    const before = result.current.viewIndex;
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "name", value: "Aaron" }]));
    expect(result.current.viewIndex).toBe(before);
  });

  it("flips viewStale when a touched column feeds the active sort", () => {
    const { result } = renderHarness({ sortState: [{ columnId: "name", direction: "asc" }] });
    expect(result.current.viewStale).toBe(false);
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "name", value: "Aaron" }]));
    expect(result.current.viewStale).toBe(true);
  });

  it("flips viewStale when a touched column feeds the active filter", () => {
    const { result } = renderHarness({
      filterState: [{ columnId: "name", operator: "contains", value: "a" }],
    });
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "name", value: "Zed" }]));
    expect(result.current.viewStale).toBe(true);
  });

  it("does not flip viewStale when no touched column feeds the sort — the auto-downgrade to never", () => {
    const { result } = renderHarness({ sortState: [{ columnId: "name", direction: "asc" }] });
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "price", value: 999 }]));
    expect(result.current.viewStale).toBe(false);
  });

  it("does not flip viewStale when no sort or filter is active", () => {
    const { result } = renderHarness();
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "name", value: "Zed" }]));
    expect(result.current.viewStale).toBe(false);
  });

  it("reorder never keeps viewStale false even on a sort column", () => {
    const { result } = renderHarness({ sortState: [{ columnId: "name", direction: "asc" }] });
    act(() =>
      result.current.actions.updateCells([{ rowId: "a", columnId: "name", value: "Aaron" }], { reorder: "never" }),
    );
    expect(result.current.viewStale).toBe(false);
  });

  it("reorder immediate rebuilds viewIndex and leaves the view fresh", () => {
    const { result } = renderHarness({ sortState: [{ columnId: "name", direction: "asc" }] });
    expect(result.current.viewIndex).toEqual([1, 2, 0]);
    act(() =>
      result.current.actions.updateCells([{ rowId: "a", columnId: "name", value: "Aaron" }], { reorder: "immediate" }),
    );
    expect(result.current.viewIndex).toEqual([0, 1, 2]);
    expect(result.current.viewStale).toBe(false);
  });

  it("reconcileView applies the deferred reorder and clears the flag", () => {
    const { result } = renderHarness({ sortState: [{ columnId: "name", direction: "asc" }] });
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "name", value: "Aaron" }]));
    expect(result.current.viewIndex).toEqual([1, 2, 0]);
    act(() => result.current.actions.reconcileView());
    expect(result.current.viewIndex).toEqual([0, 1, 2]);
    expect(result.current.viewStale).toBe(false);
  });

  it("reconcileView is a no-op when the view is not stale", () => {
    const { result } = renderHarness({ sortState: [{ columnId: "name", direction: "asc" }] });
    const before = result.current.viewIndex;
    act(() => result.current.actions.reconcileView());
    expect(result.current.viewIndex).toBe(before);
  });

  it("a sort change reconciles the stale view naturally", () => {
    // uncontrolled sort, so setSorts writes the store itself (a controlled sortState waits for the prop).
    const { result } = renderHarness({ defaultData: rows() });
    act(() => result.current.actions.setSorts([{ columnId: "name", direction: "asc" }]));
    expect(result.current.viewIndex).toEqual([1, 2, 0]);
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "name", value: "Aaron" }]));
    expect(result.current.viewStale).toBe(true);
    act(() => result.current.actions.setSorts([{ columnId: "name", direction: "asc" }]));
    expect(result.current.viewIndex).toEqual([0, 1, 2]);
    expect(result.current.viewStale).toBe(false);
  });
});

// --- Incremental view maintenance ----------------------------------------------------------------
// The store-level half of the equivalence bar: `"immediate"` and `reconcileView` take the
// incremental path, and each case asserts the SAME viewIndex a full rebuild produces.

describe("updateCells — incremental view maintenance", () => {
  const sortByName: SortSpec[] = [{ columnId: "name", direction: "asc" }];

  it("keeps viewIndex identity when an immediate patch moves no row", () => {
    const { result } = renderHarness({ sortState: sortByName });
    const before = result.current.viewIndex;
    act(() =>
      result.current.actions.updateCells([{ rowId: "a", columnId: "price", value: 999 }], { reorder: "immediate" }),
    );
    expect(result.current.viewIndex).toBe(before);
  });

  it("adds a row to the view when an immediate patch makes it pass the filter", () => {
    const { result } = renderHarness({
      filterState: [{ columnId: "name", operator: "startsWith", value: "A" }],
    });
    expect(result.current.viewIndex).toEqual([1]);
    act(() =>
      result.current.actions.updateCells([{ rowId: "c", columnId: "name", value: "Anna" }], { reorder: "immediate" }),
    );
    expect(result.current.viewIndex).toEqual([1, 2]);
  });

  it("drops a row from the view when an immediate patch makes it fail the filter", () => {
    const { result } = renderHarness({
      filterState: [{ columnId: "name", operator: "startsWith", value: "A" }],
    });
    act(() =>
      result.current.actions.updateCells([{ rowId: "b", columnId: "name", value: "Zed" }], { reorder: "immediate" }),
    );
    expect(result.current.viewIndex).toEqual([]);
  });

  it("reconcileView replays every deferred batch, not just the last one", () => {
    const { result } = renderHarness({ defaultData: rows() });
    act(() => result.current.actions.setSorts(sortByName));
    expect(result.current.viewIndex).toEqual([1, 2, 0]);
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "name", value: "Aaron" }]));
    act(() => result.current.actions.updateCells([{ rowId: "c", columnId: "name", value: "Zeta" }]));
    act(() => result.current.actions.reconcileView());
    // Aaron(a), Alice(b), Zeta(c)
    expect(result.current.viewIndex).toEqual([0, 1, 2]);
    expect(result.current.viewStale).toBe(false);
  });

  it("an immediate batch after a deferred one lands both rows correctly", () => {
    const { result } = renderHarness({ defaultData: rows() });
    act(() => result.current.actions.setSorts(sortByName));
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "name", value: "Aaron" }]));
    act(() =>
      result.current.actions.updateCells([{ rowId: "c", columnId: "name", value: "Zeta" }], { reorder: "immediate" }),
    );
    expect(result.current.viewIndex).toEqual([0, 1, 2]);
  });

  it("stays correct after a row insert invalidates the pending set", () => {
    const { result } = renderHarness({
      defaultData: rows(),
      createRow: (index: number) => ({ id: `new-${index}`, name: "Aaa", price: 0 }),
    });
    act(() => result.current.actions.setSorts(sortByName));
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "name", value: "Yankee" }]));
    act(() => result.current.actions.insertRow(0, "above"));
    act(() => result.current.actions.reconcileView());
    // The insert landed at data index 1 (view row 0 still points there while the view is stale), so
    // data is [a(Yankee), new(Aaa), b(Alice), c(Bob)] -> Aaa, Alice, Bob, Yankee.
    expect(result.current.viewIndex).toEqual([1, 2, 3, 0]);
  });

  it("stays correct after a user edit between two streaming ticks", () => {
    const { result } = renderHarness({ defaultData: rows() });
    act(() => result.current.actions.setSorts(sortByName));
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "name", value: "Yankee" }]));
    // commitCellValue writes a value outside updateCells, so the pending set can no longer be trusted.
    act(() => result.current.actions.commitCellValue({ col: 0, row: 0 }, "Xray"));
    act(() => result.current.actions.reconcileView());
    // b is now Xray: Bob(c), Xray(b), Yankee(a)
    expect(result.current.viewIndex).toEqual([2, 1, 0]);
  });

  it("a later immediate batch still places rows a wrong `never` assertion moved", () => {
    const { result } = renderHarness({ defaultData: rows() });
    act(() => result.current.actions.setSorts(sortByName));
    // The caller asserts nothing view-relevant changed, but `name` IS the sort column.
    act(() =>
      result.current.actions.updateCells([{ rowId: "a", columnId: "name", value: "Aaron" }], { reorder: "never" }),
    );
    expect(result.current.viewStale).toBe(false);
    act(() =>
      result.current.actions.updateCells([{ rowId: "c", columnId: "name", value: "Zeta" }], { reorder: "immediate" }),
    );
    // Aaron(a), Alice(b), Zeta(c) — the mis-declared row lands correctly anyway.
    expect(result.current.viewIndex).toEqual([0, 1, 2]);
  });

  it("the dev assertion re-derives the full index and agrees with it on every tick", () => {
    setIncrementalAssertRate(1);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { result } = renderHarness({ defaultData: rows() });
      act(() => result.current.actions.setSorts(sortByName));
      for (const value of ["Aaron", "Mike", "Zeta", "Bravo"]) {
        act(() =>
          result.current.actions.updateCells([{ rowId: "a", columnId: "name", value }], { reorder: "immediate" }),
        );
      }
      expect(spy).not.toHaveBeenCalled();
      // Alice(b), Bob(c), Bravo(a) — "Bob" sorts before "Bravo"
      expect(result.current.viewIndex).toEqual([1, 2, 0]);
    } finally {
      spy.mockRestore();
      setIncrementalAssertRate(0);
    }
  });

  it("at the real default rate, the dev assertion samples rather than firing always or never", () => {
    // exercises the module's own default (0.05), not a test-forced 0/1 — a stubbed RNG makes the sample deterministic.
    // buildViewIndex is the reference rebuild the valve calls only when it samples, so counting its
    // calls is the real signal for "did sampling fire this tick" (Math.random's call count is not,
    // since the condition calls it unconditionally every tick regardless of outcome).
    setIncrementalAssertRate(INCREMENTAL_VIEW_ASSERT_RATE);
    const buildSpy = vi.spyOn(sortFilter, "buildViewIndex");
    const randomSpy = vi.spyOn(Math, "random");
    try {
      const { result } = renderHarness({ defaultData: rows() });
      act(() => result.current.actions.setSorts(sortByName));
      buildSpy.mockClear(); // drop the setSorts rebuild — only the patch ticks below are under test

      // below the rate: this tick samples, so the reference rebuild runs once more.
      randomSpy.mockReturnValueOnce(INCREMENTAL_VIEW_ASSERT_RATE - 0.01);
      act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "name", value: "Aaron" }], { reorder: "immediate" }));
      expect(buildSpy).toHaveBeenCalledTimes(1);

      // at/above the rate: this tick must skip sampling, so no extra rebuild call.
      randomSpy.mockReturnValueOnce(INCREMENTAL_VIEW_ASSERT_RATE);
      act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "name", value: "Mike" }], { reorder: "immediate" }));
      expect(buildSpy).toHaveBeenCalledTimes(1);
    } finally {
      randomSpy.mockRestore();
      buildSpy.mockRestore();
      setIncrementalAssertRate(0);
    }
  });

  it("falls back to the full rebuild above the patch limit and still matches it", () => {
    const many: Row[] = Array.from({ length: INCREMENTAL_PATCH_LIMIT + 10 }, (_, i) => ({
      id: `r${i}`,
      name: `n${String(i).padStart(4, "0")}`,
      price: i,
    }));
    const { result } = renderHarness({ defaultData: many });
    act(() => result.current.actions.setSorts([{ columnId: "price", direction: "desc" }]));
    const patches: CellPatch[] = many.map((r, i) => ({ rowId: r.id, columnId: "price", value: many.length - i }));
    act(() => result.current.actions.updateCells(patches, { reorder: "immediate" }));
    // every price inverted, so desc-by-price is now ascending data order
    expect(result.current.viewIndex).toEqual(many.map((_, i) => i));
  });
});

describe("updateCells — interaction state is never moved", () => {
  /** Adds the interaction-state subscriptions the contrast with `applyCellUpdates` needs. */
  function useInteractionHarness() {
    return {
      actions: useDataGridActions(),
      activeCell: useDataGridActiveCell(),
      selection: useDataGridSelection(),
      editing: useDataGridEditing(),
    };
  }

  function renderInteraction() {
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <DataGridProvider defaultData={rows()} columns={columns} getRowId={getRowId}>
          {children}
        </DataGridProvider>
      );
    }
    return renderHook(() => useInteractionHarness(), { wrapper: Wrapper });
  }

  it("leaves selection, activeCell, and editing untouched", () => {
    const { result } = renderInteraction();
    act(() => result.current.actions.selectCell({ col: 0, row: 0 }));
    act(() => result.current.actions.startEditing({ col: 0, row: 0 }, "typed"));
    const selection = result.current.selection;
    const activeCell = result.current.activeCell;
    const editing = result.current.editing;

    act(() => result.current.actions.updateCells([{ rowId: "c", columnId: "price", value: 1 }]));

    expect(result.current.selection).toBe(selection);
    expect(result.current.activeCell).toBe(activeCell);
    expect(result.current.editing).toBe(editing);
  });

  it("contrasts with applyCellUpdates, which moves the selection to the touched rect by design", () => {
    const { result } = renderInteraction();
    act(() => result.current.actions.selectCell({ col: 0, row: 0 }));
    act(() => result.current.actions.applyCellUpdates([{ viewRow: 2, columnId: "price", value: 2 }], "paste"));
    expect(result.current.activeCell).toEqual({ col: 1, row: 2 });
  });
});

describe("updateRows", () => {
  it("expands each changes entry into one patch", () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({ onDataChange });
    act(() => result.current.actions.updateRows([{ rowId: "a", changes: { name: "Zed", price: 1 } }]));
    expect(lastData(onDataChange)[0]).toMatchObject({ id: "a", name: "Zed", price: 1 });
    const change = onDataChange.mock.calls.at(-1)![1] as DataChange<Row>;
    expect(change.ops).toHaveLength(1);
  });

  it("does nothing for an empty update list", () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({ onDataChange });
    act(() => result.current.actions.updateRows([]));
    expect(onDataChange).not.toHaveBeenCalled();
  });
});

describe("updateCells — uncontrolled mode", () => {
  it("applies in place with no round-trip", () => {
    const { result } = renderHarness({ defaultData: rows() });
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "price", value: 77 }]));
    expect(result.current.firstRow).toMatchObject({ id: "a", price: 77 });
  });
});

// --- The id-index cache: the invalidation audit -------------------------------------------------
// A missed invalidation lands patches on the WRONG rows, silently. Each case below drives a real
// mutation path, then patches by id and asserts the write landed on the row that id names.

describe("rowId index maintenance — one case per mutation path", () => {
  /** Warms the cache with one patch, so every case below tests a cache that was already built. */
  function warm(result: { current: ReturnType<typeof useHarness> }) {
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "price", value: 1 }]));
  }

  it("insertRow: a patch after an insert lands on the named row", () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({
      onDataChange,
      defaultData: rows(),
    });
    warm(result);
    act(() => result.current.actions.updateCells([{ rowId: "c", columnId: "price", value: 100 }]));
    expect(result.current.firstRow).toMatchObject({ id: "a" });
    const before = lastData(onDataChange);
    expect(before.find((r) => r.id === "c")!.price).toBe(100);
  });

  it("deleteRows: a patch after a delete lands on the named row, not the shifted index", () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({ onDataChange, defaultData: rows() });
    warm(result);
    act(() => result.current.actions.deleteRows([0])); // removes row "a"; b,c shift down one
    act(() => result.current.actions.updateCells([{ rowId: "c", columnId: "price", value: 100 }]));
    const next = lastData(onDataChange);
    expect(next.map((r) => r.id)).toEqual(["b", "c"]);
    expect(next.find((r) => r.id === "c")!.price).toBe(100);
    expect(next.find((r) => r.id === "b")!.price).toBe(25);
  });

  it("duplicateRows: a patch after a duplicate lands on the named row", () => {
    const onDataChange = vi.fn();
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <DataGridProvider
          defaultData={rows()}
          columns={columns}
          getRowId={getRowId}
          onDataChange={onDataChange}
          duplicateRow={(row: Row, index: number) => ({ ...row, id: `${row.id}-copy${index}` })}
        >
          {children}
        </DataGridProvider>
      );
    }
    const { result } = renderHook(() => useHarness(), { wrapper: Wrapper });
    warm(result);
    act(() => result.current.actions.duplicateRows([0])); // copy of "a" lands at index 1
    act(() => result.current.actions.updateCells([{ rowId: "c", columnId: "price", value: 100 }]));
    const next = lastData(onDataChange);
    expect(next.map((r) => r.id)).toEqual(["a", "a-copy1", "b", "c"]);
    expect(next.find((r) => r.id === "c")!.price).toBe(100);
  });

  it("commitCellValue: a value-only edit keeps the map valid", () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({ onDataChange, defaultData: rows() });
    warm(result);
    act(() => result.current.actions.commitCellValue({ col: 0, row: 1 }, "Renamed"));
    act(() => result.current.actions.updateCells([{ rowId: "b", columnId: "price", value: 100 }]));
    const next = lastData(onDataChange);
    expect(next.find((r) => r.id === "b")).toMatchObject({ name: "Renamed", price: 100 });
  });

  it("applyCellUpdates (paste/fill): a value-only bulk write keeps the map valid", () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({ onDataChange, defaultData: rows() });
    warm(result);
    act(() => result.current.actions.applyCellUpdates([{ viewRow: 2, columnId: "name", value: "Pasted" }], "paste"));
    act(() => result.current.actions.updateCells([{ rowId: "c", columnId: "price", value: 100 }]));
    const next = lastData(onDataChange);
    expect(next.find((r) => r.id === "c")).toMatchObject({ name: "Pasted", price: 100 });
  });

  it("deleteSelection: a clear keeps the map valid", () => {
    const onDataChange = vi.fn();
    const { result } = renderHarness({ onDataChange, defaultData: rows() });
    warm(result);
    act(() => result.current.actions.selectCell({ col: 0, row: 1 }));
    act(() => result.current.actions.deleteSelection());
    act(() => result.current.actions.updateCells([{ rowId: "b", columnId: "price", value: 100 }]));
    expect(lastData(onDataChange).find((r) => r.id === "b")!.price).toBe(100);
  });

  it("controlled data replacement: a reordered array invalidates the map", () => {
    const onDataChange = vi.fn();
    const initial = rows();
    let data = initial;
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <DataGridProvider data={data} columns={columns} getRowId={getRowId} onDataChange={onDataChange}>
          {children}
        </DataGridProvider>
      );
    }
    const { result, rerender } = renderHook(() => useHarness(), { wrapper: Wrapper });
    warm(result);
    // the consumer replaces the array with the SAME rows in a different order.
    data = [initial[2]!, initial[1]!, initial[0]!];
    rerender();
    act(() => result.current.actions.updateCells([{ rowId: "c", columnId: "price", value: 100 }]));
    const next = lastData(onDataChange);
    expect(next[0]).toMatchObject({ id: "c", price: 100 });
    expect(next[2]).toMatchObject({ id: "a" });
  });

  it("import (a whole-array replacement) invalidates the map", () => {
    const onDataChange = vi.fn();
    let data = rows();
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <DataGridProvider data={data} columns={columns} getRowId={getRowId} onDataChange={onDataChange}>
          {children}
        </DataGridProvider>
      );
    }
    const { result, rerender } = renderHook(() => useHarness(), { wrapper: Wrapper });
    warm(result);
    data = [
      { id: "x", name: "New", price: 1 },
      { id: "a", name: "Moved", price: 2 },
    ];
    rerender();
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "price", value: 100 }]));
    const next = lastData(onDataChange);
    expect(next[1]).toMatchObject({ id: "a", price: 100 });
    expect(next[0]).toMatchObject({ id: "x", price: 1 });
  });
});

describe("controlled echo detection", () => {
  it("reuses viewIndex when the consumer feeds back the array the store emitted", () => {
    let data = rows();
    const onDataChange = vi.fn((next: readonly Row[]) => {
      data = next as Row[];
    });
    // stable identity: a fresh array literal per render is its own sync-input change, which
    // correctly defeats the echo skip — the fast path needs stable sort/filter props, as documented.
    const stableSort: SortSpec[] = [{ columnId: "name", direction: "asc" }];
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <DataGridProvider
          data={data}
          columns={columns}
          getRowId={getRowId}
          onDataChange={onDataChange}
          sortState={stableSort}
        >
          {children}
        </DataGridProvider>
      );
    }
    const { result, rerender } = renderHook(() => useHarness(), { wrapper: Wrapper });
    const before = result.current.viewIndex;
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "name", value: "Aaron" }]));
    rerender();
    // The echo round-trip must not have rebuilt the view: same identity, order still stale.
    expect(result.current.viewIndex).toBe(before);
    expect(result.current.viewIndex).toEqual([1, 2, 0]);
  });

  it("still recomputes when the consumer rebuilds the array itself", () => {
    let data = rows();
    const onDataChange = vi.fn((next: readonly Row[]) => {
      data = next.map((r) => ({ ...r })); // the documented slow path
    });
    const stableSort: SortSpec[] = [{ columnId: "name", direction: "asc" }];
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <DataGridProvider
          data={data}
          columns={columns}
          getRowId={getRowId}
          onDataChange={onDataChange}
          sortState={stableSort}
        >
          {children}
        </DataGridProvider>
      );
    }
    const { result, rerender } = renderHook(() => useHarness(), { wrapper: Wrapper });
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "name", value: "Aaron" }]));
    rerender();
    expect(result.current.viewIndex).toEqual([0, 1, 2]);
  });

  it("an echo sync that also changes the sort still recomputes", () => {
    let data = rows();
    let sortState: SortSpec[] = [{ columnId: "name", direction: "asc" }];
    const onDataChange = vi.fn((next: readonly Row[]) => {
      data = next as Row[];
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <DataGridProvider
          data={data}
          columns={columns}
          getRowId={getRowId}
          onDataChange={onDataChange}
          sortState={sortState}
        >
          {children}
        </DataGridProvider>
      );
    }
    const { result, rerender } = renderHook(() => useHarness(), { wrapper: Wrapper });
    act(() => result.current.actions.updateCells([{ rowId: "a", columnId: "name", value: "Aaron" }]));
    sortState = [{ columnId: "name", direction: "desc" }];
    rerender();
    // desc by name: Charlie->Aaron so order is Bob(c), Alice(b), Aaron(a)
    expect(result.current.viewIndex).toEqual([2, 1, 0]);
  });
});

describe("row-index helpers", () => {
  it("resolve caches on the data array identity", () => {
    const cache = createRowIndexCache();
    const data = rows();
    const first = cache.resolve(data, getRowId as (row: unknown, i: number) => string);
    expect(cache.resolve(data, getRowId as (row: unknown, i: number) => string)).toBe(first);
    expect(first.get("b")).toBe(1);
  });

  it("invalidate forces a rebuild", () => {
    const cache = createRowIndexCache();
    const data = rows();
    const first = cache.resolve(data, getRowId as (row: unknown, i: number) => string);
    cache.invalidate();
    expect(cache.resolve(data, getRowId as (row: unknown, i: number) => string)).not.toBe(first);
  });

  it("rebase carries the map onto a value-only rebuild of the array", () => {
    const cache = createRowIndexCache();
    const data = rows();
    const first = cache.resolve(data, getRowId as (row: unknown, i: number) => string);
    const next = data.slice();
    next[1] = { ...next[1]!, price: 999 };
    cache.rebase(next);
    expect(cache.resolve(next, getRowId as (row: unknown, i: number) => string)).toBe(first);
  });

  it("rebase on a cold cache stays cold", () => {
    const cache = createRowIndexCache();
    cache.rebase(rows());
    const map = cache.resolve(rows(), getRowId as (row: unknown, i: number) => string);
    expect(map.size).toBe(3);
  });

  it("diffRowIndex reports rows whose index moved and rows that vanished", () => {
    const data = rows();
    const cached = new Map([
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["gone", 9],
    ]);
    expect(diffRowIndex(cached, data, getRowId as (row: unknown, i: number) => string)).toEqual(["gone"]);

    const reordered = [data[2]!, data[1]!, data[0]!];
    expect(
      diffRowIndex(cached, reordered, getRowId as (row: unknown, i: number) => string).sort(),
    ).toEqual(["a", "c", "gone"]);
  });

  const patches: CellPatch[] = [{ rowId: "a", columnId: "price", value: 1 }];

  it("touchesViewInputs is false with no sort or filter", () => {
    expect(touchesViewInputs(patches, [], [])).toBe(false);
  });

  it("touchesViewInputs is true for a patched sort column", () => {
    expect(touchesViewInputs(patches, [{ columnId: "price", direction: "asc" }], [])).toBe(true);
  });

  it("touchesViewInputs is true for a patched filter column", () => {
    expect(touchesViewInputs(patches, [], [{ columnId: "price", operator: "contains", value: "1" }])).toBe(true);
  });

  it("touchesViewInputs is false for a sort on another column", () => {
    expect(touchesViewInputs(patches, [{ columnId: "name", direction: "asc" }], [])).toBe(false);
  });

  it("resolveReorder downgrades defer to never when nothing view-relevant was touched", () => {
    expect(resolveReorder(undefined, patches, [{ columnId: "name", direction: "asc" }], [])).toBe("never");
    expect(resolveReorder("defer", patches, [{ columnId: "price", direction: "asc" }], [])).toBe("defer");
  });

  it("resolveReorder passes immediate and never through unchanged", () => {
    expect(resolveReorder("immediate", patches, [], [])).toBe("immediate");
    expect(resolveReorder("never", patches, [{ columnId: "price", direction: "asc" }], [])).toBe("never");
  });
});


// --- Direct write paths owe the same view bookkeeping updateCells does (regression: #72's echoOnly
// short-circuit swallowed it for paste/fill/delete/edit, leaving viewStale false and searchMatches stale).

describe("direct write paths — viewStale and searchMatches", () => {
  const sortByName: SortSpec[] = [{ columnId: "name", direction: "asc" }];

  it("applyCellUpdates flips viewStale when it writes a sort column", () => {
    const { result } = renderHarness({ sortState: sortByName });
    expect(result.current.viewStale).toBe(false);
    // view order under name-asc is [Alice(b), Bob(c), Charlie(a)]; viewRow 0 is row "b".
    act(() => result.current.actions.applyCellUpdates([{ viewRow: 0, columnId: "name", value: "Zulu" }], "paste"));
    expect(result.current.viewStale).toBe(true);
    expect(result.current.viewIndex).toEqual([1, 2, 0]);
  });

  it("reconcileView recovers the order applyCellUpdates deferred", () => {
    const { result } = renderHarness({ sortState: sortByName });
    act(() => result.current.actions.applyCellUpdates([{ viewRow: 0, columnId: "name", value: "Zulu" }], "paste"));
    act(() => result.current.actions.reconcileView());
    expect(result.current.viewIndex).toEqual([2, 0, 1]);
    expect(result.current.viewStale).toBe(false);
  });

  it("deleteSelection flips viewStale when it clears a filter column", () => {
    const { result } = renderHarness({
      filterState: [{ columnId: "name", operator: "contains", value: "a" }],
    });
    act(() => result.current.actions.selectCell({ col: 0, row: 0 }));
    act(() => result.current.actions.deleteSelection());
    expect(result.current.viewStale).toBe(true);
  });

  it("commitCellValue flips viewStale when it writes a sort column", () => {
    const { result } = renderHarness({ sortState: sortByName });
    act(() => result.current.actions.commitCellValue({ col: 0, row: 0 }, "Zulu"));
    expect(result.current.viewStale).toBe(true);
  });

  it("commitCellEdit flips viewStale when it writes a sort column", () => {
    const { result } = renderHarness({ sortState: sortByName });
    act(() => result.current.actions.startEditing({ col: 0, row: 0 }));
    act(() => result.current.actions.commitCellEdit("Zulu"));
    expect(result.current.viewStale).toBe(true);
  });

  it("leaves viewStale false when the written column feeds neither sort nor filter", () => {
    const { result } = renderHarness({ sortState: sortByName });
    act(() => result.current.actions.applyCellUpdates([{ viewRow: 0, columnId: "price", value: 999 }], "paste"));
    expect(result.current.viewStale).toBe(false);
  });

  it("applyCellUpdates recomputes searchMatches for the value it just wrote", () => {
    const { result } = renderHarness();
    act(() => result.current.actions.setSearch("Zulu"));
    expect(result.current.searchMatches).toHaveLength(0);

    act(() => result.current.actions.applyCellUpdates([{ viewRow: 0, columnId: "name", value: "Zulu" }], "paste"));

    expect(result.current.searchMatches).toHaveLength(1);
    expect(result.current.searchMatches[0]).toMatchObject({ row: 0, columnId: "name" });
  });

  it("applyCellUpdates drops a searchMatch whose cell no longer matches", () => {
    const { result } = renderHarness();
    act(() => result.current.actions.setSearch("Charlie"));
    expect(result.current.searchMatches).toHaveLength(1);

    act(() => result.current.actions.applyCellUpdates([{ viewRow: 0, columnId: "name", value: "Zulu" }], "paste"));

    expect(result.current.searchMatches).toHaveLength(0);
  });

  it("deleteSelection drops the searchMatch on the cleared cell", () => {
    const { result } = renderHarness();
    act(() => result.current.actions.setSearch("Charlie"));
    act(() => result.current.actions.selectCell({ col: 0, row: 0 }));
    act(() => result.current.actions.deleteSelection());
    expect(result.current.searchMatches).toHaveLength(0);
  });

  it("commitCellValue recomputes searchMatches", () => {
    const { result } = renderHarness();
    act(() => result.current.actions.setSearch("Zulu"));
    act(() => result.current.actions.commitCellValue({ col: 0, row: 0 }, "Zulu"));
    expect(result.current.searchMatches).toHaveLength(1);
  });

  it("commitCellEdit recomputes searchMatches", () => {
    const { result } = renderHarness();
    act(() => result.current.actions.setSearch("Zulu"));
    act(() => result.current.actions.startEditing({ col: 0, row: 0 }));
    act(() => result.current.actions.commitCellEdit("Zulu"));
    expect(result.current.searchMatches).toHaveLength(1);
  });

  it("allocates no new search state when no search is active", () => {
    const { result } = renderHarness();
    const before = result.current.searchMatches;
    act(() => result.current.actions.applyCellUpdates([{ viewRow: 0, columnId: "name", value: "Zulu" }], "paste"));
    expect(result.current.searchMatches).toBe(before);
  });
});
