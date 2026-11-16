import { useDataGridImportPreview } from "./data-grid-io";
import type { CellType } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridCellTypes } from "@/registry/default/blocks/data-grid/data-grid";

type Row = { id: string };

export function noArgImportPreview() {
  const preview = useDataGridImportPreview();
  preview.build<Row>({ createRow: (index) => ({ id: String(index) }) });
}

export function buildTakesTheCellTypesHook() {
  const preview = useDataGridImportPreview();
  const cellTypes: Record<string, CellType> = useDataGridCellTypes();
  preview.build<Row>({ cellTypes, createRow: (index) => ({ id: String(index) }) });
}
