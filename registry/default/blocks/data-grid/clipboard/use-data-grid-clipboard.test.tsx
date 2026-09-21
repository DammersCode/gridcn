import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ColumnDef, DataChange } from "../types";
import { DataGridProvider, useDataGridActions, useDataGridStoreApi, type DataGridProviderProps } from "../store";
import { useDataGridClipboard } from "./use-data-grid-clipboard";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];

function rows(): Row[] {
  return [
    { id: "1", name: "a" },
    { id: "2", name: "b" },
  ];
}

function makeWrapper(overrides: Partial<DataGridProviderProps<Row>> = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={rows()} columns={columns} getRowId={(r) => r.id} {...overrides}>
        {children}
      </DataGridProvider>
    );
  };
}

/**
 * Renders `useDataGridActions`/`useDataGridStoreApi`/`useDataGridClipboard` off ONE mounted
 * `DataGridProvider` (a fresh `renderHook` per hook would each mount its own provider instance,
 * i.e. its own store — selecting a cell on one would never be visible to another). Selects the
 * whole first cell so `pasteFromClipboard`/`cut` have a resolvable target/scope, and optionally
 * flips the store's `readOnly` flag the same way `DataGridRoot` registers it.
 */
function setUpGrid(wrapper: ReturnType<typeof makeWrapper>, opts: { readOnly?: boolean } = {}) {
  const { result } = renderHook(
    () => ({ actions: useDataGridActions(), storeApi: useDataGridStoreApi(), clipboard: useDataGridClipboard() }),
    { wrapper },
  );
  act(() => result.current.actions.selectCell({ col: 0, row: 0 }));
  if (opts.readOnly) act(() => result.current.storeApi.getState().actions._registerReadOnly(true));
  return result;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useDataGridClipboard.pasteFromClipboard", () => {
  it("resolves 'permission-denied' when navigator.clipboard.readText() rejects", async () => {
    vi.stubGlobal("navigator", { clipboard: { readText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const wrapper = makeWrapper();
    const result = setUpGrid(wrapper);

    const outcome = await act(() => result.current.clipboard.pasteFromClipboard());
    expect(outcome).toBe("permission-denied");
  });

  it("resolves 'empty' when the clipboard held no usable text", async () => {
    vi.stubGlobal("navigator", { clipboard: { readText: vi.fn().mockResolvedValue("") } });
    const wrapper = makeWrapper();
    const result = setUpGrid(wrapper);

    const outcome = await act(() => result.current.clipboard.pasteFromClipboard());
    expect(outcome).toBe("empty");
  });

  it("resolves 'ok' and applies the pasted text when the grid is writable", async () => {
    vi.stubGlobal("navigator", { clipboard: { readText: vi.fn().mockResolvedValue("z") } });
    const onDataChange = vi.fn();
    const wrapper = makeWrapper({ onDataChange });
    const result = setUpGrid(wrapper);

    const outcome = await act(() => result.current.clipboard.pasteFromClipboard());
    expect(outcome).toBe("ok");
    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(change.source).toBe("paste");
  });

  it("resolves 'empty' and never mutates on a readOnly grid, even with clipboard text available", async () => {
    vi.stubGlobal("navigator", { clipboard: { readText: vi.fn().mockResolvedValue("z") } });
    const onDataChange = vi.fn();
    const wrapper = makeWrapper({ onDataChange });
    const result = setUpGrid(wrapper, { readOnly: true });

    const outcome = await act(() => result.current.clipboard.pasteFromClipboard());
    expect(outcome).toBe("empty");
    expect(onDataChange).not.toHaveBeenCalled();
  });
});

describe("useDataGridClipboard.pasteFromClipboard with an async schema", () => {
  const asyncName = {
    "~standard": {
      version: 1,
      vendor: "mock",
      validate: async (value: unknown) => (value === "bad" ? { issues: [{ message: "nope" }] } : { value: String(value).toUpperCase() }),
    },
  };
  const asyncColumns: readonly ColumnDef<Row, unknown>[] = [
    { id: "name", header: "Name", accessorKey: "name", validate: asyncName as never },
  ];

  it("commits the schema's transformed value only after it resolves", async () => {
    vi.stubGlobal("navigator", { clipboard: { readText: vi.fn().mockResolvedValue("z") } });
    const onDataChange = vi.fn();
    const wrapper = makeWrapper({ onDataChange, columns: asyncColumns });
    const result = setUpGrid(wrapper);

    const outcome = await act(() => result.current.clipboard.pasteFromClipboard());
    expect(outcome).toBe("ok");
    await vi.waitFor(() => expect(onDataChange).toHaveBeenCalledTimes(1));
    const [next, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(change.source).toBe("paste");
    expect(next[0]!.name).toBe("Z");
  });

  it("a second paste before the first resolves supersedes it — one commit, the newer value", async () => {
    const readText = vi.fn().mockResolvedValueOnce("x").mockResolvedValueOnce("y");
    vi.stubGlobal("navigator", { clipboard: { readText } });
    const onDataChange = vi.fn();
    const wrapper = makeWrapper({ onDataChange, columns: asyncColumns });
    const result = setUpGrid(wrapper);

    await act(async () => {
      const first = result.current.clipboard.pasteFromClipboard();
      const second = result.current.clipboard.pasteFromClipboard();
      await Promise.all([first, second]);
    });
    await vi.waitFor(() => expect(onDataChange).toHaveBeenCalledTimes(1));
    expect((onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>])[0][0]!.name).toBe("Y");
  });

  it("an async rejection commits nothing at all", async () => {
    vi.stubGlobal("navigator", { clipboard: { readText: vi.fn().mockResolvedValue("bad") } });
    const onDataChange = vi.fn();
    const wrapper = makeWrapper({ onDataChange, columns: asyncColumns });
    const result = setUpGrid(wrapper);

    await act(() => result.current.clipboard.pasteFromClipboard());
    await act(() => asyncName["~standard"].validate("bad"));
    expect(onDataChange).not.toHaveBeenCalled();
  });

  /** A schema validator whose resolution the test controls, so a mutation can land while the batch is genuinely still in flight. */
  function heldSchema() {
    let resolveFn!: (result: { value: unknown }) => void;
    const gate = new Promise<{ value: unknown }>((resolve) => (resolveFn = resolve));
    const columns: readonly ColumnDef<Row, unknown>[] = [
      {
        id: "name",
        header: "Name",
        accessorKey: "name",
        validate: { "~standard": { version: 1, vendor: "mock", validate: () => gate } } as never,
      },
    ];
    return { columns, release: (value: unknown) => resolveFn({ value }), settled: gate };
  }

  it("drops a held paste when the sort changes before it settles — the snapshot's view is gone", async () => {
    vi.stubGlobal("navigator", { clipboard: { readText: vi.fn().mockResolvedValue("z") } });
    const onDataChange = vi.fn();
    const { columns: heldColumns, release, settled } = heldSchema();
    const wrapper = makeWrapper({ onDataChange, columns: heldColumns });
    const result = setUpGrid(wrapper);

    await act(() => result.current.clipboard.pasteFromClipboard());
    act(() => result.current.actions.setSorts([{ columnId: "name", direction: "asc" }]));
    await act(async () => {
      release("Z");
      await settled;
    });

    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("drops a held paste when its target row is deleted before it settles", async () => {
    vi.stubGlobal("navigator", { clipboard: { readText: vi.fn().mockResolvedValue("z") } });
    const onDataChange = vi.fn();
    const { columns: heldColumns, release, settled } = heldSchema();
    const wrapper = makeWrapper({ onDataChange, columns: heldColumns });
    const result = setUpGrid(wrapper);

    // setUpGrid selects { col: 0, row: 0 } — view row 0 is the paste target.
    await act(() => result.current.clipboard.pasteFromClipboard());
    act(() => result.current.actions.deleteRows([0]));
    await act(async () => {
      release("Z");
      await settled;
    });

    // deleteRows itself fires one onDataChange (the row-op); the held paste must NOT add a second.
    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(change.source).toBe("row-op");
  });

  it("commits a held paste onto the row id it targeted after a pure reorder", async () => {
    vi.stubGlobal("navigator", { clipboard: { readText: vi.fn().mockResolvedValue("z") } });
    const onDataChange = vi.fn();
    const { columns: heldColumns, release } = heldSchema();
    const reordered = [rows()[1]!, rows()[0]!]; // same ids, new order — targets survive
    const wrapper = makeWrapper({ onDataChange, columns: heldColumns });
    const result = setUpGrid(wrapper);

    // setUpGrid selects { col: 0, row: 0 } — the paste targets row id "1" ({ id: "1", name: "a" }).
    await act(() => result.current.clipboard.pasteFromClipboard());
    act(() =>
      result.current.storeApi.getState().actions._syncProps({
        data: reordered,
        columns: heldColumns as never,
        getRowId: ((r: Row) => r.id) as never,
      }),
    );
    release("Z");
    await vi.waitFor(() => expect(onDataChange).toHaveBeenCalledTimes(1));
    const [next, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(change.source).toBe("paste");
    expect(next.find((r) => r.id === "1")!.name).toBe("Z");
    expect(next.find((r) => r.id === "2")!.name).toBe("b"); // the row that moved into view row 0 is untouched
  });
});

describe("useDataGridClipboard.cut on a readOnly grid", () => {
  it("still writes to the clipboard but never calls deleteSelection's onDataChange", () => {
    vi.stubGlobal("navigator", { clipboard: { write: vi.fn().mockResolvedValue(undefined) } });
    vi.stubGlobal("ClipboardItem", class {} as unknown as typeof ClipboardItem);
    const onDataChange = vi.fn();
    const wrapper = makeWrapper({ onDataChange });
    const result = setUpGrid(wrapper, { readOnly: true });

    act(() => result.current.clipboard.cut());

    expect(onDataChange).not.toHaveBeenCalled();
  });
});
