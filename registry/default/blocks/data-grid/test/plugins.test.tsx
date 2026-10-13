import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { StoreApi } from "zustand/vanilla";
import {
  DataGrid,
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  useDataGridApi,
  type ColumnDef,
  type DataChange,
  type DataGridApi,
  type DataGridPlugin,
  type RowBandRenderCtx,
} from "../data-grid";
import { useDataGridStoreApi, type DataGridStoreState } from "../store";
import { EMPTY_PLUGINS, mergePluginCommands, mergePluginKeymaps, resolvePluginsList } from "../store/plugins";
import { DEFAULT_KEYMAP } from "../keyboard";
import { dispatchGridAction } from "../interaction/use-grid-interaction";
import { useDataGridHistory } from "@/registry/default/blocks/data-grid-history/data-grid-history";
import { useDataGridFill } from "@/registry/default/blocks/data-grid-fill/data-grid-fill";
import { useDataGridPinnedRows } from "@/registry/default/blocks/data-grid-pinned-rows/data-grid-pinned-rows";

type Row = { id: string; name: string; qty: number };

// Stable module-level references: a fresh `data`/`columns`/`getRowId` identity per render re-syncs
// the recompute slice (a store set, and a dev-warn), which would defeat the identity tests below.
const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name", width: 120 },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", width: 80 },
];
const rows: readonly Row[] = Array.from({ length: 4 }, (_, i) => ({ id: String(i), name: `Row ${i}`, qty: i }));
const getRowId = (row: Row) => row.id;

/** The store's data as `Row[]` (the store types it `unknown[]`). */
const data = () => store!.getState().data as readonly Row[];

function editChange(rowId: string, next: Row, prev: Row): DataChange<Row> {
  return {
    source: "edit",
    ops: [{ type: "update", rowId, row: next, prev, cells: [{ columnId: "name", value: next.name, prev: prev.name }] }],
  };
}

let store: StoreApi<DataGridStoreState> | null = null;
function StoreCapture() {
  store = useDataGridStoreApi();
  return null;
}

function mountGrid(
  plugins: readonly DataGridPlugin[],
  extra: { data?: readonly Row[]; defaultData?: readonly Row[]; onDataChange?: (next: readonly Row[], change: DataChange<Row>) => void; readOnly?: boolean; columns?: readonly ColumnDef<Row, unknown>[] } = {},
) {
  store = null;
  render(
    <DataGridProvider
      data={extra.data}
      defaultData={extra.defaultData}
      columns={extra.columns ?? columns}
      getRowId={getRowId}
      plugins={plugins}
      onDataChange={extra.onDataChange}
      readOnly={extra.readOnly}
    >
      <DataGridRoot className="h-[360px]">
        <DataGridHeader />
        <DataGridBody />
        <StoreCapture />
      </DataGridRoot>
    </DataGridProvider>,
  );
  return { actions: () => store!.getState().actions, store: () => store! };
}

afterEach(cleanup);

// jsdom performs no layout; drive useRowWindow's viewport math by stubbing clientHeight.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return 360; // 10 rows visible at rowHeight 36
    },
  });
});

describe("plugin conflicts (decision 3 table)", () => {
  it("two plugins with the same name: the later plugin is ignored, dev-warns once", () => {
    const warn = vi.fn();
    const first = { name: "x", Overlay: () => null };
    const second = { name: "x", Overlay: () => null };
    const resolved = resolvePluginsList([first, second], {}, warn);
    // the later plugin is ignored in every resolved member
    expect(resolved.overlays).toHaveLength(1);
    expect(resolved.overlays[0]!.name).toBe("x");
    expect(resolved.overlays[0]!.Overlay).toBe(first.Overlay);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe("name:x");
    expect(warn.mock.calls[0]![1]).toContain("two plugins named");
  });

  it("two plugins with the same command name: the later plugin wins, dev-warns with both names", () => {
    const warn = vi.fn();
    const p1 = { name: "p1", commands: { save: { run: () => {} } } };
    const p2 = { name: "p2", commands: { save: { run: () => {} } } };
    const merged = mergePluginCommands([p1, p2], null, warn)!;
    expect(merged["save"]).toBe(p2.commands!.save);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe("cmd-conflict:save:p1:p2");
    expect(warn.mock.calls[0]![1]).toContain("p1");
    expect(warn.mock.calls[0]![1]).toContain("p2");
  });

  it("the consumer's commands win over a plugin command, silently", () => {
    const warn = vi.fn();
    const consumerSave = { run: () => {} };
    const merged = mergePluginCommands([{ name: "p", commands: { save: { run: () => {} } } }], { save: consumerSave }, warn)!;
    expect(merged["save"]).toBe(consumerSave);
    expect(warn).not.toHaveBeenCalled();
  });

  it("a plugin command named after a built-in action is dropped with a dev warn; the pluggable built-ins are kept", () => {
    const warn = vi.fn();
    const plugin = {
      name: "p",
      commands: {
        selectAll: { run: () => {} },
        fillDown: { run: () => {} },
        undo: { run: () => {} },
      },
    };
    const merged = mergePluginCommands([plugin], null, warn)!;
    expect(merged["selectAll"]).toBeUndefined();
    expect(merged["fillDown"]).toBe(plugin.commands!.fillDown);
    expect(merged["undo"]).toBe(plugin.commands!.undo);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe("cmd-builtin:p:selectAll");
    expect(warn.mock.calls[0]![1]).toContain("built-in");
  });

  it("a plugin keymap entry naming a command the plugin does not own is dropped with a dev warn", () => {
    const warn = vi.fn();
    // "selectAll" is a built-in action but the plugin defines no such command; "custom" is the
    // plugin's own command but not a built-in action — both entries are unbindable.
    const plugin = {
      name: "p",
      commands: { custom: { run: () => {} } },
      keymap: { selectAll: ["mod+s"], custom: ["mod+s"] },
    };
    const merged = mergePluginKeymaps([plugin], undefined, warn);
    expect(merged.selectAll).toEqual(DEFAULT_KEYMAP.selectAll);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.every((c) => (c[0] as string).startsWith("keymap-unknown"))).toBe(true);
  });

  it("a plugin binding equal to a DEFAULT_KEYMAP binding is dropped with a dev warn; the default keeps working", () => {
    const warn = vi.fn();
    const plugin = {
      name: "p",
      commands: { fillDown: { run: () => {} } },
      keymap: { fillDown: ["mod+d", "mod+shift+d"] },
    };
    const merged = mergePluginKeymaps([plugin], undefined, warn);
    expect(merged.fillDown).toEqual(["mod+shift+d"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe("keymap-collide:p:fillDown");
    expect(warn.mock.calls[0]![1]).toContain("colliding binding is dropped");
  });

  it("a plugin binding a key the consumer's keymap already owns is dropped; the consumer's binding wins", () => {
    const warn = vi.fn();
    // the app bound mod+c to fillDown itself; the plugin's attempt to share that key is dropped
    // and the app's binding stays the one that resolves
    const plugin = {
      name: "p",
      commands: { fillDown: { run: () => {} } },
      keymap: { fillDown: ["mod+c"] },
    };
    const merged = mergePluginKeymaps([plugin], { fillDown: ["mod+c"] }, warn);
    expect(merged.fillDown).toEqual(["mod+c"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe("keymap-collide:p:fillDown");
  });

  it("keymap merge order: DEFAULT_KEYMAP <- plugin keymaps (array order) <- consumer keymap", () => {
    const warn = vi.fn();
    const plugin = {
      name: "p",
      commands: { fillDown: { run: () => {} } },
      keymap: { fillDown: ["mod+shift+d"] },
    };
    const merged = mergePluginKeymaps([plugin], { redo: ["mod+r"] }, warn);
    expect(merged.moveUp).toEqual(DEFAULT_KEYMAP.moveUp);
    expect(merged.fillDown).toEqual(["mod+shift+d"]);
    expect(merged.redo).toEqual(["mod+r"]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("plugin order (real store)", () => {
  it("overlays, bands, Mounts, and observers follow the array order", () => {
    const overlays = { name: "ov", Overlay: () => null } as const;
    const mounts = { name: "mt", Mount: () => null } as const;
    const bands = {
      name: "bd",
      rowBands: { top: [1], render: () => null },
    } as const;
    const h = mountGrid([overlays, mounts, bands]);
    const resolved = h.store().getState().plugins;
    expect(resolved.overlays.map((o) => o.name)).toEqual(["ov"]);
    expect(resolved.mounts.map((m) => m.name)).toEqual(["mt"]);
    expect(resolved.bands.top.map((b) => b.name)).toEqual(["bd"]);

    const order: string[] = [];
    const obsA = { name: "a", onDataChange: () => order.push("a") } as const;
    const obsB = { name: "b", onDataChange: () => order.push("b") } as const;
    const h2 = mountGrid([obsB, obsA], { data: rows });
    act(() => h2.actions().commitChange(editChange("0", { ...rows[0]!, name: "Changed" }, rows[0]!)));
    expect(order).toEqual(["b", "a"]);
  });
});

describe("plugin identity across renders", () => {
  function Grid({ plugins }: { plugins: readonly DataGridPlugin[] }) {
    return (
      <DataGridProvider data={rows} columns={columns} getRowId={getRowId} plugins={plugins}>
        <DataGridRoot className="h-[360px]">
          <DataGridHeader />
          <DataGridBody />
          <StoreCapture />
        </DataGridRoot>
      </DataGridProvider>
    );
  }

  it("an inline array of stable plugins over 10 re-renders re-resolves nothing (the plugin fields keep their references)", () => {
    const p1 = { name: "a", Overlay: () => null } as const;
    const p2 = { name: "b", Mount: () => null } as const;
    const view = render(<Grid plugins={[p1, p2]} />);
    // the config phase's set runs on every render; the assertion is that the plugin fields never
    // change identity — an entry-equal list must not re-resolve, re-merge, or re-validate
    const stable: boolean[] = [];
    store!.subscribe((state, prev) => {
      stable.push(state.plugins === prev.plugins && state.commands === prev.commands && state.keymap === prev.keymap);
    });
    for (let i = 0; i < 10; i++) view.rerender(<Grid plugins={[p1, p2]} />);
    expect(stable.length).toBe(10);
    expect(stable.every(Boolean)).toBe(true);
  });

  it("an inline plugin literal whose members keep their identity re-resolves nothing", () => {
    const overlay = () => null;
    const mount = () => null;
    function LiteralGrid() {
      // a fresh plugin object per render, but every member keeps its identity
      return <Grid plugins={[{ name: "x", Overlay: overlay, Mount: mount }]} />;
    }
    const view = render(<LiteralGrid />);
    const first = store!.getState();
    const stable: boolean[] = [];
    store!.subscribe((state, prev) => {
      stable.push(state.plugins === prev.plugins && state.commands === prev.commands && state.keymap === prev.keymap);
    });
    for (let i = 0; i < 10; i++) view.rerender(<LiteralGrid />);
    const last = store!.getState();
    // the React Compiler memoizes the stable element and skips the provider re-renders entirely
    // (zero notifications); the invariant is that whatever ran never re-resolved
    expect(stable.every(Boolean)).toBe(true);
    expect(last.plugins).toBe(first.plugins);
    expect(last.commands).toBe(first.commands);
    expect(last.keymap).toBe(first.keymap);
  });

  it("one plugin object passed to two grids dev-warns; the first grid keeps it, the second drops it", () => {
    const plugin = { name: "shared", Mount: () => null } as const;
    const warn = vi.spyOn(console, "warn");
    mountGrid([plugin]);
    const storeA = store!;
    const hB = mountGrid([plugin]);
    const storeB = hB.store();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("already attached");
    expect(storeA.getState().plugins.list).toContain(plugin);
    expect(storeB.getState().plugins.list).toHaveLength(0);
    warn.mockRestore();
  });

  it("removing an overlay plugin between renders does not throw", () => {
    const plugin = { name: "ov", Overlay: () => null } as const;
    const h = mountGrid([plugin]);
    expect(h.store().getState().plugins.overlays).toHaveLength(1);
    // re-render the provider with the plugin gone
    render(
      <DataGridProvider data={rows} columns={columns} getRowId={getRowId}>
        <DataGridRoot className="h-[360px]">
          <DataGridHeader />
          <DataGridBody />
          <StoreCapture />
        </DataGridRoot>
      </DataGridProvider>,
    );
    expect(store!.getState().plugins).toBe(EMPTY_PLUGINS);
  });
});

describe("row bands from multiple plugins", () => {
  type BandRecord = { rowOffset: number; ariaRowIndexBase: number };

  function bandPlugin(name: "a" | "b", topRows: readonly unknown[], testId: string, records: Record<"a" | "b", BandRecord[]>) {
    return {
      name,
      rowBands: {
        top: topRows,
        render: (ctx: RowBandRenderCtx) => {
          records[name].push({ rowOffset: ctx.rowOffset, ariaRowIndexBase: ctx.ariaRowIndexBase });
          return (
            <div data-testid={testId} style={{ height: `${ctx.rows.length * ctx.rowHeight}px` }}>
              {ctx.rows.map((_, i) => (
                <div key={i} role="row" aria-rowindex={ctx.ariaRowIndexBase + i} />
              ))}
            </div>
          );
        },
      },
    } as const;
  }

  it("two plugins with 1 and 2 top rows give a 3-row band, rowOffset 1 on the second segment, contiguous aria-rowindex", () => {
    const records: Record<"a" | "b", BandRecord[]> = { a: [], b: [] };
    const a = bandPlugin("a", ["band-a-row"], "band-a", records);
    const b = bandPlugin("b", ["band-b-1", "band-b-2"], "band-b", records);
    mountGrid([a, b], { data: rows });

    expect((document.querySelector('[data-testid="band-a"]') as HTMLElement).style.height).toBe("36px");
    expect((document.querySelector('[data-testid="band-b"]') as HTMLElement).style.height).toBe("72px");
    // 1 + 2 = 3 band rows: the header, the bands, and the 4 data rows
    expect(screen.getByRole("grid").getAttribute("aria-rowcount")).toBe("8");
    // the second segment's offset is the rows the first segment takes
    expect(records.a[0]!.rowOffset).toBe(0);
    expect(records.b[0]!.rowOffset).toBe(1);
    const rowIndexes = Array.from(document.querySelectorAll<HTMLElement>('[role="row"]'))
      .map((el) => Number(el.getAttribute("aria-rowindex")))
      .filter((n) => n >= 2)
      .sort((x, y) => x - y);
    expect(rowIndexes).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it("an SSR render with pinned rows has the band heights", () => {
    function SsrGrid() {
      const { plugin } = useDataGridPinnedRows({ topRows: [rows[0]!, rows[1]!] });
      return <DataGrid data={rows} columns={columns} getRowId={getRowId} rowHeight={40} plugins={[plugin]} />;
    }
    const html = renderToString(<SsrGrid />);
    expect(html).toContain("data-grid-pinned-row-band");
    expect(html).toContain("height:80px"); // 2 pinned rows x rowHeight 40
  });
});

describe("plugin onDataChange observers", () => {
  it("runs after the store set and after the consumer's onDataChange", () => {
    const order: string[] = [];
    let observedData: readonly Row[] | null = null;
    const plugin = {
      name: "obs",
      onDataChange: (next: readonly Row[]) => {
        order.push("observer");
        observedData = next;
        // the store's set has already landed by the time the observer runs
        expect(next).toBe(store!.getState().data);
      },
    } as const;
    const h = mountGrid([plugin], {
      data: rows,
      onDataChange: (_next) => {
        order.push("consumer");
      },
    });
    const nextRow = { ...rows[0]!, name: "Changed" };
    act(() => h.actions().commitChange(editChange("0", nextRow, rows[0]!)));
    expect(order).toEqual(["consumer", "observer"]);
    expect(observedData!.map((r) => r.id)).toEqual(["0", "1", "2", "3"]);
  });

  it("a throwing observer logs and does not stop the next observer", () => {
    const warn = vi.spyOn(console, "warn");
    const ran: string[] = [];
    const h = mountGrid(
      [
        { name: "a", onDataChange: () => { throw new Error("boom"); } } as const,
        { name: "b", onDataChange: () => { ran.push("b"); } } as const,
      ],
      { data: rows },
    );
    expect(() => act(() => h.actions().commitChange(editChange("0", { ...rows[0]!, name: "Changed" }, rows[0]!)))).not.toThrow();
    expect(ran).toEqual(["b"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("observer threw");
    expect(data()[0]!.name).toBe("Changed");
    warn.mockRestore();
  });

  it("an observer that calls commitChange keeps its own write", () => {
    let committed = false;
    const h = mountGrid(
      [
        {
          name: "obs",
          onDataChange: (_next: readonly Row[], _change: DataChange<Row>, ctx: { api: DataGridApi<Row> }) => {
            if (!committed) {
              committed = true;
              ctx.api.actions.commitChange({
                source: "app",
                ops: [{ type: "update", rowId: "1", row: { ...rows[1]!, name: "FromObserver" }, prev: rows[1]!, cells: [{ columnId: "name", value: "FromObserver", prev: rows[1]!.name }] }],
              });
            }
          },
        } as const,
      ],
      { data: rows },
    );
    act(() => h.actions().commitChange(editChange("0", { ...rows[0]!, name: "Primary" }, rows[0]!)));
    expect(data()[0]!.name).toBe("Primary");
    expect(data()[1]!.name).toBe("FromObserver");
  });
});

describe("the public surface stays read-only", () => {
  it("api.store.setState and getState().actions._syncProps are undefined at runtime", () => {
    let api: DataGridApi<unknown> | null = null;
    function ApiCapture() {
      api = useDataGridApi();
      return null;
    }
    render(
      <DataGrid data={rows} columns={columns} getRowId={getRowId}>
        <ApiCapture />
      </DataGrid>,
    );
    expect((api!.store as unknown as Record<string, unknown>)["setState"]).toBeUndefined();
    expect((api!.store.getState().actions as unknown as Record<string, unknown>)["_syncProps"]).toBeUndefined();
  });

  it("the read state rejects the write surface and the consumer callbacks at the type level", () => {
    let api: DataGridApi<unknown> | null = null;
    function ApiCapture() {
      api = useDataGridApi();
      return null;
    }
    render(
      <DataGrid data={rows} columns={columns} getRowId={getRowId}>
        <ApiCapture />
      </DataGrid>,
    );
    // @ts-expect-error — the wrapper is read-only: setState does not exist on it
    const setState = api!.store.setState;
    expect(setState).toBeUndefined();
    const read = api!.store.getState();
    // @ts-expect-error — the consumer's callbacks are not on the read state
    expect(read.onDataChange).toBeUndefined();
  });
});

describe("write guards on a readOnly grid", () => {
  it("commitChange, applyCellUpdates, commitCellEdit, and commitCellValueAt write nothing and emit nothing", () => {
    const onDataChange = vi.fn();
    const h = mountGrid([], { data: rows, onDataChange, readOnly: true });
    const before = h.store().getState().data;
    act(() => {
      h.actions().commitChange(editChange("0", { ...rows[0]!, name: "Changed" }, rows[0]!));
      h.actions().applyCellUpdates([{ viewRowIndex: 0, columnId: "name", value: "Changed" }], "edit");
      h.actions().commitCellEdit("Changed");
      h.actions().commitCellValueAt({ col: 0, row: 0 }, "Changed");
    });
    expect(h.store().getState().data).toBe(before);
    expect(onDataChange).not.toHaveBeenCalled();
  });
});

describe("history plugin against the store", () => {
  let historyApi: ReturnType<typeof useDataGridHistory<Row>> | null = null;

  function ControlledGrid() {
    const history = useDataGridHistory<Row>({});
    historyApi = history;
    let data: readonly Row[] | null = null;
    return (
      <DataGridProvider data={data ?? rows} columns={columns} getRowId={getRowId} plugins={[history.plugin]} onDataChange={(next) => (data = next)}>
        <DataGridRoot className="h-[360px]">
          <DataGridHeader />
          <DataGridBody />
          <StoreCapture />
        </DataGridRoot>
      </DataGridProvider>
    );
  }

  function UncontrolledGrid() {
    const history = useDataGridHistory<Row>({});
    historyApi = history;
    return (
      <DataGridProvider defaultData={rows} columns={columns} getRowId={getRowId} plugins={[history.plugin]}>
        <DataGridRoot className="h-[360px]">
          <DataGridHeader />
          <DataGridBody />
          <StoreCapture />
        </DataGridRoot>
      </DataGridProvider>
    );
  }

  const prev = rows[0]!;
  const changed = { ...prev, name: "Changed" };

  it("undo and redo round-trip in a controlled grid, and its own emissions are not recorded", () => {
    render(<ControlledGrid />);
    act(() => store!.getState().actions.commitChange(editChange("0", changed, prev)));
    expect(data()[0]!.name).toBe("Changed");
    expect(historyApi!.canUndo).toBe(true);

    act(() => historyApi!.undo());
    expect(data()[0]!.name).toBe("Row 0");
    expect(historyApi!.canUndo).toBe(false);
    expect(historyApi!.historySize).toBe(0); // the undo's own emission (source "history") recorded nothing
    expect(historyApi!.canRedo).toBe(true);

    act(() => historyApi!.redo());
    expect(data()[0]!.name).toBe("Changed");
  });

  it("undo and redo round-trip in an uncontrolled grid (the store owns the data)", () => {
    render(<UncontrolledGrid />);
    act(() => store!.getState().actions.commitChange(editChange("0", changed, prev)));
    expect(data()[0]!.name).toBe("Changed");

    act(() => historyApi!.undo());
    expect(data()[0]!.name).toBe("Row 0");

    act(() => historyApi!.redo());
    expect(data()[0]!.name).toBe("Changed");
  });

  it("a read-only grid records nothing and does not undo", () => {
    function ReadOnlyGrid() {
      const history = useDataGridHistory<Row>({});
      historyApi = history;
      return (
        <DataGridProvider data={rows} columns={columns} getRowId={getRowId} plugins={[history.plugin]} readOnly>
          <DataGridRoot className="h-[360px]">
            <DataGridHeader />
            <DataGridBody />
            <StoreCapture />
          </DataGridRoot>
        </DataGridProvider>
      );
    }
    render(<ReadOnlyGrid />);
    act(() => store!.getState().actions.commitChange(editChange("0", changed, prev)));
    expect(data()[0]!.name).toBe("Row 0"); // the write was refused
    expect(historyApi!.canUndo).toBe(false);
    act(() => historyApi!.undo());
    expect(data()[0]!.name).toBe("Row 0");
  });
});

describe("fill plugin commands (mod+D / mod+R)", () => {
  // name values parse cleanly through the number column's fromText, so a cross-column copy
  // (fillRight) is deterministic to assert
  const fillRows: readonly Row[] = [
    { id: "0", name: "10", qty: 1 },
    { id: "1", name: "11", qty: 2 },
    { id: "2", name: "12", qty: 3 },
  ];

  function FillGrid({ readOnly = false, withPlugin = true }: { readOnly?: boolean; withPlugin?: boolean }) {
    const { plugin } = useDataGridFill({});
    store = null;
    function Inner() {
      return (
        <DataGridProvider data={fillRows} columns={columns} getRowId={getRowId} plugins={withPlugin ? [plugin] : []} readOnly={readOnly}>
          <DataGridRoot className="h-[360px]">
            <DataGridHeader />
            <DataGridBody />
            <StoreCapture />
          </DataGridRoot>
        </DataGridProvider>
      );
    }
    return <Inner />;
  }

  function dispatch(action: "fillDown" | "fillRight") {
    const actions = store!.getState().actions;
    const preventDefault = vi.fn();
    act(() => {
      dispatchGridAction({
        action,
        actions,
        storeApi: store!,
        scrollRef: { current: null },
        scrollCellIntoView: vi.fn(),
        rowHeight: 36,
        preventDefault,
      });
    });
    return preventDefault;
  }

  it("mod+D reaches the plugin command and fills the selection's top row downward", () => {
    render(<FillGrid />);
    const actions = store!.getState().actions;
    act(() => {
      actions.selectCellAt({ col: 0, row: 0 });
      actions.extendToAt({ col: 1, row: 1 }); // 2x2 selection: the top row fills down across both columns
    });
    const preventDefault = dispatch("fillDown");
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(data()[1]!.name).toBe(fillRows[0]!.name);
    expect(data()[1]!.qty).toBe(fillRows[0]!.qty);
  });

  it("mod+R reaches the plugin command and fills the selection's left column rightward", () => {
    render(<FillGrid />);
    const actions = store!.getState().actions;
    act(() => {
      actions.selectCellAt({ col: 0, row: 0 });
      actions.extendToAt({ col: 1, row: 0 }); // one row across both columns: the left column fills right
    });
    dispatch("fillRight");
    // the left column's text ("10") copied into the number column
    expect(data()[0]!.qty).toBe(10);
    expect(data()[0]!.name).toBe(fillRows[0]!.name);
  });

  it("a read-only grid lets the key through (no command, no preventDefault) and writes nothing", () => {
    render(<FillGrid readOnly />);
    const actions = store!.getState().actions;
    act(() => {
      actions.selectCellAt({ col: 0, row: 0 });
      actions.extendToAt({ col: 0, row: 1 });
    });
    const preventDefault = dispatch("fillDown");
    expect(preventDefault).not.toHaveBeenCalled();
    expect(data()[1]!.name).toBe(fillRows[1]!.name);
  });

  it("without the plugin the keys are hollow no-ops that still prevent the browser default", () => {
    render(<FillGrid withPlugin={false} />);
    const actions = store!.getState().actions;
    act(() => {
      actions.selectCellAt({ col: 0, row: 0 });
      actions.extendToAt({ col: 0, row: 1 });
    });
    const preventDefault = dispatch("fillDown");
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(data()[1]!.name).toBe(fillRows[1]!.name);
  });
});
