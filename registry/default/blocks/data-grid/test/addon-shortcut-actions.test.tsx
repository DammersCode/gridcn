import { createRef } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, type ColumnDef, type DataGridApi, type DataGridPlugin, type Keymap } from "../data-grid";
import { useDataGridStoreApi, type DataGridStoreState } from "../store";
import { DEFAULT_KEYMAP } from "../keyboard";
import { enabledGlobalActions, resolveGlobalShortcut, type GlobalShortcutContext, type GlobalShortcutEvent } from "../keyboard/global-shortcuts";
import { useDataGridFill } from "@/registry/default/blocks/data-grid-fill/data-grid-fill";
import { useDataGridFindReplace } from "@/registry/default/blocks/data-grid-find-replace/data-grid-find-replace";
import { useDataGridHistory } from "@/registry/default/blocks/data-grid-history/data-grid-history";
import { groupDefaultKeymap } from "@/lib/default-keymap-groups";

type Row = { id: string; name: string };
const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name", width: 120 }];
const rows: readonly Row[] = [{ id: "0", name: "a" }, { id: "1", name: "b" }];
const getRowId = (row: Row) => row.id;

let store: StoreApi<DataGridStoreState> | null = null;
function StoreCapture() {
  store = useDataGridStoreApi();
  return null;
}

type Extra = { keymap?: Keymap; commands?: Record<string, { run: () => void }> };

function Mounted({ pick, extra, apiRef }: { pick: "history" | "fill" | "find" | "none"; extra: Extra; apiRef?: React.Ref<DataGridApi<Row>> }) {
  const history = useDataGridHistory();
  const fill = useDataGridFill();
  const find = useDataGridFindReplace();
  const plugins: DataGridPlugin[] = pick === "history" ? [history.plugin] : pick === "fill" ? [fill.plugin] : pick === "find" ? [find.plugin] : [];
  return (
    <DataGridProvider ref={apiRef} data={rows} columns={columns} getRowId={getRowId} plugins={plugins} keymap={extra.keymap} commands={extra.commands as never}>
      <DataGridRoot className="h-[200px]">
        <DataGridHeader />
        <DataGridBody />
        <StoreCapture />
      </DataGridRoot>
    </DataGridProvider>
  );
}

function keymapOf(pick: "history" | "fill" | "find" | "none", extra: Extra = {}) {
  store = null;
  render(<Mounted pick={pick} extra={extra} />);
  return store!.getState().keymap as Record<string, string[] | undefined>;
}

afterEach(() => cleanup());

describe("add-on shortcut actions", () => {
  it("core binds none of the six add-on actions", () => {
    const core = DEFAULT_KEYMAP as Record<string, string[] | undefined>;
    for (const name of ["undo", "redo", "fillDown", "fillRight", "openFindReplace", "openFind"]) expect(core[name]).toBeUndefined();
  });

  it("the history add-on binds undo and redo", () => {
    const keymap = keymapOf("history");
    expect(keymap["undo"]).toEqual(["mod+z"]);
    expect(keymap["redo"]).toEqual(["mod+y", "mod+shift+z"]);
  });

  it("the fill add-on binds fillDown and fillRight", () => {
    const keymap = keymapOf("fill");
    expect(keymap["fillDown"]).toEqual(["mod+d"]);
    expect(keymap["fillRight"]).toEqual(["mod+r"]);
  });

  it("the find-replace add-on binds its keys and takes mod+f from focusSearch", () => {
    const keymap = keymapOf("find");
    expect(keymap["openFind"]).toEqual(["mod+f"]);
    expect(keymap["openFindReplace"]).toEqual(["ctrl+h"]);
    expect(keymap["focusSearch"]).toEqual([]);
  });

  it("without an add-on no key is bound and focusSearch keeps mod+f", () => {
    const keymap = keymapOf("none");
    for (const name of ["undo", "redo", "fillDown", "fillRight", "openFindReplace", "openFind"]) expect(keymap[name]).toBeUndefined();
    expect(keymap["focusSearch"]).toEqual(["mod+f"]);
  });

  it("a consumer remaps an add-on action through keymap", () => {
    expect(keymapOf("history", { keymap: { undo: ["mod+u"] } as Keymap })["undo"]).toEqual(["mod+u"]);
  });

  it("a consumer unbinds an add-on action with an empty list", () => {
    expect(keymapOf("fill", { keymap: { fillDown: [] } as Keymap })["fillDown"]).toEqual([]);
  });

  it("a consumer's own undo command binds through keymap without the history add-on", () => {
    const keymap = keymapOf("none", { keymap: { undo: ["mod+z"] } as Keymap, commands: { undo: { run: () => {} } } });
    expect(keymap["undo"]).toEqual(["mod+z"]);
    expect(store!.getState().commands?.["undo"]).toBeDefined();
  });

  it("run-shortcut runs the add-on command", () => {
    const ref = createRef<DataGridApi<Row>>();
    render(<Mounted pick="find" extra={{}} apiRef={ref} />);
    expect(screen.queryByRole("dialog", { name: "Find and replace" })).toBeNull();
    act(() => ref.current!.runShortcut("openFind" as never));

    expect(screen.getByRole("dialog", { name: "Find and replace" })).toBeTruthy();
  });
});

describe("add-on actions in the keybindings reference and the global flags", () => {
  it("the default keymap reference lists undo, redo, fill down, and fill right", () => {
    const keys = groupDefaultKeymap().flatMap((group) => group.rows.map((row) => row.key));
    for (const name of ["undo", "redo", "fillDown", "fillRight"]) expect(keys).toContain(name);
  });

  const event = (overrides: Partial<GlobalShortcutEvent>): GlobalShortcutEvent => ({
    key: "z", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, isComposing: false, keyCode: 90, defaultPrevented: false, ...overrides,
  });
  const ctx = (keymap: Keymap): GlobalShortcutContext => ({
    keymap, isMac: false, actions: enabledGlobalActions(), targetIsEditable: false, targetInAnyGrid: false, ownsFocus: true,
  });

  it("undo and redo are on by default and resolve through the add-on keymap", () => {
    const keymap = keymapOf("history") as Keymap;
    expect(resolveGlobalShortcut(event({}), ctx(keymap))).toBe("undo");
    expect(resolveGlobalShortcut(event({ key: "y", keyCode: 89 }), ctx(keymap))).toBe("redo");
  });

  it("the flags resolve nothing when the add-on is absent", () => {
    expect(resolveGlobalShortcut(event({}), ctx(keymapOf("none") as Keymap))).toBeNull();
  });

  it("a fill flag resolves through the fill add-on keymap", () => {
    const keymap = keymapOf("fill") as Keymap;
    const fillCtx = { ...ctx(keymap), actions: enabledGlobalActions({ fillDown: true }) };
    expect(resolveGlobalShortcut(event({ key: "d", keyCode: 68 }), fillCtx)).toBe("fillDown");
  });
});
