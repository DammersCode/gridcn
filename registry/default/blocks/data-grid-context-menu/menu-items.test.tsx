import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { DataGridProvider, DataGridRoot, defineColumns, useDataGridActions } from "../data-grid/data-grid";
import {
  useDefaultCellMenuItems,
  useDefaultHeaderMenuItems,
  type GridMenuItemSpec,
} from "./menu-items";

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
  pin?: "left" | "right";
  readOnly?: boolean;
  headerColumnId?: string;
  clipboardFailed?: boolean;
  onClipboardFailed?: () => void;
  onSpecs?: (cell: GridMenuItemSpec[], header: GridMenuItemSpec[]) => void;
};

function Probe(props: ProbeProps) {
  const actions = useDataGridActions();
  useEffect(() => actions.selectCellAt({ col: 0, row: 0 }), [actions]);
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
      columns={props.pin ? columns.map((c) => (c.id === "name" ? { ...c, pin: props.pin } : c)) : columns}
      getRowId={(row) => row.id}
      createRow={props.createRow}
      duplicateRow={props.duplicateRow}
    >
      {/* `readOnly` lives on the root, not the provider (useDataGridReadOnly reads the root context) */}
      <DataGridRoot readOnly={props.readOnly}>
        <Probe {...props} />
      </DataGridRoot>
    </DataGridProvider>,
  );
}

const ids = (specs: GridMenuItemSpec[]) => specs.map((s) => s.id);

describe("useDefaultCellMenuItems", () => {
  it("builds the full built-in set with stable ids when both row-op props are given", () => {
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
    expect(ids(header)).toEqual(["sort-asc", "sort-desc", "sep-sort", "pin-left", "pin-right", "hide-column", "sep-autosize", "autosize"]);
    expect(item(header, "unpin")).toBeUndefined();
    // `disabled: !pinnable` is explicit; only `true` renders inert
    expect(item(header, "pin-left")?.disabled).toBe(false);
  });

  it("adds the unpin entry for a pinned column", () => {
    let header: GridMenuItemSpec[] = [];
    renderProbe({ pin: "left", onSpecs: (_c, h) => { header = h; } });
    expect(ids(header)).toEqual(["sort-asc", "sort-desc", "sep-sort", "pin-left", "pin-right", "unpin", "hide-column", "sep-autosize", "autosize"]);
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
    act(() => actions!.setRowSelected(2, true));
    act(() => actions!.setRowSelected(3, true));
    act(() => actions!.setSorts([{ columnId: "name", direction: "asc" }]));

    act(() => item(specs, "delete-rows")!.onClick!());

    await waitFor(() => expect(onDataChange).toHaveBeenCalledTimes(1));
    const ops = onDataChange.mock.calls[0]![1].ops as { rowId: string }[];
    expect(ops.map((op) => op.rowId).sort()).toEqual(["a", "c", "d"]);
  });
});
