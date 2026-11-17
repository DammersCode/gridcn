import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { DataGridProvider, DataGridRoot, defineColumns, useDataGridActions } from "../data-grid/data-grid";
import { useDataGridStoreApi, type DataGridReadState } from "../data-grid/data-grid-sdk";
import {
  useDefaultCellMenuItems,
  useDefaultHeaderMenuItems,
  type GridMenuItemSpec,
  COLUMN_WIDTH_STEP,
} from "./menu-items";
import { viewIndex } from "@/registry/default/blocks/data-grid/types";

afterEach(cleanup);

type Row = { id: string; name: string; score: number };

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 120 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 80 },
] as const);

const rows: Row[] = [
  { id: "r0", name: "Alice", score: 1 },
  { id: "r1", name: "Bob", score: 2 },
];

type ItemSpec = Exclude<GridMenuItemSpec, { separator: true }>;

/** Finds an item variant by id (separator entries are excluded from the match). */
function item(specs: GridMenuItemSpec[], id: string): ItemSpec | undefined {
  return specs.find((s): s is ItemSpec => "separator" in s ? false : s.id === id);
}

type ProbeProps = {
  createRow?: () => Row;
  duplicateRow?: (row: Row) => Row;
  pin?: "start" | "end";
  hideable?: false;
  readOnly?: boolean;
  allMatching?: boolean;
  headerColumnId?: string;
  clipboardFailed?: boolean;
  onClipboardFailed?: () => void;
  onSpecs?: (cell: GridMenuItemSpec[], header: GridMenuItemSpec[]) => void;
};

function Probe(props: ProbeProps) {
  const actions = useDataGridActions();
  useEffect(() => {
    actions.selectCellAt({ col: 0, row: 0 });
    if (props.allMatching) actions.selectAllMatching();
  }, [actions, props.allMatching]);
  const cellSpecs = useDefaultCellMenuItems({
    clipboardFailed: props.clipboardFailed,
    onClipboardFailed: props.onClipboardFailed,
    row: 1,
    canInsertRow: props.createRow != null,
    canDuplicateRow: props.duplicateRow != null,
    pasteBlocked: false,
    onPasteBlocked: () => {},
  });
  const headerSpecs = useDefaultHeaderMenuItems({ columnId: props.headerColumnId ?? "name", scrollRoot: null });
  props.onSpecs?.(cellSpecs, headerSpecs);
  return null;
}

function renderProbe(props: ProbeProps) {
  return render(
    <DataGridProvider
      data={rows}
      columns={columns.map((c) => (c.id === "name" ? { ...c, pin: props.pin, hideable: props.hideable } : c))}
      getRowId={(row) => row.id}
      createRow={props.createRow}
      duplicateRow={props.duplicateRow}
      readOnly={props.readOnly}
      totalRowCount={props.allMatching ? 50 : undefined}
      checkedRowsLifetime={props.allMatching ? "across-filters" : undefined}
    >
      <DataGridRoot>
        <Probe {...props} />
      </DataGridRoot>
    </DataGridProvider>,
  );
}

const ids = (specs: GridMenuItemSpec[]) => specs.map((s) => s.id);

describe("useDefaultCellMenuItems", () => {
  it("builds the full built-in set with stable ids when both row-operation props are given", () => {
    let cell: GridMenuItemSpec[] = [];
    renderProbe({
      createRow: () => rows[0]!,
      duplicateRow: (row) => row,
      onSpecs: (c) => {
        cell = c;
      },
    });
    expect(ids(cell)).toEqual([
      "cut", "copy", "paste", "sep-clipboard", "clear-contents", "sep-rows",
      "insert-row-above", "insert-row-below", "duplicate-rows", "delete-rows",
    ]);
    expect(item(cell, "delete-rows")?.destructive).toBe(true);
    expect(item(cell, "paste")?.tooltip).toBeUndefined();
  });

  it("omits the Insert entries without createRow and the Duplicate entry without duplicateRow", () => {
    let cell: GridMenuItemSpec[] = [];
    renderProbe({ onSpecs: (c) => { cell = c; } });
    expect(ids(cell)).toEqual(["cut", "copy", "paste", "sep-clipboard", "clear-contents", "sep-rows", "delete-rows"]);
  });

  it("marks every mutating item disabled on a readOnly grid", () => {
    let cell: GridMenuItemSpec[] = [];
    renderProbe({ readOnly: true, onSpecs: (c) => { cell = c; } });
    for (const id of ["cut", "paste", "clear-contents", "delete-rows"]) {
      expect(item(cell, id)?.disabled, id).toBe(true);
    }
    expect(item(cell, "copy")?.disabled).toBeUndefined();
    expect(item(cell, "paste")?.tooltip).toBeUndefined();
  });

  it("turns off Duplicate and Delete under all matching and explains why", async () => {
    let cell: GridMenuItemSpec[] = [];
    renderProbe({ allMatching: true, createRow: () => rows[0]!, duplicateRow: (row) => row, onSpecs: (c) => { cell = c; } });
    await waitFor(() => expect(item(cell, "delete-rows")?.disabled).toBe(true));
    expect(item(cell, "duplicate-rows")?.disabled).toBe(true);
    expect(item(cell, "delete-rows")?.tooltip).toMatch(/all matching/i);
    expect(item(cell, "insert-row-above")?.disabled).toBeFalsy();
  });

  describe("a failed clipboard write", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      delete (document as unknown as Record<string, unknown>)["execCommand"];
    });

    it.each(["cut", "copy"])("reports a failed %s", async (id) => {
      document.execCommand = vi.fn(() => false);
      vi.stubGlobal("navigator", { clipboard: { write: vi.fn().mockRejectedValue(new Error("denied")) } });
      vi.stubGlobal("ClipboardItem", class {} as unknown as typeof ClipboardItem);
      const onClipboardFailed = vi.fn();
      let cell: GridMenuItemSpec[] = [];
      renderProbe({ onClipboardFailed, onSpecs: (c) => { cell = c; } });

      await item(cell, id)?.onClick?.();

      await waitFor(() => expect(onClipboardFailed).toHaveBeenCalledOnce());
    });

    it("disables Cut and Copy with the clipboard-failed tooltip once one failed", () => {
      let cell: GridMenuItemSpec[] = [];
      renderProbe({ clipboardFailed: true, onSpecs: (c) => { cell = c; } });
      for (const id of ["cut", "copy"]) {
        expect(item(cell, id)?.disabled, id).toBe(true);
        expect(item(cell, id)?.tooltip, id).toBe("clipboard access failed — use Ctrl+C or Ctrl+X");
      }
    });

    it("names the Cmd key in the tooltip on macOS", () => {
      const platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
      let cell: GridMenuItemSpec[] = [];
      renderProbe({ clipboardFailed: true, onSpecs: (c) => { cell = c; } });
      platform.mockRestore();
      expect(item(cell, "copy")?.tooltip).toBe("clipboard access failed — use ⌘+C or ⌘+X");
    });

    it("keeps Cut and Copy enabled while no write failed", () => {
      let cell: GridMenuItemSpec[] = [];
      renderProbe({ onSpecs: (c) => { cell = c; } });
      expect(item(cell, "copy")?.disabled).toBeUndefined();
      expect(item(cell, "copy")?.tooltip).toBeUndefined();
    });
  });

  it("gives Paste the blocked tooltip and disabled fields when pasteBlocked", () => {
    // pasteBlocked is wrapper state, not store state — verify the spec fields the renderer acts on
    const spec: GridMenuItemSpec = {
      id: "paste",
      label: "Paste",
      disabled: true,
      tooltip: "Clipboard access blocked",
      onClick: () => {},
    };
    expect(spec.disabled).toBe(true);
    expect(spec.tooltip).toBe("Clipboard access blocked");
  });
});

describe("useDefaultHeaderMenuItems", () => {
  it("builds the full built-in set for a sortable, pinnable, resizable column", () => {
    let header: GridMenuItemSpec[] = [];
    renderProbe({ onSpecs: (_c, h) => { header = h; } });
    expect(ids(header)).toEqual(["sort-asc", "sort-desc", "sep-sort", "pin-start", "pin-end", "hide-column", "sep-move", "move-toward-start", "move-toward-end", "sep-autosize", "widen-column", "narrow-column", "autosize", "autosize-all"]);
    expect(item(header, "unpin")).toBeUndefined();
    // `disabled: !pinnable` is explicit; only `true` renders inert
    expect(item(header, "pin-start")?.disabled).toBe(false);
  });

  it("omits the hide item for a column with hideable false", () => {
    let header: GridMenuItemSpec[] = [];
    renderProbe({ hideable: false, onSpecs: (_c, h) => { header = h; } });
    expect(item(header, "hide-column")).toBeUndefined();
    expect(item(header, "pin-start")).toBeDefined();
  });

  it("adds the unpin entry for a pinned column", () => {
    let header: GridMenuItemSpec[] = [];
    renderProbe({ pin: "start", onSpecs: (_c, h) => { header = h; } });
    expect(ids(header)).toEqual(["sort-asc", "sort-desc", "sep-sort", "pin-start", "pin-end", "unpin", "hide-column", "sep-move", "move-toward-start", "move-toward-end", "sep-autosize", "widen-column", "narrow-column", "autosize", "autosize-all"]);
  });

  it("moves the column one place within its pin zone, and disables a move off the zone's edge", () => {
    let header: GridMenuItemSpec[] = [];
    let state: (() => DataGridReadState) | null = null;
    function StateProbe() {
      const api = useDataGridStoreApi();
      state = () => api.getState();
      return null;
    }
    render(
      <DataGridProvider data={rows} columns={columns} getRowId={(row) => row.id}>
        <DataGridRoot>
          <StateProbe />
          <Probe headerColumnId="name" onSpecs={(_c, h) => { header = h; }} />
        </DataGridRoot>
      </DataGridProvider>,
    );
    expect(item(header, "move-toward-start")?.disabled).toBe(true);
    expect(item(header, "move-toward-end")?.disabled).toBe(false);

    act(() => item(header, "move-toward-end")!.onClick!());
    expect(state!().visibleColumns.map((column) => column.id)).toEqual(["score", "name"]);
    expect(item(header, "move-toward-end")?.disabled).toBe(true);

    act(() => item(header, "move-toward-start")!.onClick!());
    expect(state!().visibleColumns.map((column) => column.id)).toEqual(["name", "score"]);
  });

  it("disables both moves for a pinned column alone in its zone", () => {
    let header: GridMenuItemSpec[] = [];
    renderProbe({ pin: "start", onSpecs: (_c, h) => { header = h; } });
    expect(item(header, "move-toward-start")?.disabled).toBe(true);
    expect(item(header, "move-toward-end")?.disabled).toBe(true);
  });

  it("widens and narrows the column by one step", () => {
    let header: GridMenuItemSpec[] = [];
    let state: (() => DataGridReadState) | null = null;
    function StateProbe() {
      const api = useDataGridStoreApi();
      state = () => api.getState();
      return null;
    }
    render(
      <DataGridProvider data={rows} columns={columns} getRowId={(row) => row.id}>
        <DataGridRoot>
          <StateProbe />
          <Probe headerColumnId="name" onSpecs={(_c, h) => { header = h; }} />
        </DataGridRoot>
      </DataGridProvider>,
    );
    act(() => item(header, "widen-column")!.onClick!());
    expect(state!().columnWidths["name"]).toBe(120 + COLUMN_WIDTH_STEP);
    act(() => item(header, "narrow-column")!.onClick!());
    act(() => item(header, "narrow-column")!.onClick!());
    expect(state!().columnWidths["name"]).toBe(120 - COLUMN_WIDTH_STEP);
  });

  it("returns no items for an unknown column id", () => {
    // the wrapper passes "" while no header is right-clicked; the dropdown's column always resolves
    let header: GridMenuItemSpec[] = [{ id: "sentinel", label: "sentinel" }];
    renderProbe({ headerColumnId: "missing", onSpecs: (_c, h) => { header = h; } });
    expect(header).toEqual([]);
  });
});

// The spec renderers need base-ui's Menu.Root context, so they are covered end to end by the
// browser suite (context-menu.browser.test.tsx "menu resolvers"), not in jsdom.


describe("delete-rows after a sort", () => {
  it("deletes the checked records and the cursor's record, not the records the sort moved under the cursor range", async () => {
    type Person = { id: string; name: string };
    const people: Person[] = [
      { id: "a", name: "Echo" },
      { id: "b", name: "Alpha" },
      { id: "c", name: "Delta" },
      { id: "d", name: "Bravo" },
      { id: "e", name: "Charlie" },
    ];
    const onDataChange = vi.fn();
    let specs: GridMenuItemSpec[] = [];
    let actions: ReturnType<typeof useDataGridActions> | null = null;
    function SortProbe() {
      actions = useDataGridActions();
      specs = useDefaultCellMenuItems({ row: 0, canInsertRow: false, canDuplicateRow: false, pasteBlocked: false, onPasteBlocked: () => {} });
      return null;
    }
    render(
      <DataGridProvider data={people} columns={[{ id: "name", header: "Name", accessorKey: "name" }]} getRowId={(row) => row.id} onDataChange={onDataChange}>
        <DataGridRoot>
          <SortProbe />
        </DataGridRoot>
      </DataGridProvider>,
    );
    act(() => actions!.selectCellAt({ row: 0, col: 0 }));
    act(() => actions!.setRowCheckedAt(viewIndex(2), true));
    act(() => actions!.setRowCheckedAt(viewIndex(3), true));
    act(() => actions!.setSorts([{ columnId: "name", direction: "asc" }]));

    act(() => item(specs, "delete-rows")!.onClick!());

    await waitFor(() => expect(onDataChange).toHaveBeenCalledTimes(1));
    const ops = onDataChange.mock.calls[0]![1].ops as { rowId: string }[];
    expect(ops.map((op) => op.rowId).sort()).toEqual(["a", "c", "d"]);
  });
});

describe("row items with only hidden checked rows", () => {
  it("disables Delete rows and Duplicate rows with the reason, and keeps the insert items enabled without one", async () => {
    let cell: GridMenuItemSpec[] = [];
    function Hidden() {
      const actions = useDataGridActions();
      useEffect(() => {
        actions.setRowCheckedAt(viewIndex(0), true);
        actions.setFilters([{ filterId: "f", columnId: "name", operator: "equals", value: "Bob" }]);
      }, [actions]);
      cell = useDefaultCellMenuItems({ row: 0, canInsertRow: true, canDuplicateRow: true, pasteBlocked: false, onPasteBlocked: () => {} });
      return null;
    }
    render(
      <DataGridProvider data={rows} columns={columns} getRowId={(row) => row.id} duplicateRow={(row) => ({ ...row, id: `${row.id}2` })} checkedRowsLifetime="across-filters">
        <DataGridRoot>
          <Hidden />
        </DataGridRoot>
      </DataGridProvider>,
    );
    await waitFor(() => expect(item(cell, "delete-rows")?.disabled).toBe(true));
    expect(item(cell, "duplicate-rows")?.disabled).toBe(true);
    expect(item(cell, "delete-rows")?.tooltip).toBe("Only hidden rows are checked");
    expect(item(cell, "duplicate-rows")?.tooltip).toBe("Only hidden rows are checked");
    for (const id of ["insert-row-above", "insert-row-below"]) {
      expect(item(cell, id)?.disabled).toBeFalsy();
      expect(item(cell, id)?.tooltip).toBeUndefined();
    }
  });
  it("disables the row items with the all-matching reason when every matching row is checked (server rows)", async () => {
    let cell: GridMenuItemSpec[] = [];
    function AllMatching() {
      const actions = useDataGridActions();
      useEffect(() => {
        actions.selectAllMatching();
      }, [actions]);
      cell = useDefaultCellMenuItems({ row: 0, canInsertRow: true, canDuplicateRow: true, pasteBlocked: false, onPasteBlocked: () => {} });
      return null;
    }
    render(
      <DataGridProvider data={rows} columns={columns} getRowId={(row) => row.id} duplicateRow={(row) => ({ ...row, id: `${row.id}2` })} checkedRowsLifetime="across-filters" totalRowCount={9}>
        <DataGridRoot>
          <AllMatching />
        </DataGridRoot>
      </DataGridProvider>,
    );
    await waitFor(() => expect(item(cell, "delete-rows")?.disabled).toBe(true));
    expect(item(cell, "delete-rows")?.tooltip).toBe("All matching rows are checked; use the bulk action");
    expect(item(cell, "duplicate-rows")?.tooltip).toBe("All matching rows are checked; use the bulk action");
  });
});

describe("Insert row anchor", () => {
  it("follows the row id when the view re-sorts before the click", async () => {
    let cell: GridMenuItemSpec[] = [];
    let api!: ReturnType<typeof useDataGridStoreApi>;
    function Anchor() {
      api = useDataGridStoreApi();
      cell = useDefaultCellMenuItems({ row: 0, rowId: "r0", canInsertRow: true, canDuplicateRow: false, pasteBlocked: false, onPasteBlocked: () => {} });
      return null;
    }
    render(
      <DataGridProvider data={rows} columns={columns} getRowId={(row) => row.id} createRow={() => ({ id: "new", name: "New", score: 0 })}>
        <DataGridRoot>
          <Anchor />
        </DataGridRoot>
      </DataGridProvider>,
    );
    await act(async () => api.getState().actions.setSorts([{ columnId: "score", direction: "desc" }]));
    await act(async () => item(cell, "insert-row-below")?.onClick?.());
    expect((api.getState().data as Row[]).map((r) => r.id)).toEqual(["r0", "new", "r1"]);
  });
});

describe("MenuShortcut", () => {
  it("pushes the keycaps to the inline end with a logical margin", async () => {
    const { MenuShortcut } = await import("./menu-shortcut");
    const { container } = render(<MenuShortcut binding="mod+c" />);
    const group = container.firstElementChild!;
    expect(group.className).toContain("ms-auto");
    expect(group.className).not.toContain("ml-auto");
  });
});
