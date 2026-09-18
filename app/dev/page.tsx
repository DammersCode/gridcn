"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
  type ColumnDef,
  type DensityMode,
  type DeepPartialLabels,
  type HeaderClickBehavior,
  type RowMarkersMode,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridState } from "@/registry/default/blocks/data-grid-history/data-grid-history";
import {
  DataGridToolbar,
  DataGridSearch,
  DataGridFilterMenu,
  DataGridColumnsMenu,
} from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import { DataGridSortList } from "@/registry/default/blocks/data-grid-sort-list/data-grid-sort-list";
import { DataGridContextMenu, DataGridHeaderDropdown } from "@/registry/default/blocks/data-grid-context-menu/data-grid-context-menu";
import { DataGridKeybindingsDialog, DataGridKeybindingsShortcut } from "@/registry/default/blocks/data-grid-keybindings/data-grid-keybindings";
import { DataGridExportButton, DataGridImportButton } from "@/registry/default/blocks/data-grid-io/data-grid-io";
import { Button } from "@/components/ui/button";

interface Row {
  id: string;
  n: number;
  name: string;
  email: string;
  age: number;
  active: boolean;
  role: string;
  joined: string;
  score: number;
}

/** Deterministic LCG so SSR/CSR markup match without Math.random(). */
function createSeededLCG(seed: number) {
  let state = seed;
  return {
    next() {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    },
  };
}

function generateRows(count: number): Row[] {
  const rng = createSeededLCG(42);
  const roles = ["Admin", "User", "Editor", "Viewer", "Manager"];
  const adjectives = ["Eager", "Quick", "Silent", "Bold", "Swift"];
  const nouns = ["Eagle", "Lion", "Tiger", "Bear", "Wolf"];
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      id: `row-${i}`,
      n: i,
      name: `${adjectives[Math.floor(rng.next() * 5)]} ${nouns[Math.floor(rng.next() * 5)]}`,
      email: `user${i}@example.com`,
      age: Math.floor(rng.next() * 50) + 18,
      active: rng.next() > 0.5,
      role: roles[Math.floor(rng.next() * 5)]!, // roles is a fixed non-empty literal array
      joined: `${2020 + Math.floor(rng.next() * 5)}-${String(Math.floor(rng.next() * 12) + 1).padStart(2, "0")}-${String(Math.floor(rng.next() * 28) + 1).padStart(2, "0")}`,
      score: Math.floor(rng.next() * 100),
    });
  }
  return rows;
}

const baseColumns = defineColumns<Row>()([
  {
    id: "id",
    header: "ID",
    accessorKey: "id",
    type: "text",
    width: 120,
    pin: "left",
  },
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 180 },
  {
    id: "email",
    header: "Email",
    accessorKey: "email",
    type: "text",
    width: 200,
  },
  {
    id: "age",
    header: "Age",
    accessorKey: "age",
    type: "number",
    options: { min: 18, max: 100 },
    width: 80,
  },
  {
    id: "active",
    header: "Active",
    accessorKey: "active",
    type: "checkbox",
    width: 100,
  },
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
    width: 140,
  },
  {
    id: "joined",
    header: "Joined",
    accessorKey: "joined",
    type: "date",
    options: {
      displayFormat: { year: "numeric", month: "short", day: "numeric" },
    },
    width: 140,
  },
  {
    id: "score",
    header: "Score",
    accessorKey: "score",
    type: "number",
    options: { min: 0, max: 100 },
    width: 100,
  },
] as const);

/** Extra numeric columns computed from the row index — no extra row memory. */
function makeExtraColumns(count: number): ColumnDef<Row, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `extra-${i}`,
    header: `Col ${i + 9}`,
    accessorFn: (row: Row) => (row.n * 31 + i * 17) % 1000,
    type: "number",
    width: 90,
  }));
}

/** A handful of German overrides (PLAN §3 i18n labels object) demonstrating `labels` deep-merge; every key left out falls back to the English default. */
const GERMAN_LABELS: DeepPartialLabels = {
  toolbar: {
    searchPlaceholder: "Suchen…",
    filter: "Filter",
    addFilter: "Filter hinzufügen",
    clearFilters: "Alle löschen",
    noFiltersApplied: "Keine Filter angewendet",
    filterValuePlaceholder: "Wert…",
    filterValueTrue: "wahr",
    filterValueFalse: "falsch",
    filterWhere: "Wobei",
    joinOperatorAriaLabel: "Verknüpfung",
    joinOperatorAnd: "Und",
    joinOperatorOr: "Oder",
    reorderFilterAriaLabel: "Filter verschieben",
    filterReorderAnnouncement: (column, position, total) => `${column}-Filter an Position ${position} von ${total} verschoben`,
    columns: "Spalten",
  },
  sort: {
    sort: "Sortieren",
    addSort: "Sortierung hinzufügen",
    clearSorts: "Alle löschen",
    noSortsApplied: "Keine Sortierung angewendet",
    ascending: "Aufsteigend",
    descending: "Absteigend",
    reorderSortAriaLabel: "Sortierung verschieben",
    sortReorderAnnouncement: (column, position, total) => `${column}-Sortierung an Position ${position} von ${total} verschoben`,
  },
  filterOperators: {
    contains: "Enthält",
    notContains: "Enthält nicht",
    equals: "Gleich",
    notEquals: "Ungleich",
    startsWith: "Beginnt mit",
    endsWith: "Endet mit",
    empty: "Ist leer",
    notEmpty: "Ist nicht leer",
    gt: "Größer als",
    gte: "Größer oder gleich",
    lt: "Kleiner als",
    lte: "Kleiner oder gleich",
  },
  contextMenu: {
    cut: "Ausschneiden",
    copy: "Kopieren",
    paste: "Einfügen",
    clearContents: "Inhalt löschen",
    deleteRows: (count) => (count > 1 ? "Zeilen löschen" : "Zeile löschen"),
  },
  keybindings: {
    title: "Tastenkombinationen",
    description: "Alle in diesem Raster aktiven Tastenkombinationen.",
  },
};

const ROW_OPTIONS = [1_000, 10_000, 100_000, 1_000_000] as const;
const COL_OPTIONS = [8, 50, 100, 200] as const;
const ROW_MARKERS_OPTIONS: readonly RowMarkersMode[] = ["none", "number", "checkbox", "both"];
const DENSITY_OPTIONS: readonly DensityMode[] = ["compact", "default", "comfortable"];
const HEADER_CLICK_BEHAVIOR_OPTIONS: readonly HeaderClickBehavior[] = ["select", "sort", "none"];

/** Monotonic counter so inserted rows get ids that never collide with the seeded dataset or each other. */
let nextInsertedRowId = 0;
/** Monotonic counter so duplicated rows get a distinct id from their source (store requires this — see store.tsx `duplicateRow`). */
let nextDuplicatedRowId = 0;
/** Monotonic counter so imported rows get ids that never collide with the current dataset. */
let nextImportedRowId = 0;

type DevGridProps = {
  rowCount: number;
  colCount: number;
  rowMarkers: RowMarkersMode;
  density: DensityMode;
  headerClickBehavior: HeaderClickBehavior;
  germanLabels: boolean;
  loading: boolean;
  keybindingsOpen: boolean;
  setKeybindingsOpen: (open: boolean) => void;
};

/**
 * Owns `useDataGridState` and the whole `DataGridProvider` subtree. Split out from `DevPage` (and
 * mounted with `key={rowCount}`, see below) so a row-count change forces a clean remount instead of
 * `useDataGridState` trying to notice the new `rows` array on its own: that hook only seeds `data`
 * from its argument once, at mount (by design — reacting to identity changes there would infinite-
 * loop for any caller that doesn't memoize its rows array, a very natural way to call this hook). A
 * `key` change is the standard React idiom for "start over with a fresh dataset."
 */
function DevGrid({
  rowCount,
  colCount,
  rowMarkers,
  density,
  headerClickBehavior,
  germanLabels,
  loading,
  keybindingsOpen,
  setKeybindingsOpen,
}: DevGridProps): ReactNode {
  const rows = useMemo(() => generateRows(rowCount), [rowCount]);
  const grid = useDataGridState(rows, { getRowId: (row) => row.id });
  const columns = useMemo(
    () =>
      [
        ...baseColumns,
        ...makeExtraColumns(Math.max(0, colCount - baseColumns.length)),
      ] as readonly ColumnDef<Row, unknown>[],
    [colCount],
  );

  /** Replaces the grid data through the existing onDataChange setter path (delete-all + insert-all, one `import` batch). */
  const onImport = (importedRows: Row[]) => {
    const { data } = grid;
    grid.onDataChange(importedRows, {
      source: "import",
      ops: [
        ...data.map((row, index) => ({ type: "delete" as const, rowId: row.id, row, index })),
        ...importedRows.map((row, index) => ({ type: "insert" as const, rowId: row.id, row, index })),
      ],
    });
  };

  return (
    <>
      <p className="mt-1 text-sm text-muted-foreground">
        {rows.length.toLocaleString()} rows × {columns.length} columns
      </p>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider
          {...grid}
          columns={columns}
          rowMarkers={rowMarkers}
          headerClickBehavior={headerClickBehavior}
          labels={germanLabels ? GERMAN_LABELS : undefined}
          createRow={(): Row => ({
            id: `inserted-${nextInsertedRowId++}`,
            n: 0,
            name: "New row",
            email: "",
            age: 18,
            active: false,
            role: "User",
            joined: "",
            score: 0,
          })}
          duplicateRow={(row: Row): Row => ({ ...row, id: `${row.id}-copy-${nextDuplicatedRowId++}` })}
        >
          <DataGridKeybindingsDialog open={keybindingsOpen} onOpenChange={setKeybindingsOpen} />
          <DataGridToolbar>
            <DataGridSearch />
            <DataGridFilterMenu />
            <DataGridSortList />
            <DataGridColumnsMenu />
            <DataGridImportButton
              createRow={(index): Row => ({
                id: `imported-${nextImportedRowId++}`,
                n: index,
                name: "",
                email: "",
                age: 18,
                active: false,
                role: "User",
                joined: "",
                score: 0,
              })}
              onImport={onImport}
            />
            <DataGridExportButton />
          </DataGridToolbar>
          <DataGridContextMenu className="flex min-h-0 flex-1 flex-col">
            <DataGridRoot
              className="min-h-0 flex-1 rounded-none border-none"
              density={density}
              loading={loading}
              renderHeaderMenu={(ctx) => <DataGridHeaderDropdown {...ctx} />}
            >
              <DataGridKeybindingsShortcut onOpen={() => setKeybindingsOpen(true)} />
              <DataGridHeader />
              <DataGridBody />
            </DataGridRoot>
          </DataGridContextMenu>
        </DataGridProvider>
      </div>
    </>
  );
}

export default function DevPage(): ReactNode {
  const [rowCount, setRowCount] = useState<number>(100_000);
  const [colCount, setColCount] = useState<number>(8);
  const [rowMarkers, setRowMarkers] = useState<RowMarkersMode>("none");
  const [density, setDensity] = useState<DensityMode>("default");
  const [headerClickBehavior, setHeaderClickBehavior] = useState<HeaderClickBehavior>("select");
  const [keybindingsOpen, setKeybindingsOpen] = useState(false);
  const [germanLabels, setGermanLabels] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // ponytail: dev-only render-highlighting; page is a scratchpad, not a docs demo
    import("react-scan")
      .then(({ scan }) => scan({ enabled: true, showToolbar: true }))
      .catch(() => {});
  }, []);

  return (
    <div className="flex h-screen flex-col gap-4 bg-background p-6">
      <div className="flex shrink-0 items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">gridcn dev</h1>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            rows
            <select
              className="rounded-md border border-border bg-background px-2 py-1 text-foreground"
              value={rowCount}
              onChange={(e) => setRowCount(Number(e.target.value))}
            >
              {ROW_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            cols
            <select
              className="rounded-md border border-border bg-background px-2 py-1 text-foreground"
              value={colCount}
              onChange={(e) => setColCount(Number(e.target.value))}
            >
              {COL_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            row markers
            <select
              className="rounded-md border border-border bg-background px-2 py-1 text-foreground"
              value={rowMarkers}
              onChange={(e) => setRowMarkers(e.target.value as RowMarkersMode)}
            >
              {ROW_MARKERS_OPTIONS.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            density
            <select
              className="rounded-md border border-border bg-background px-2 py-1 text-foreground"
              value={density}
              onChange={(e) => setDensity(e.target.value as DensityMode)}
            >
              {DENSITY_OPTIONS.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            header click
            <select
              className="rounded-md border border-border bg-background px-2 py-1 text-foreground"
              value={headerClickBehavior}
              onChange={(e) => setHeaderClickBehavior(e.target.value as HeaderClickBehavior)}
            >
              {HEADER_CLICK_BEHAVIOR_OPTIONS.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>
          <Button variant="outline" size="sm" onClick={() => setKeybindingsOpen(true)}>
            Keyboard shortcuts
          </Button>
          <Button variant={germanLabels ? "default" : "outline"} size="sm" onClick={() => setGermanLabels((v) => !v)}>
            labels: {germanLabels ? "de" : "en"}
          </Button>
          <Button variant={loading ? "default" : "outline"} size="sm" onClick={() => setLoading((v) => !v)}>
            Loading
          </Button>
        </div>
      </div>
      <DevGrid
        key={rowCount}
        rowCount={rowCount}
        colCount={colCount}
        rowMarkers={rowMarkers}
        density={density}
        headerClickBehavior={headerClickBehavior}
        germanLabels={germanLabels}
        loading={loading}
        keybindingsOpen={keybindingsOpen}
        setKeybindingsOpen={setKeybindingsOpen}
      />
    </div>
  );
}
