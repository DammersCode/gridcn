import { act, render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef } from "../types";
import { DataGridProvider, getInternalActions, useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from ".";
import { DataGridRoot } from "../root";
import { DataGridHeader } from "../header";
import { DataGridBody } from "../body";

// jsdom has no real canvas 2d context; stub `measureText` with a char-count-based width
// (7px/char) so the committed widths below are deterministic.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = ((contextId: string) => {
    if (contextId !== "2d") return null;
    return {
      set font(_value: string) {},
      measureText: (text: string) => ({ width: text.length * 7 }),
    };
  }) as typeof HTMLCanvasElement.prototype.getContext;
});

type Row = { id: string; a: string; b: string };

const col = (id: "a" | "b", extra: Partial<ColumnDef<Row, unknown>> = {}): ColumnDef<Row, unknown> => ({
  id,
  header: id === "a" ? "AAA" : "B", // 3 chars / 1 char
  accessorKey: id,
  ...extra,
});

const columns: readonly ColumnDef<Row, unknown>[] = [col("a"), col("b")];
const rows: Row[] = [
  { id: "1", a: "11111", b: "1" },
  { id: "2", a: "2", b: "2" },
  { id: "3", a: "3", b: "3" },
];

// expected measured widths: a = max(21px header, 35px cell) + 20 = 55; b = max(7, 7) + 20 = 27 → 32 floor
const MEASURED = { a: 55, b: 32 };

type Props = Partial<DataGridSyncProps<Row>>;

function mount(props: Props) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const grid = (next: Props) => (
    <DataGridProvider defaultData={rows} columns={columns} getRowId={(row) => row.id} {...next}>
      <Probe />
    </DataGridProvider>
  );
  const view = render(grid(props));
  return { store: () => api!, rerender: (next: Props) => view.rerender(grid(next)) };
}

function registerFonts(store: StoreApi<DataGridStoreState>) {
  act(() => {
    getInternalActions(store)._registerMeasureFonts(() => ({
      cellFont: "14px Arial",
      headerFont: "14px Arial",
      window: { start: 0, end: 3 },
      hasHeaderMenu: false,
      hasHeaderFilter: false,
    }));
  });
}

describe("actions.autosizeColumns", () => {
  it("returns {} and commits nothing without a mounted measure context", () => {
    const onColumnLayoutChange = vi.fn();
    const { store } = mount({ onColumnLayoutChange });
    let returned: Record<string, number> = {};
    act(() => {
      returned = store().getState().actions.autosizeColumns();
    });
    expect(returned).toEqual({});
    expect(onColumnLayoutChange).not.toHaveBeenCalled();
  });

  it("commits every changed width in one write with one onColumnLayoutChange", () => {
    const onColumnLayoutChange = vi.fn();
    const { store } = mount({ onColumnLayoutChange });
    registerFonts(store());
    let returned: Record<string, number> = {};
    act(() => {
      returned = store().getState().actions.autosizeColumns();
    });
    expect(returned).toEqual(MEASURED);
    expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
    expect(onColumnLayoutChange).toHaveBeenCalledWith(expect.objectContaining({ widths: MEASURED }));
    expect(store().getState().columnWidths).toEqual(MEASURED);
  });

  it("fires no event when the measured widths equal the current ones", () => {
    const onColumnLayoutChange = vi.fn();
    const { store } = mount({
      onColumnLayoutChange,
      defaultColumnLayout: { widths: MEASURED, order: ["a", "b"], pins: {}, hidden: [] },
    });
    registerFonts(store());
    let returned: Record<string, number> = {};
    act(() => {
      returned = store().getState().actions.autosizeColumns();
    });
    expect(returned).toEqual(MEASURED);
    expect(onColumnLayoutChange).not.toHaveBeenCalled();
  });

  it("updates the committed snapshot so an equal follow-up commit does not re-fire", () => {
    const onColumnLayoutChange = vi.fn();
    const { store } = mount({ onColumnLayoutChange });
    registerFonts(store());
    act(() => store().getState().actions.autosizeColumns());
    act(() => store().getState().actions.commitColumnWidth("a", MEASURED.a));
    expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
  });
});

function compose(props: Props) {
  return (
    <DataGridProvider defaultData={rows} columns={columns} getRowId={(row) => row.id} {...props}>
      <DataGridRoot className="h-[400px]">
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>
  );
}

describe("autosizeOnMount", () => {
  it("runs one pass when the view has rows; a saved layout wins for columns with a saved width", () => {
    const onColumnLayoutChange = vi.fn();
    const view = render(
      compose({
        autosizeOnMount: true,
        onColumnLayoutChange,
        defaultColumnLayout: { widths: { a: 999 }, order: ["a", "b"], pins: {}, hidden: [] },
      }),
    );
    expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
    const snapshot = onColumnLayoutChange.mock.calls[0]![0] as { widths: Record<string, number> };
    expect(snapshot.widths).toEqual({ a: 999, b: MEASURED.b }); // a keeps its saved width; b was measured
    const { unmount } = view;
    unmount();
  });

  it("runs exactly once across re-renders", () => {
    const onColumnLayoutChange = vi.fn();
    const view = render(compose({ autosizeOnMount: true, onColumnLayoutChange }));
    expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
    view.rerender(compose({ autosizeOnMount: true, onColumnLayoutChange }));
    expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
  });

  it("waits for the first rows on a lazy grid, then runs", () => {
    const onColumnLayoutChange = vi.fn();
    const view = render(
      (
        <DataGridProvider data={[]} columns={columns} getRowId={(row) => row.id} autosizeOnMount={true} onColumnLayoutChange={onColumnLayoutChange}>
          <DataGridRoot className="h-[400px]">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      ),
    );
    expect(onColumnLayoutChange).not.toHaveBeenCalled();
    act(() => {
      view.rerender(
        (
          <DataGridProvider data={rows} columns={columns} getRowId={(row) => row.id} autosizeOnMount={true} onColumnLayoutChange={onColumnLayoutChange}>
            <DataGridRoot className="h-[400px]">
              <DataGridHeader />
              <DataGridBody />
            </DataGridRoot>
          </DataGridProvider>
        ),
      );
    });
    expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
  });

  it("accepts an options object that narrows the pass", () => {
    const onColumnLayoutChange = vi.fn();
    render(compose({ autosizeOnMount: { columnIds: ["b"] }, onColumnLayoutChange }));
    const snapshot = onColumnLayoutChange.mock.calls[0]![0] as { widths: Record<string, number> };
    expect(snapshot.widths).toEqual({ b: MEASURED.b }); // a untouched → not in the saved widths
  });
});
