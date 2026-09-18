"use client";

import { useMemo, type ReactNode } from "react";
import { Check, Circle, List, ListChecks, ListMinus, Minus } from "lucide-react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
  useDataGridActions,
  type MarkerCellRenderCtx,
  type MarkerHeaderRenderCtx,
} from "@/registry/default/blocks/data-grid/data-grid";
import { Button } from "@/components/ui/button";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 150, flex: 2 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 100, flex: 1 },
] as const);

/**
 * A module-scope (stable-identity) `renderMarker` with three states: the row selected (check),
 * only cells of the row selected (minus), or neither (circle). `isRowChannelSelected` is the rows
 * channel only: a plain cell click opens the cell channel and clears the rows channel, so a check
 * falls back to circle/minus, while the marker cell's own press/drag gesture (on the wrapper, not
 * on this node) selects the row.
 */
const renderMarker = ({ isRowChannelSelected, isCellSelected }: MarkerCellRenderCtx): ReactNode => (
  <span data-testid="custom-row-marker" className="flex size-5 items-center justify-center">
    {isRowChannelSelected ? (
      <Check className="size-3.5 text-muted-foreground" aria-hidden="true" />
    ) : isCellSelected ? (
      <Minus className="size-3.5 text-muted-foreground" aria-hidden="true" />
    ) : (
      <Circle className="size-3.5 text-muted-foreground" aria-hidden="true" />
    )}
  </span>
);

/**
 * The select-all control for the marker header: mounted by `DataGridHeader` inside the provider,
 * so it can drive the rows channel through `useDataGridActions`. The icon follows
 * `allSelected`, and the button supplies its own accessible name (the built-in checkbox's
 * `labels.markers.selectAll` aria-label does not come for free here).
 */
function SelectAllMarkerButton({ allSelected }: { allSelected: MarkerHeaderRenderCtx["allSelected"] }): ReactNode {
  const { setAllRowsSelected } = useDataGridActions();
  const checked = allSelected === "checked";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-5"
      data-testid="custom-marker-header"
      aria-label={checked ? "Unselect all rows" : "Select all rows"}
      aria-pressed={checked}
      onClick={() => setAllRowsSelected(!checked)}
    >
      {allSelected === "indeterminate" ? (
        <ListMinus className="size-3.5 text-muted-foreground" aria-hidden="true" />
      ) : checked ? (
        <ListChecks className="size-3.5 text-muted-foreground" aria-hidden="true" />
      ) : (
        <List className="size-3.5 text-muted-foreground" aria-hidden="true" />
      )}
    </Button>
  );
}

const renderMarkerHeader = ({ allSelected }: MarkerHeaderRenderCtx): ReactNode => (
  <SelectAllMarkerButton allSelected={allSelected} />
);

/**
 * `renderMarker` / `renderMarkerHeader`: replace the marker column's built-in content (row
 * checkbox/number, select-all checkbox) with custom nodes. The `rowMarkers` mode still sets the
 * track width, and the marker cell's press/drag row-selection gesture stays on the wrapper.
 */
export default function DataGridCustomMarkersDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(10), []);

  return (
    <div className="w-full flex h-[360px] flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        The marker has three states: row selected (check), only cells of the row selected
        (minus), or neither (circle). Pressing or dragging a marker cell selects the row; a plain
        cell click selects that cell and clears the row selection (Ctrl+click adds a range without
        clearing it).
      </p>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
        <DataGridProvider defaultData={rows} columns={columns} getRowId={(row) => row.id} rowMarkers="checkbox">
          <DataGridRoot className="h-full rounded-none border-none" renderMarker={renderMarker} renderMarkerHeader={renderMarkerHeader}>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
    </div>
  );
}
