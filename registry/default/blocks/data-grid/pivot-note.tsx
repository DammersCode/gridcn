"use client";

import type { ReactNode } from "react";
import type { ColumnGroupModel } from "./columns/column-groups";
import { useDataGridColumnGroupModel, useDataGridInstanceId, useDataGridLabels, useDataGridStore } from "./store";

/** The header groups the grid draws: the generated `__pivotgroup:` groups under pivot, else the consumer's `columnGroups`. */
export function useHeaderGroupModel(): ColumnGroupModel | null {
  const consumer = useDataGridColumnGroupModel();
  const pivot = useDataGridStore((s) => s.pivot);
  return pivot ? pivot.groupModel : consumer;
}

/** The id of the "+N more columns" note, present only when generated columns were cut. */
export function usePivotNoteId(): string | undefined {
  const instanceId = useDataGridInstanceId();
  const cut = useDataGridStore((s) => (s.pivot?.omitted ?? 0) > 0);
  return cut ? `${instanceId}-pivot-note` : undefined;
}

/** The note below a pivot grid that counts the generated columns the server or the grid cut. */
export function DataGridPivotNote({ id }: { id: string }): ReactNode {
  const omitted = useDataGridStore((s) => s.pivot?.omitted ?? 0);
  const labels = useDataGridLabels();
  return (
    <p id={id} data-grid-pivot-note="" className="px-2 py-1 text-xs text-muted-foreground">
      {labels.pivot.moreColumns(omitted)}
    </p>
  );
}
