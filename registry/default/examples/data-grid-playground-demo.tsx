"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, Circle, List, ListChecks, Minus, TrendingDown, TrendingUp, Upload, User } from "lucide-react";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
  useDataGridActions,
  useDataGridSortState,
  type ColumnDef,
  type DensityMode,
  type GridDirection,
  type HeaderClickBehavior,
  type MarkerCellRenderCtx,
  type MarkerCellRenderer,
  type MarkerHeaderRenderCtx,
  type MarkerHeaderRenderer,
  type RowMarkersMode,
  type CellPatch,
  type SortSpec,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridState } from "@/registry/default/blocks/data-grid-history/data-grid-history";
import { useDataGridFill } from "@/registry/default/blocks/data-grid-fill/data-grid-fill";
import {
  useDataGridPinnedRows,
  DataGridAggregateReporter,
  type AggregateSpecs,
} from "@/registry/default/blocks/data-grid-pinned-rows/data-grid-pinned-rows";
import { useDataGridPresence, type PresenceHighlight } from "@/registry/default/blocks/data-grid-presence/data-grid-presence";
import { useDataGridLazyRows, DataGridLazyGuard } from "@/registry/default/blocks/data-grid-lazy/data-grid-lazy";
import { useDataGridPagination, DataGridPaginationBar } from "@/registry/default/blocks/data-grid-pagination/data-grid-pagination";
import {
  DataGridToolbar,
  DataGridSearch,
  DataGridFilterMenu,
  DataGridColumnsMenu,
} from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import {
  DataGridContextMenu,
  DataGridHeaderDropdown,
} from "@/registry/default/blocks/data-grid-context-menu/data-grid-context-menu";
import { DataGridSortList } from "@/registry/default/blocks/data-grid-sort-list/data-grid-sort-list";
import {
  DataGridKeybindingsDialog,
  DataGridKeybindingsShortcut,
} from "@/registry/default/blocks/data-grid-keybindings/data-grid-keybindings";
import { DataGridExportButton, DataGridImportButton } from "@/registry/default/blocks/data-grid-io/data-grid-io";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { generateDemoRows, type DemoRow } from "./demo-data";

type RowSupplyMode = "virtualized" | "paginated" | "lazy";
type ReorderMode = "defer" | "immediate";

const BASE_COLUMNS = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 160 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 90, filterable: true },
  {
    id: "role",
    header: "Role",
    accessorKey: "role",
    type: "select",
    options: {
      choices: [
        { value: "Admin", label: "Admin" },
        { value: "User", label: "User" },
        { value: "Editor", label: "Editor" },
        { value: "Viewer", label: "Viewer" },
        { value: "Manager", label: "Manager" },
      ],
    },
    width: 130,
  },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 90, filterable: true },
] as const);

// Hand-rolled `validate` swap-in for the Age column — kept independent of the dedicated validation
// demo on purpose; every registry example must stand alone for consumers who install it solo.
const VALIDATION_COLUMNS: readonly ColumnDef<DemoRow, unknown>[] = BASE_COLUMNS.map((column) =>
  column.id === "age" ? { ...column, validate: (value: unknown) => (typeof value === "number" && value < 18 ? "Must be 18 or older" : null) } : column,
);

// A header that subscribes to the live sort state and renders a three-state direction icon:
// muted minus when unsorted, up icon ascending, down icon descending (grid icon style).
// Module scope keeps the header element identity stable; defined here (not imported from the
// custom-headers demo) because every registry example must stand alone.
function LiveSortHeader(props: { columnId: string; label: string; icon?: ReactNode; ascIcon: ReactNode; descIcon: ReactNode }): ReactNode {
  const sortState = useDataGridSortState();
  const entry = sortState.find((spec) => spec.columnId === props.columnId);
  const directionIcon =
    entry?.direction === "asc"
      ? props.ascIcon
      : entry?.direction === "desc"
        ? props.descIcon
        : <Minus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
  return (
    <span className="flex items-center gap-1.5">
      {props.icon}
      {props.label}
      <span className="flex shrink-0 items-center">{directionIcon}</span>
    </span>
  );
}

// `header` as a component (live sort-direction icon): module scope keeps the columns references
// stable across renders, so toggling never busts the provider's column subscriptions.
const withIconHeaders = (columns: readonly ColumnDef<DemoRow, unknown>[]): readonly ColumnDef<DemoRow, unknown>[] =>
  columns.map((column) => {
    if (column.id === "name") {
      return {
        ...column,
        header: (
          <LiveSortHeader
            columnId="name"
            label="Name"
            icon={<User className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
            ascIcon={<ArrowUp className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
            descIcon={<ArrowDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
          />
        ),
        headerText: "Name",
      };
    }
    if (column.id === "score") {
      return {
        ...column,
        header: (
          <LiveSortHeader
            columnId="score"
            label="Score"
            ascIcon={<TrendingUp className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
            descIcon={<TrendingDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
          />
        ),
        headerText: "Score",
      };
    }
    return column;
  });

const ICON_BASE_COLUMNS = withIconHeaders(BASE_COLUMNS);
const ICON_VALIDATION_COLUMNS = withIconHeaders(VALIDATION_COLUMNS);

// Custom marker renderers for the "Custom marker" toggle: module scope for stable identity (the
// same rule as withIconHeaders above). The row icon is presentational; the marker cell's own
// press/drag gesture on the wrapper still selects rows. Three states: the row selected (check),
// only cells of the row selected (minus), or neither (circle) — the ctx's isRowChannelSelected is
// the rows channel only, so a cell click never flips it.
const customMarkerRenderMarker = ({ isRowChannelSelected, isCellSelected }: MarkerCellRenderCtx): ReactNode => (
  <span className="flex size-5 items-center justify-center">
    {isRowChannelSelected ? (
      <Check className="size-3.5 text-muted-foreground" aria-hidden="true" />
    ) : isCellSelected ? (
      <Minus className="size-3.5 text-muted-foreground" aria-hidden="true" />
    ) : (
      <Circle className="size-3.5 text-muted-foreground" aria-hidden="true" />
    )}
  </span>
);

function CustomMarkerSelectAll({ allSelected }: { allSelected: MarkerHeaderRenderCtx["allSelected"] }): ReactNode {
  const { setAllRowsSelected } = useDataGridActions();
  const checked = allSelected === "checked";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-5"
      aria-label={checked ? "Unselect all rows" : "Select all rows"}
      aria-pressed={checked}
      onClick={() => setAllRowsSelected(!checked)}
    >
      {checked ? (
        <ListChecks className="size-3.5 text-muted-foreground" aria-hidden="true" />
      ) : (
        <List className="size-3.5 text-muted-foreground" aria-hidden="true" />
      )}
    </Button>
  );
}

const customMarkerRenderMarkerHeader = ({ allSelected }: MarkerHeaderRenderCtx): ReactNode => (
  <CustomMarkerSelectAll allSelected={allSelected} />
);

const AGGREGATE_SPECS: AggregateSpecs = { name: (_values, rows) => `${rows.length} rows`, age: "avg", score: "sum" };
const EMPTY_TOTALS_ROW: DemoRow = { id: "__totals__", name: "0 rows", email: "", age: 0, active: false, role: "Total", joined: "", score: 0 };

const ROW_MARKERS_OPTIONS: readonly RowMarkersMode[] = ["none", "number", "checkbox", "both"];
const DENSITY_OPTIONS: readonly DensityMode[] = ["compact", "default", "comfortable"];
const HEADER_CLICK_OPTIONS: readonly HeaderClickBehavior[] = ["select", "sort", "none"];
const MODE_OPTIONS: readonly RowSupplyMode[] = ["virtualized", "paginated", "lazy"];

const SIMULATED_PEERS = [
  { id: "ada", color: "#e11d48", label: "Ada" },
  { id: "grace", color: "#2563eb", label: "Grace" },
] as const;

/** Every control this demo exposes, threaded through from the single top-level state block into whichever row-supply subtree is mounted. */
type PlaygroundControls = {
  columns: readonly ColumnDef<DemoRow, unknown>[];
  rowMarkers: RowMarkersMode;
  renderMarker?: MarkerCellRenderer;
  renderMarkerHeader?: MarkerHeaderRenderer;
  headerClickBehavior: HeaderClickBehavior;
  density: DensityMode;
  direction: GridDirection;
  readOnly: boolean;
  loading: boolean;
  pinnedTotals: boolean;
  presence: boolean;
  streaming: boolean;
  streamingReorder: ReorderMode;
};

function useLatestRef<T>(value: T): { current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** Streams random Score patches into the grid four times a second while `enabled`. Rendered only inside the virtualized/paginated subtrees — never under lazy mode, where unloaded windows have no rows to patch. */
function StreamingFeed({ enabled, reorder, rowIds }: { enabled: boolean; reorder: ReorderMode; rowIds: readonly string[] }): ReactNode {
  const { updateCells } = useDataGridActions();
  const rowIdsRef = useLatestRef(rowIds);
  const reorderRef = useLatestRef(reorder);
  const updateCellsRef = useLatestRef(updateCells);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      const ids = rowIdsRef.current;
      if (ids.length === 0) return;
      const patches: CellPatch[] = Array.from({ length: 3 }, () => ({
        rowId: ids[Math.floor(Math.random() * ids.length)]!,
        columnId: "score",
        value: Math.floor(Math.random() * 100),
      }));
      updateCellsRef.current(patches, { reorder: reorderRef.current });
    }, 250);
    return () => clearInterval(id);
  }, [enabled, rowIdsRef, reorderRef, updateCellsRef]);

  return null;
}

/** Drives two simulated peers' presence highlights on a timer via `setPresenceHighlights`, while `enabled`. */
function usePresenceDriver(setPresenceHighlights: (highlights: PresenceHighlight[]) => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let tick = 0;
    const id = setInterval(() => {
      tick += 1;
      setPresenceHighlights(
        SIMULATED_PEERS.map((peer, i) => ({
          id: peer.id,
          color: peer.color,
          range: { x: (tick + i * 3) % 5, y: (tick * 2 + i * 5) % 8, width: 1, height: 1 },
          label: peer.label,
        })),
      );
    }, 900);
    return () => clearInterval(id);
  }, [enabled, setPresenceHighlights]);
}

/** Reads the pinned-totals aggregate and forwards it into the `bottom` band passed to `useDataGridPinnedRows`, the `DataGridAggregateReporter` pattern from pinned-rows-demo. */
function useTotalsBand(enabled: boolean) {
  const [totalsRow, setTotalsRow] = useState<DemoRow>(EMPTY_TOTALS_ROW);
  const onTotalsChange = useCallback((row: Record<string, unknown>) => {
    setTotalsRow((prev) => ({ ...prev, ...row }));
  }, []);
  const bottom = useMemo(() => (enabled ? [totalsRow] : []), [enabled, totalsRow]);
  const { rowBands } = useDataGridPinnedRows({ bottomRows: bottom });
  return { rowBands, onTotalsChange };
}

/** Toolbar + keybindings dialog shared identically across all three row-supply modes. */
function PlaygroundToolbar({
  keybindingsOpen,
  setKeybindingsOpen,
  importDisabled,
}: {
  keybindingsOpen: boolean;
  setKeybindingsOpen: (open: boolean) => void;
  importDisabled: boolean;
}): ReactNode {
  return (
    <>
      <DataGridToolbar>
        <DataGridSearch />
        <DataGridFilterMenu />
        <DataGridSortList />
        <DataGridColumnsMenu />
        {importDisabled ? (
          <Button type="button" variant="ghost" size="icon" disabled aria-label="Import (disabled in lazy mode)">
            <Upload />
          </Button>
        ) : (
          <DataGridImportButton<DemoRow>
            createRow={(index) => ({ id: `imported-${index}`, name: "", email: "", age: 18, active: false, role: "User", joined: "", score: 0 })}
            onImport={() => {}}
          />
        )}
        <DataGridExportButton />
        <Button variant="outline" size="sm" onClick={() => setKeybindingsOpen(true)}>
          Shortcuts
        </Button>
      </DataGridToolbar>
      <DataGridKeybindingsDialog open={keybindingsOpen} onOpenChange={setKeybindingsOpen} />
    </>
  );
}

/** The virtualized (default, no row-supply add-on) subtree: plain in-memory data via `useDataGridState`, full control set live. */
function VirtualizedGrid({ controls }: { controls: PlaygroundControls }): ReactNode {
  const grid = useDataGridState(useMemo(() => generateDemoRows(60), []), { getRowId: (row) => row.id });
  const { plugin: fillPlugin, FillHandleTracker } = useDataGridFill({});
  const { plugin: presencePlugin, setPresenceHighlights } = useDataGridPresence();
  const overlayPlugins = useMemo(() => [fillPlugin, presencePlugin], [fillPlugin, presencePlugin]);
  const [keybindingsOpen, setKeybindingsOpen] = useState(false);
  const { rowBands, onTotalsChange } = useTotalsBand(controls.pinnedTotals);
  const rowIds = useMemo(() => grid.data.map((row) => row.id), [grid.data]);

  usePresenceDriver(setPresenceHighlights, controls.presence);

  return (
    <DataGridProvider
      {...grid}
      columns={controls.columns}
      overlayPlugins={overlayPlugins}
      rowMarkers={controls.rowMarkers}
      headerClickBehavior={controls.headerClickBehavior}
      rowBands={rowBands}
    >
      {controls.pinnedTotals && <DataGridAggregateReporter specs={AGGREGATE_SPECS} onChange={onTotalsChange} />}
      <StreamingFeed enabled={controls.streaming} reorder={controls.streamingReorder} rowIds={rowIds} />
      <PlaygroundToolbar keybindingsOpen={keybindingsOpen} setKeybindingsOpen={setKeybindingsOpen} importDisabled={false} />
      <DataGridContextMenu className="flex min-h-0 flex-1 flex-col">
        <DataGridRoot
          className="h-full rounded-none border-none"
          renderHeaderMenu={(ctx) => <DataGridHeaderDropdown {...ctx} />}
          renderMarker={controls.renderMarker}
          renderMarkerHeader={controls.renderMarkerHeader}
          density={controls.density}
          direction={controls.direction}
          readOnly={controls.readOnly}
          loading={controls.loading}
        >
          <DataGridKeybindingsShortcut onOpen={() => setKeybindingsOpen(true)} />
          <DataGridHeader />
          <DataGridBody />
          <FillHandleTracker />
        </DataGridRoot>
      </DataGridContextMenu>
    </DataGridProvider>
  );
}

/** The paginated subtree: `DataGridPaginationBar` is standalone and reads no store, so it composes freely with every other toggle. */
function PaginatedGrid({ controls }: { controls: PlaygroundControls }): ReactNode {
  const [rows, setRows] = useState(() => generateDemoRows(120));
  const pager = useDataGridPagination({ data: rows, pageSize: 20 });
  const { plugin: fillPlugin, FillHandleTracker } = useDataGridFill({});
  const { plugin: presencePlugin, setPresenceHighlights } = useDataGridPresence();
  const overlayPlugins = useMemo(() => [fillPlugin, presencePlugin], [fillPlugin, presencePlugin]);
  const [keybindingsOpen, setKeybindingsOpen] = useState(false);
  const { rowBands, onTotalsChange } = useTotalsBand(controls.pinnedTotals);
  const rowIds = useMemo(() => rows.map((row) => row.id), [rows]);

  usePresenceDriver(setPresenceHighlights, controls.presence);

  const onDataChange = useCallback((next: readonly DemoRow[]) => {
    setRows((prev) => {
      const edited = new Map(next.map((row) => [row.id, row]));
      return prev.map((row) => edited.get(row.id) ?? row);
    });
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <DataGridProvider
        data={pager.pageData!}
        columns={controls.columns}
        getRowId={(row) => row.id}
        onDataChange={onDataChange}
        overlayPlugins={overlayPlugins}
        rowMarkers={controls.rowMarkers}
        headerClickBehavior={controls.headerClickBehavior}
        rowBands={rowBands}
      >
        {controls.pinnedTotals && <DataGridAggregateReporter specs={AGGREGATE_SPECS} onChange={onTotalsChange} />}
        <StreamingFeed enabled={controls.streaming} reorder={controls.streamingReorder} rowIds={rowIds} />
        <PlaygroundToolbar keybindingsOpen={keybindingsOpen} setKeybindingsOpen={setKeybindingsOpen} importDisabled={false} />
        <DataGridContextMenu className="flex min-h-0 flex-1 flex-col">
          <DataGridRoot
            className="min-h-0 flex-1 rounded-none border-none"
            renderHeaderMenu={(ctx) => <DataGridHeaderDropdown {...ctx} />}
            renderMarker={controls.renderMarker}
            renderMarkerHeader={controls.renderMarkerHeader}
            density={controls.density}
            direction={controls.direction}
            readOnly={controls.readOnly}
            loading={controls.loading}
          >
            <DataGridKeybindingsShortcut onOpen={() => setKeybindingsOpen(true)} />
            <DataGridHeader />
            <DataGridBody />
            <FillHandleTracker />
          </DataGridRoot>
        </DataGridContextMenu>
      </DataGridProvider>
      <DataGridPaginationBar {...pager.controls} />
    </div>
  );
}

const LAZY_TOTAL_COUNT = 5_000;
/** Simulated latency (ms), slow enough that skeleton rows are visibly on-screen during a fast scroll. */
const LAZY_LATENCY_MS = 300;

function lazyRowAt(index: number): DemoRow {
  return {
    id: `lazy-${index}`,
    name: `Person ${index}`,
    email: `person${index}@example.com`,
    age: 18 + (index % 50),
    active: index % 2 === 0,
    role: "User",
    joined: "",
    score: (index * 37) % 100,
  };
}

/** Stand-in backend: sorts the whole 5k dataset server-side, then serves the `[start, end)` slice of that order. */
async function fetchLazyRows(start: number, end: number, signal: AbortSignal, sorts: readonly SortSpec[]): Promise<DemoRow[]> {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, LAZY_LATENCY_MS);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    });
  });
  if (sorts.length === 0) {
    const rows: DemoRow[] = [];
    for (let i = start; i < end; i++) rows.push(lazyRowAt(i));
    return rows;
  }
  const all = Array.from({ length: LAZY_TOTAL_COUNT }, (_, i) => lazyRowAt(i));
  all.sort((a, b) => {
    for (const { columnId, direction } of sorts) {
      const av = a[columnId as keyof DemoRow];
      const bv = b[columnId as keyof DemoRow];
      if (av === bv) continue;
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true });
      return direction === "asc" ? cmp : -cmp;
    }
    return 0;
  });
  return all.slice(start, end);
}

/** Controlled-sort prop the lazy subtree holds permanently empty — see {@link LazyGrid}. */
const NO_CLIENT_SORT: SortSpec[] = [];

/**
 * The lazy subtree: streaming, pinned totals, and import are all disabled here (the docs' "lazy +
 * X is not supported" constraints) — streaming patches rows by id into windows that may not be
 * loaded, aggregate totals over a partially-loaded dataset would mislead, and import replaces
 * `data` wholesale, which this add-on owns.
 *
 * Sorting is server-side (lazy-loading.mdx): `onSortChange` hands the spec to the fake API, which
 * returns each window already in that order. `sortState` stays the empty array rather than echoing
 * the spec back, because the store sorts `data` by whatever `sortState` holds — echoing it would
 * re-sort the fetched window client-side over the handful of loaded rows.
 */
function LazyGrid({ controls }: { controls: PlaygroundControls }): ReactNode {
  const [sorts, setSorts] = useState<SortSpec[]>([]);

  // The store's `sortState` is pinned empty (below), so `toggleSort` always reports a first-click
  // "asc" for the clicked column; the asc -> desc -> none cycle is re-derived here against the spec
  // this component actually holds.
  const cycleSort = useCallback((next: SortSpec[]) => {
    const clicked = next[next.length - 1];
    setSorts((prev) => {
      if (!clicked) return [];
      const current = prev.find((s) => s.columnId === clicked.columnId);
      const direction = nextSortDirection(current?.direction);
      return direction === null ? [] : [{ columnId: clicked.columnId, direction }];
    });
  }, []);

  // Remount on every sort change: already-fetched windows hold the OLD server order, and the hook
  // only discards loaded ranges when `total` changes, so a fresh mount is the way to drop them.
  return <LazySortedGrid key={sortKey(sorts)} controls={controls} sorts={sorts} onSortsChange={cycleSort} />;
}

function nextSortDirection(current: SortSpec["direction"] | undefined): SortSpec["direction"] | null {
  return current === undefined ? "asc" : current === "asc" ? "desc" : null;
}

function sortKey(sorts: readonly SortSpec[]): string {
  return sorts.map((s) => `${s.columnId}:${s.direction}`).join(",");
}

function LazySortedGrid({
  controls,
  sorts,
  onSortsChange,
}: {
  controls: PlaygroundControls;
  sorts: readonly SortSpec[];
  onSortsChange: (next: SortSpec[]) => void;
}): ReactNode {
  const sortsRef = useLatestRef(sorts);
  const fetchSorted = useCallback(
    (start: number, end: number, signal: AbortSignal) => fetchLazyRows(start, end, signal, sortsRef.current),
    [sortsRef],
  );
  const lazy = useDataGridLazyRows<DemoRow>({
    total: LAZY_TOTAL_COUNT,
    fetchRows: fetchSorted,
    getRowId: (row) => row.id,
  });
  const { plugin: fillPlugin, FillHandleTracker } = useDataGridFill({});
  const { plugin: presencePlugin, setPresenceHighlights } = useDataGridPresence();
  const overlayPlugins = useMemo(() => [fillPlugin, presencePlugin], [fillPlugin, presencePlugin]);
  const [keybindingsOpen, setKeybindingsOpen] = useState(false);

  usePresenceDriver(setPresenceHighlights, controls.presence);

  return (
    <DataGridProvider
      data={lazy.gridProps.data}
      columns={controls.columns}
      getRowId={lazy.gridProps.getRowId}
      onDataChange={lazy.onDataChange}
      overlayPlugins={overlayPlugins}
      rowMarkers={controls.rowMarkers}
      headerClickBehavior={controls.headerClickBehavior}
      sortState={NO_CLIENT_SORT}
      onSortChange={onSortsChange}
    >
      <DataGridLazyGuard hasHoles={lazy.unloadedCount > 0} />
      <div data-testid="lazy-server-sort" className="px-2 text-xs text-muted-foreground">
        {sorts.length === 0 ? "Server sort: none" : `Server sort: ${sortKey(sorts)}`}
      </div>
      <PlaygroundToolbar keybindingsOpen={keybindingsOpen} setKeybindingsOpen={setKeybindingsOpen} importDisabled />
      <DataGridContextMenu className="flex min-h-0 flex-1 flex-col">
        <DataGridRoot
          className="h-full rounded-none border-none"
          renderHeaderMenu={(ctx) => <DataGridHeaderDropdown {...ctx} />}
          renderMarker={controls.renderMarker}
          renderMarkerHeader={controls.renderMarkerHeader}
          onRowWindowChange={lazy.gridProps.onRowWindowChange}
          density={controls.density}
          direction={controls.direction}
          readOnly={controls.readOnly}
          loading={controls.loading}
        >
          <DataGridKeybindingsShortcut onOpen={() => setKeybindingsOpen(true)} />
          <DataGridHeader />
          <DataGridBody />
          <FillHandleTracker />
        </DataGridRoot>
      </DataGridContextMenu>
    </DataGridProvider>
  );
}

function ToggleLabel({ disabled, children }: { disabled?: boolean; children: ReactNode }): ReactNode {
  return <label className={disabled ? "flex items-center gap-2 text-muted-foreground" : "flex items-center gap-2"}>{children}</label>;
}

/**
 * The playground (docs/playground): every always-on add-on the docs cover — core editing/selection,
 * toolbar (search/filter/columns), context menu + header dropdown, fill handle, undo/redo,
 * keybindings dialog, sort list, import/export — plus independent toggles (row markers, custom
 * markers, pinned totals, validation, read-only, loading, RTL, presence, streaming, density,
 * header click behavior)
 * and one exclusive `mode` select for the row-supply strategy: virtualized (default) / paginated /
 * lazy, never two at once (pagination.mdx, lazy-loading.mdx). `mode` renders one of three thin
 * wrapper subtrees rather than conditionally calling hooks; switching subtrees remounts the grid,
 * which resets selection for free.
 */
export default function DataGridPlaygroundDemo(): ReactNode {
  const [mode, setMode] = useState<RowSupplyMode>("virtualized");
  const [rowMarkers, setRowMarkers] = useState<RowMarkersMode>("none");
  const [headerClickBehavior, setHeaderClickBehaviorState] = useState<HeaderClickBehavior>("select");
  const [density, setDensity] = useState<DensityMode>("default");
  const [rtl, setRtl] = useState(false);
  const [validation, setValidation] = useState(false);
  const [customHeaders, setCustomHeaders] = useState(false);
  const [customMarker, setCustomMarker] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pinnedTotals, setPinnedTotals] = useState(false);
  const [presence, setPresence] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamingReorder, setStreamingReorder] = useState<ReorderMode>("defer");

  const isLazy = mode === "lazy";

  const controls: PlaygroundControls = {
    columns: validation ? (customHeaders ? ICON_VALIDATION_COLUMNS : VALIDATION_COLUMNS) : customHeaders ? ICON_BASE_COLUMNS : BASE_COLUMNS,
    rowMarkers,
    renderMarker: customMarker ? customMarkerRenderMarker : undefined,
    renderMarkerHeader: customMarker ? customMarkerRenderMarkerHeader : undefined,
    headerClickBehavior,
    density,
    direction: rtl ? "rtl" : "ltr",
    readOnly,
    loading,
    pinnedTotals: pinnedTotals && !isLazy,
    presence,
    streaming: streaming && !isLazy,
    streamingReorder,
  };

  return (
    <div className="w-full flex h-[560px] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          Mode
          <Select value={mode} onValueChange={(value) => setMode(value as RowSupplyMode)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODE_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-2">
          Row markers
          <Select value={rowMarkers} onValueChange={(value) => setRowMarkers(value as RowMarkersMode)}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROW_MARKERS_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-2">
          Header click
          <Select value={headerClickBehavior} onValueChange={(value) => setHeaderClickBehaviorState(value as HeaderClickBehavior)}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HEADER_CLICK_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-2">
          Density
          <Select value={density} onValueChange={(value) => setDensity(value as DensityMode)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DENSITY_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <Switch checked={validation} onCheckedChange={setValidation} />
          Validation
        </label>
        <label className="flex items-center gap-2">
          <Switch checked={customHeaders} onCheckedChange={setCustomHeaders} />
          Custom headers
        </label>
        <ToggleLabel disabled={rowMarkers === "none"}>
          <Switch checked={customMarker} onCheckedChange={setCustomMarker} disabled={rowMarkers === "none"} />
          Custom marker{rowMarkers === "none" ? " (needs a row-markers mode)" : ""}
        </ToggleLabel>
        <label className="flex items-center gap-2">
          <Switch checked={readOnly} onCheckedChange={setReadOnly} />
          Read-only
        </label>
        <label className="flex items-center gap-2">
          <Switch checked={loading} onCheckedChange={setLoading} />
          Loading
        </label>
        <label className="flex items-center gap-2">
          <Switch checked={rtl} onCheckedChange={setRtl} />
          RTL
        </label>
        <ToggleLabel disabled={isLazy}>
          <Switch checked={pinnedTotals && !isLazy} onCheckedChange={setPinnedTotals} disabled={isLazy} />
          Pinned totals{isLazy ? " (disabled in lazy mode)" : ""}
        </ToggleLabel>
        <label className="flex items-center gap-2">
          <Switch checked={presence} onCheckedChange={setPresence} />
          Presence
        </label>
        <ToggleLabel disabled={isLazy}>
          <Switch checked={streaming && !isLazy} onCheckedChange={setStreaming} disabled={isLazy} />
          Streaming{isLazy ? " (disabled in lazy mode)" : ""}
        </ToggleLabel>
        {streaming && !isLazy && (
          <label className="flex items-center gap-2">
            <Switch checked={streamingReorder === "immediate"} onCheckedChange={(checked) => setStreamingReorder(checked ? "immediate" : "defer")} />
            Auto-sort while streaming
          </label>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
        {mode === "virtualized" && <VirtualizedGrid key="virtualized" controls={controls} />}
        {mode === "paginated" && <PaginatedGrid key="paginated" controls={controls} />}
        {mode === "lazy" && <LazyGrid key="lazy" controls={controls} />}
      </div>
    </div>
  );
}
