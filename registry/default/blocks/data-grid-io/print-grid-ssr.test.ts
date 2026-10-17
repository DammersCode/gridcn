// @vitest-environment node
// node environment: the vm pool's global is the window itself, where document is non-configurable — SSR must be real, not stubbed.
import { expect, it } from "vitest";
import { DEFAULT_LABELS, CompactSelection, type CellType, type ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { printGrid } from "./print-grid";

type Row = { id: string; name: string; note: string };

const textCellType: CellType<Row, string> = {
  Cell: () => null,
  Editor: () => null,
  toText: (value) => value ?? "",
  fromText: (text) => text,
  clearValue: () => "",
  isEmpty: (value) => value === "",
};

function makeState(): DataGridStoreState {
  const data: Row[] = [
    { id: "1", name: "Alice", note: "a" },
    { id: "2", name: "Bob", note: "b" },
    { id: "3", name: "Carl", note: "c" },
  ];
  const columns: ColumnDef<Row, unknown>[] = [
    { id: "name", header: "Name", accessorKey: "name", type: "text" },
    { id: "note", header: "Note", accessorKey: "note", type: "text" },
  ];
  return {
    data,
    visibleColumns: columns as never,
    viewIndex: [0, 1, 2],
    cellTypes: { text: textCellType as never },
    labels: DEFAULT_LABELS,
    selection: { current: null, rows: CompactSelection.empty(), columns: CompactSelection.empty() },
  } as unknown as DataGridStoreState;
}

it("is a no-op without a document (SSR)", () => {
  expect(() => printGrid(makeState())).not.toThrow();
});
