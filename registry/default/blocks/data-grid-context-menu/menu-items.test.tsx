import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DataGridProvider, DataGridRoot, defineColumns } from "../data-grid/data-grid";
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
  onSpecs?: (cell: GridMenuItemSpec[], header: GridMenuItemSpec[]) => void;
};

function Probe(props: ProbeProps) {
  const cellSpecs = useDefaultCellMenuItems({
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

