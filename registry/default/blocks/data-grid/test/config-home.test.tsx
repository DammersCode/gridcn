import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import type { StoreApi } from "zustand/vanilla";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DataGrid,
  DataGridProvider,
  DataGridRoot,
  DEFAULT_KEYMAP,
  useDataGridKeymap,
  useDataGridReadOnly,
  useDataGridStoreProps,
  type ColumnDef,
  type DataGridProviderProps,
  type Keymap,
  type OnCellClick,
} from "../data-grid";
import { useDataGridStoreApi, type DataGridStoreState } from "../store";

type Row = { id: string; name: string; qty: number };

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: String(i), name: `Row ${i}`, qty: i }));
}

const getRowId = (row: Row) => row.id;

// jsdom performs no layout; drive useRowWindow's viewport math by stubbing clientHeight.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return 360; // 10 rows visible at rowHeight 36
    },
  });
});

afterEach(cleanup);

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
];

describe("config home: SSR", () => {
  function Probe() {
    return <span>{String(useDataGridReadOnly())}</span>;
  }

  it("shows readOnly on the server render (the store seeds it at creation)", () => {
    const html = renderToString(
      <DataGrid defaultData={makeRows(1)} columns={columns} getRowId={(row) => row.id} readOnly>
        <DataGridRoot>
          <Probe />
        </DataGridRoot>
      </DataGrid>,
    );
    expect(html).toContain("true");
    expect(html).toContain("aria-readonly");
  });
});

describe("config home: keymap", () => {
  it("useDataGridKeymap returns the merged map with no DataGridRoot mounted", () => {
    const { result } = renderHook(() => useDataGridKeymap(), {
      wrapper: function Wrapper({ children }: { children: ReactNode }) {
        return (
          <DataGridProvider data={makeRows(1)} columns={columns} getRowId={getRowId} keymap={{ selectAll: ["mod+shift+A"] }}>
            {children}
          </DataGridProvider>
        );
      },
    });
    expect(result.current.selectAll).toEqual(["mod+shift+A"]);
    expect(result.current.undo).toEqual(DEFAULT_KEYMAP.undo);
  });

  it("an equal re-render syncs nothing; a content-equal keymap literal keeps state.keymap's identity", () => {
    const flags = { data: makeRows(2), keymap: { selectAll: ["mod+a"] } as Keymap | undefined, readOnly: false };
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <DataGridProvider
          data={flags.data}
          columns={columns}
          getRowId={getRowId}
          keymap={flags.keymap}
          readOnly={flags.readOnly}
        >
          {children}
        </DataGridProvider>
      );
    }
    const { result, rerender } = renderHook(() => useDataGridStoreApi(), { wrapper: Wrapper });
    const store = result.current;
    const syncConfig = vi.spyOn(store.getState().actions, "_syncConfig");
    const syncProps = vi.spyOn(store.getState().actions, "_syncProps");

    // equal props (every slice reference unchanged): neither phase runs
    rerender();
    expect(syncConfig).not.toHaveBeenCalled();
    expect(syncProps).not.toHaveBeenCalled();

    // a fresh content-equal keymap literal: the config phase runs, but state.keymap keeps its reference
    const keymapBefore = store.getState().keymap;
    flags.keymap = { selectAll: ["mod+a"] };
    rerender();
    expect(syncConfig).toHaveBeenCalledTimes(1);
    expect(syncProps).not.toHaveBeenCalled();
    expect(store.getState().keymap).toBe(keymapBefore);

    // a config-only change: _syncConfig only
    syncConfig.mockClear();
    flags.readOnly = true;
    rerender();
    expect(syncConfig).toHaveBeenCalledTimes(1);
    expect(syncProps).not.toHaveBeenCalled();

    // a recompute-only change: _syncProps only
    syncConfig.mockClear();
    syncProps.mockClear();
    flags.data = makeRows(2);
    rerender();
    expect(syncProps).toHaveBeenCalledTimes(1);
    expect(syncConfig).not.toHaveBeenCalled();
  });
});

describe("config home: untyped caller", () => {
  it("warns once when sync props sit next to store", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let external: StoreApi<DataGridStoreState> | null = null;
    renderHook(() => {
      const r = useDataGridStoreProps({ data: makeRows(1), columns, getRowId });
      external = r.store;
      return r;
    });
    // cast away the union's type error to simulate an untyped/cast caller
    const shellProps = {
      store: external!,
      data: makeRows(1),
      columns,
      getRowId,
      children: <div />,
    } as unknown as DataGridProviderProps<Row>;
    render(<DataGridProvider {...shellProps} />);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("ignores the sync props");

    // the warning fires once per session, not per grid
    render(<DataGridProvider {...shellProps} />);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("config home: onCellClick", () => {
  // The callback is read off the store at click time (no prop threading), so a changed identity
  // reaches the next click without any cell prop changing. The no-re-render half of the spec item
  // is verified by the browser wasted-render suites, not here: under jsdom the column window's
  // scroll-settle timers can recompute the windowed set between commits, which re-renders cells
  // for a reason unrelated to the config sync.
  it("the next click calls the new onCellClick after an identity change, and never the old one", () => {
    const first = vi.fn();
    const second = vi.fn();
    const data = makeRows(1);
    const cols: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
    ];
    // Prop-driven: a no-props wrapper is compiler-cached at first render and would never see a change.
    function Wrapper({ onCellClick }: { onCellClick: OnCellClick<Row> }) {
      return <DataGrid data={data} columns={cols} getRowId={getRowId} onCellClick={onCellClick} />;
    }
    const { rerender } = render(<Wrapper onCellClick={first} />);

    rerender(<Wrapper onCellClick={second} />);

    fireEvent.click(screen.getAllByRole("gridcell")[1]!);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
