"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
  type CellClickCtx,
  type ColumnLayout,
  type DataChange,
  type FilterJoinOperator,
  type FilterSpec,
  type GridSelection,
  type RowClickCtx,
  type SelectionChangeDetails,
  type SortSpec,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridFill, type FillArgs } from "@/registry/default/blocks/data-grid-fill/data-grid-fill";
import { useDataGridPresence } from "@/registry/default/blocks/data-grid-presence/data-grid-presence";
import {
  DataGridToolbar,
  DataGridSearch,
  DataGridFilterMenu,
} from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import {
  DataGridContextMenu,
  DataGridHeaderDropdown,
} from "@/registry/default/blocks/data-grid-context-menu/data-grid-context-menu";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 70, flex: 1 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 90, flex: 2 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 50, flex: 1, filterable: true },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 50, flex: 1, filterable: true },
] as const);

/** One inspector entry: which event fired, when, and its pretty-printed payload. */
type LogEntry = { id: number; source: string; at: number; payload: unknown };

/** Latest entries first, capped so the panel never grows unbounded across a long demo session. */
const MAX_LOG_ENTRIES = 20;

/** Module-wide counter for LogEntry.id — Date.now() alone can collide when two events fire in the same tick (e.g. an edit commit moves both data and selection). */
let logIdCounter = 0;

function pushLog(prev: LogEntry[], entry: Omit<LogEntry, "id">): LogEntry[] {
  logIdCounter += 1;
  return [{ ...entry, id: logIdCounter }, ...prev].slice(0, MAX_LOG_ENTRIES);
}

/** Rows shown from `details.getValues()`'s result in the inspector preview; demo chrome only, not a grid limit. */
const MAX_VALUES_PREVIEW_ROWS = 5;

/** Truncates a `getValues()` result for display, marking whether rows were cut off. */
function truncateValuesPreview(values: unknown[][]): { rows: unknown[][]; truncated: boolean } {
  return { rows: values.slice(0, MAX_VALUES_PREVIEW_ROWS), truncated: values.length > MAX_VALUES_PREVIEW_ROWS };
}

function EventLogPanel({ entries }: { entries: LogEntry[] }): ReactNode {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">Event inspector</h3>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-muted/30 p-2">
        {entries.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">Interact with the grid to see events appear here.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {entries.map((entry) => (
              <li key={entry.id} className="rounded-sm border border-border bg-background p-2">
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-foreground">{entry.source}</span>
                  <span className="text-muted-foreground">{new Date(entry.at).toLocaleTimeString()}</span>
                </div>
                <pre className="overflow-x-auto text-[11px] leading-snug text-muted-foreground">
                  {JSON.stringify(entry.payload, null, 2)}
                </pre>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/** Round-trips a fake highlight through the `data-grid-presence` add-on's `setPresenceHighlights` — the two-sided pattern (action in, read-back out) contrasted against every other, outbound-only event source. */
function PresenceReadBackButton({
  setPresenceHighlights,
  onFired,
}: {
  setPresenceHighlights: ReturnType<typeof useDataGridPresence>["setPresenceHighlights"];
  onFired: (payload: unknown) => void;
}): ReactNode {
  return (
    <button
      type="button"
      className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-accent"
      onClick={() => {
        const highlights = [{ id: "demo-user", color: "#2563eb", range: { x: 0, y: 0, width: 1, height: 1 }, label: "Demo" }];
        setPresenceHighlights(highlights);
        onFired(highlights);
      }}
    >
      Simulate presence highlight
    </button>
  );
}

/**
 * Events & state showcase (docs/events-state): grid on the left, live inspector on the right
 * pretty-printing the latest payload per event source, most recent first. Wires every event source
 * from the page's numbered sections — onDataChange, onSelectionChange (with details.getValues()),
 * onSortChange, onFilterChange + join, onCellClick/onRowClick, onFill (the `data-grid-fill`
 * add-on's hook option), onRowWindowChange,
 * onColumnLayoutChange + onColumnResizing, and presence read-back as the two-sided contrast.
 */
export default function DataGridEventsDemo(): ReactNode {
  const [data, setData] = useState<readonly DemoRow[]>(() => generateDemoRows(60));
  const [log, setLog] = useState<LogEntry[]>([]);

  const onDataChange = useCallback((next: readonly DemoRow[], change: DataChange<DemoRow>) => {
    setData(next);
    setLog((prev) => pushLog(prev, { source: "onDataChange", at: Date.now(), payload: change }));
  }, []);

  const onSelectionChange = useCallback((selection: GridSelection, details: SelectionChangeDetails) => {
    setLog((prev) =>
      pushLog(prev, {
        source: "onSelectionChange",
        at: Date.now(),
        payload: {
          cell: selection.current?.cell ?? null,
          range: selection.current?.range ?? null,
          rows: selection.rows.toArray(),
          columns: selection.columns.toArray(),
          // details.getValues() is lazy — only materialized here because the inspector displays it;
          // truncated to MAX_VALUES_PREVIEW_ROWS so a large drag-selected range doesn't dump a huge payload.
          values: truncateValuesPreview(details.getValues()),
        },
      }),
    );
  }, []);

  const onSortChange = useCallback((next: SortSpec[]) => {
    setLog((prev) => pushLog(prev, { source: "onSortChange", at: Date.now(), payload: next }));
  }, []);

  const onFilterChange = useCallback((next: FilterSpec[]) => {
    setLog((prev) => pushLog(prev, { source: "onFilterChange", at: Date.now(), payload: next }));
  }, []);

  const onJoinOperatorChange = useCallback((next: FilterJoinOperator) => {
    setLog((prev) => pushLog(prev, { source: "onJoinOperatorChange", at: Date.now(), payload: next }));
  }, []);

  const onFill = useCallback((args: FillArgs) => {
    setLog((prev) =>
      pushLog(prev, {
        source: "onFill",
        at: Date.now(),
        payload: { source: args.source, target: args.target, values: args.values },
      }),
    );
  }, []);

  const onRowWindowChange = useCallback((range: { start: number; end: number }) => {
    setLog((prev) => pushLog(prev, { source: "onRowWindowChange", at: Date.now(), payload: range }));
  }, []);

  const onColumnLayoutChange = useCallback((next: ColumnLayout) => {
    setLog((prev) => pushLog(prev, { source: "onColumnLayoutChange", at: Date.now(), payload: next }));
  }, []);

  const onColumnResizing = useCallback((columnId: string, width: number) => {
    setLog((prev) => pushLog(prev, { source: "onColumnResizing", at: Date.now(), payload: { columnId, width } }));
  }, []);

  // <DataGridRoot<DemoRow>> below types ctx.row directly — no cast (see events-state.mdx).
  const onCellClick = useCallback((ctx: CellClickCtx<DemoRow, unknown>) => {
    setLog((prev) =>
      pushLog(prev, {
        source: "onCellClick",
        at: Date.now(),
        payload: { columnId: ctx.column.id, rowIndex: ctx.rowIndex, columnIndex: ctx.columnIndex, value: ctx.value, rowId: ctx.row.id },
      }),
    );
  }, []);

  const onRowClick = useCallback((ctx: RowClickCtx<DemoRow>) => {
    setLog((prev) => pushLog(prev, { source: "onRowClick", at: Date.now(), payload: { rowIndex: ctx.rowIndex, rowId: ctx.row.id } }));
  }, []);

  const onPresenceFired = useCallback((payload: unknown) => {
    setLog((prev) => pushLog(prev, { source: "setPresenceHighlights (read-back)", at: Date.now(), payload }));
  }, []);

  const { plugin: presencePlugin, setPresenceHighlights } = useDataGridPresence();
  const { plugin: fillPlugin, FillHandleTracker } = useDataGridFill({ onFill });
  const overlayPlugins = useMemo(() => [presencePlugin, fillPlugin], [presencePlugin, fillPlugin]);

  return (
    <div className="w-full flex h-[480px] gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          Click or edit a cell, drag-select, sort/filter a column, drag-fill, scroll, resize/pin/hide a column.
        </p>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
          <DataGridProvider
            data={data}
            columns={columns}
            getRowId={(row) => row.id}
            onDataChange={onDataChange}
            onSelectionChange={onSelectionChange}
            onSortChange={onSortChange}
            onFilterChange={onFilterChange}
            onJoinOperatorChange={onJoinOperatorChange}
            onColumnLayoutChange={onColumnLayoutChange}
            onColumnResizing={onColumnResizing}
            headerClickBehavior="sort"
            overlayPlugins={overlayPlugins}
          >
            <DataGridToolbar>
              <DataGridSearch />
              <DataGridFilterMenu />
              <PresenceReadBackButton setPresenceHighlights={setPresenceHighlights} onFired={onPresenceFired} />
            </DataGridToolbar>
            <DataGridContextMenu className="flex min-h-0 flex-1 flex-col">
              <DataGridRoot<DemoRow>
                className="h-full rounded-none border-none"
                renderHeaderMenu={(ctx) => <DataGridHeaderDropdown {...ctx} />}
                onRowWindowChange={onRowWindowChange}
                onCellClick={onCellClick}
                onRowClick={onRowClick}
              >
                <DataGridHeader />
                <DataGridBody />
                <FillHandleTracker />
              </DataGridRoot>
            </DataGridContextMenu>
          </DataGridProvider>
        </div>
      </div>
      <div className="w-80 shrink-0">
        <EventLogPanel entries={log} />
      </div>
    </div>
  );
}
