"use client";

import type { CSSProperties, ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { RowMarkersMode } from "../types";
import { markerContent } from "./marker-width";
import { GRID_LAYER } from "../layers";
import { COLUMN_BORDER } from "../columns/column-border";
import { useDataGridRootContext } from "../layout-context";
import { useDataGridActions, useDataGridAllRowsSelected, useDataGridLabels } from "../store";

/** Props for {@link DataGridMarkerHeader}. */
export type DataGridMarkerHeaderProps = {
  mode: RowMarkersMode;
  /** The whole header block's height. */
  headerHeight: number;
  /** Header rows the cell spans. Default 1. */
  rowSpan?: number;
};

/**
 * The marker column's header cell: a select-all checkbox for the modes whose content includes a
 * checkbox ('checkbox'/'both' and their `reorder-` variants; checked/indeterminate/unchecked against the rows channel vs. view row count), otherwise blank chrome. `role="columnheader"` with no `aria-colindex` (its
 * position is then inferred from DOM order, per the WAI-ARIA grid pattern) — it's a real structural
 * child of the header `row`, just outside the DATA header's aria-colindex/aria-colcount space (see
 * marker-cell.tsx's doc comment). `role="presentation"` was tried first but axe's
 * aria-required-children rule flags it: a `row`'s required-owned-element children have their
 * presentational role force-reverted by the accessibility tree builder regardless (Core-AAM
 * "presentational role conflict resolution"), so it never actually suppressed anything at the AT
 * level — it just left the cell unlabeled.
 */
export function DataGridMarkerHeader(props: DataGridMarkerHeaderProps): ReactNode {
  const { mode, headerHeight, rowSpan = 1 } = props;
  const actions = useDataGridActions();
  const state = useDataGridAllRowsSelected();
  const labels = useDataGridLabels();
  const { renderMarkerHeader } = useDataGridRootContext();

  const style: CSSProperties = {
    gridRowStart: 1,
    ...(rowSpan > 1 ? { gridRowEnd: `span ${rowSpan}` } : {}),
    gridColumnStart: 1,
    position: "relative",
    insetInlineStart: "var(--grid-scroll-left, 0px)",
    zIndex: GRID_LAYER.pinnedHeader,
    height: headerHeight,
  };

  return (
    <div
      role="columnheader"
      data-grid-marker-header=""
      className={`flex items-center justify-center border-b border-border bg-muted ${COLUMN_BORDER}`}
      style={style}
    >
      {renderMarkerHeader ? (
        renderMarkerHeader({ allSelected: state })
      ) : (
        <>
          <span className="sr-only">{labels.markers.columnHeader}</span>
          {(markerContent(mode) === "checkbox" || markerContent(mode) === "both") && (
            <Checkbox
              checked={state === "checked"}
              tabIndex={-1}
              indeterminate={state === "indeterminate"}
              onCheckedChange={(checked) => actions.setAllRowsSelected(checked === true)}
              aria-label={labels.markers.selectAll}
            />
          )}
        </>
      )}
    </div>
  );
}
