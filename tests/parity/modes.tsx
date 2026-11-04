import { act, render } from "@testing-library/react";
import { useState, type ComponentType, type ReactNode } from "react";
import type { StoreApi } from "zustand/vanilla";
import { DataGridRoot } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import type { ColumnDef, DataChange, FilterNode, SortSpec } from "@/registry/default/blocks/data-grid/types";
import type { SaveAck } from "@/registry/default/blocks/data-grid/store/write-ack";
import { useDataGridPagination } from "@/registry/default/blocks/data-grid-pagination/use-data-grid-pagination";
import { useDataGridServerRows } from "@/registry/default/blocks/data-grid-server/data-grid-server";

export type ModeId = "L" | "PC" | "PS" | "Z" | "C" | "SS" | "FS" | "API";
export const ALL_MODES: readonly ModeId[] = ["L", "PC", "PS", "Z", "C", "SS", "FS", "API"];

export type Row = { id: string; name: string; n: number };

export const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "n", header: "N", accessorKey: "n", type: "number" },
];

export const makeRows = (count = 6): Row[] => Array.from({ length: count }, (_, i) => ({ id: `r${i}`, name: `Name ${i}`, n: i }));

export type MountOptions = {
  rows?: Row[];
  /** Extra provider props; the mode's own wiring (sort, filter, search state, onSave) wins over them where it sets the same key. */
  props?: Record<string, unknown>;
  /** Called once in the tree root; its result spreads onto the provider (plugins, hooks that feed props). */
  /** A component rendered inside the grid, for hooks that need the provider. */
  Child?: ComponentType;
  /** Props of the `DataGridRoot`. */
  rootProps?: Record<string, unknown>;
  /** Rows the lazy mode loads at mount; default every row. */
  initialLoad?: number;
  useExtra?: () => Record<string, unknown>;
  /** The writes an `onSave` of the `API` mode answers; default accepts everything. */
  saveAnswer?: (change: DataChange<Row>) => Promise<SaveAck<Row>> | SaveAck<Row>;
};

export type Mounted = {
  mode: ModeId;
  store: () => StoreApi<DataGridStoreState>;
  state: () => DataGridStoreState;
  /** Row ids in view order. */
  viewIds: () => string[];
  dataIds: () => string[];
  /** Every `onDataChange` change, in order. */
  changes: DataChange<Row>[];
  saves: DataChange<Row>[];
  /** The page or window the mode shows, as the consumer holds it. */
  held: () => readonly Row[];
  act: (fn: () => void) => void;
  settle: () => Promise<void>;
  setSorts: (sorts: SortSpec[]) => void;
  setFilters: (filters: FilterNode[]) => void;
  /** The value of a cell by row id, from the store data. */
  cell: (rowId: string, columnId: string) => unknown;
  /** Replaces the rows a controlled mode holds, as a server answer with a new page or order would. */
  replaceData: (rows: readonly Row[]) => void;
  /** Merges provider props after mount, the way a parent re-render does. */
  setProps: (next: Record<string, unknown>) => void;
  /** Moves the pager of the client-pagination mode to a 1-based page. */
  goToPage: (page: number) => void;
  /** Requests the rows `start` to `end` of a lazy mode; a no-op elsewhere. */
  load: (start: number, end: number) => Promise<void>;
};

const PAGE = 4;

/** Mounts one grid in a data mode and returns handles that every mode shares. */
export async function mountMode(mode: ModeId, options: MountOptions = {}): Promise<Mounted> {
  const all = options.rows ?? makeRows();
  const changes: DataChange<Row>[] = [];
  const saves: DataChange<Row>[] = [];
  let api: StoreApi<DataGridStoreState> | null = null;
  let held: readonly Row[] = all;
  let loadRows: (start: number, end: number) => void = () => {};

  function Capture(): ReactNode {
    api = useDataGridStoreApi();
    return null;
  }
  const Probe = () => (
    <DataGridRoot {...options.rootProps}>
      <Capture />
      {options.Child ? <options.Child /> : null}
    </DataGridRoot>
  );

  const getRowId = (row: Row) => row.id;
  let created = 0;
  const baseProps = {
    createRow: () => ({ id: `new${created++}`, name: "New", n: 0 }),
    duplicateRow: (row: Row) => ({ ...row, id: `${row.id}-copy` }),
  };
  const record = (next: readonly Row[], change: DataChange<Row>) => {
    changes.push(change);
    held = next;
  };

  function Controlled({ children, extra, window: windowRows }: { children?: ReactNode; extra?: Record<string, unknown>; window: readonly Row[] }) {
    const [data, setData] = useState<readonly Row[]>(windowRows);
    held = data;
    dataReplacer = setData;
    return (
      <DataGridProvider
        columns={columns}
        getRowId={getRowId}
        {...baseProps}
        data={data}
        onDataChange={(next: readonly Row[], change: DataChange<Row>) => {
          record(next, change);
          setData(next);
        }}
        {...extra}
      >
        <Probe />
        {children}
      </DataGridProvider>
    );
  }

  function Tree(): ReactNode {
    const [sorts, setSorts] = useState<SortSpec[]>([]);
    const [filters, setFilters] = useState<FilterNode[]>([]);
    const [search, setSearch] = useState("");
    const hooked = options.useExtra?.() ?? {};
    const [liveProps, setLiveProps] = useState(options.props);
    propsSetter = (next) => setLiveProps((prev) => ({ ...prev, ...next }));
    const shared = { ...liveProps, ...hooked };
    sortSetter = (next) => setSorts(next);
    filterSetter = (next) => setFilters(next);

    switch (mode) {
      case "L":
        return (
          <DataGridProvider
            columns={columns}
            getRowId={getRowId}
        {...baseProps}
            defaultData={all}
            onDataChange={(next: readonly Row[], change: DataChange<Row>) => record(next, change)}
            {...shared}
          >
            <Probe />
          </DataGridProvider>
        );
      case "PC":
        return <PagedClient all={all} extra={shared} record={record} />;
      case "PS":
        return <Controlled window={all.slice(0, PAGE)} extra={{ totalRowCount: all.length, ...shared }} />;
      case "Z":
        return <Lazy all={all} extra={shared} record={record} />;
      case "C":
        return (
          <Controlled
            window={all}
            extra={{
              ...shared,
              sortState: sorts,
              onSortChange: setSorts,
              filterState: filters,
              onFilterChange: setFilters,
              searchText: search,
              onSearchTextChange: setSearch,
            }}
          />
        );
      case "SS":
        return <Controlled window={all} extra={{ ...shared, sortMode: "server", sortState: sorts, onSortChange: setSorts }} />;
      case "FS":
        return <Controlled window={all} extra={{ ...shared, filterMode: "server", filterState: filters, onFilterChange: setFilters }} />;
      case "API":
        return (
          <Controlled
            window={all}
            extra={{
              ...shared,
              onSave:
                shared["onSave"] ??
                (async (change: DataChange<Row>) => {
                  saves.push(change);
                  return options.saveAnswer ? options.saveAnswer(change) : undefined;
                }),
            }}
          />
        );
    }
  }

  function PagedClient({ all: rows, extra, record: rec }: { all: Row[]; extra?: Record<string, unknown>; record: typeof record }) {
    const [full, setFull] = useState<readonly Row[]>(rows);
    const { pageData, pager } = useDataGridPagination({ data: full, defaultPageSize: PAGE });
    pageSetter = pager.onPageChange;
    const offset = (pager.page - 1) * PAGE;
    const page = pageData ?? [];
    held = page;
    return (
      <DataGridProvider
        columns={columns}
        getRowId={getRowId}
        {...baseProps}
        data={page}
        totalRowCount={full.length}
        onDataChange={(next: readonly Row[], change: DataChange<Row>) => {
          rec(next, change);
          setFull((prev) => [...prev.slice(0, offset), ...next, ...prev.slice(offset + PAGE)]);
        }}
        {...extra}
      >
        <Probe />
      </DataGridProvider>
    );
  }

  function Lazy({ all: rows, extra, record: rec }: { all: Row[]; extra?: Record<string, unknown>; record: typeof record }) {
    const [served, setServed] = useState<readonly Row[]>(rows);
    const server = useDataGridServerRows<Row>({
      mode: "scroll",
      getRowId,
      blockSize: options.initialLoad ?? rows.length,
      overscan: 0,
      fetchRows: async ({ start, end }) => ({ rows: served.slice(start, end), totalRowCount: served.length }),
    });
    const { data, onRenderedRowsChange, totalRowCount } = server.providerProps;
    loadRows = (start, end) => onRenderedRowsChange({ start, end });
    held = data as readonly Row[];
    return (
      <DataGridProvider
        columns={columns}
        data={data}
        getRowId={server.providerProps.getRowId}
        onRenderedRowsChange={onRenderedRowsChange}
        totalRowCount={totalRowCount}
        {...baseProps}
        onDataChange={(next: readonly Row[], change: DataChange<Row>) => {
          rec(next, change);
          const deleted = new Set(change.ops.flatMap((op) => (op.type === "delete" ? [op.rowId] : [])));
          if (deleted.size) setServed((current) => current.filter((row) => !deleted.has(getRowId(row))));
          server.providerProps.onDataChange(next, change);
        }}
        {...extra}
      >
        <Probe />
      </DataGridProvider>
    );
  }

  let dataReplacer: (rows: readonly Row[]) => void = () => {};
  let propsSetter: (next: Record<string, unknown>) => void = () => {};
  let pageSetter: (page: number) => void = () => {};
  let sortSetter: (next: SortSpec[]) => void = () => {};
  let filterSetter: (next: FilterNode[]) => void = () => {};

  render(<Tree />);

  const settle = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  const mounted: Mounted = {
    mode,
    store: () => api!,
    state: () => api!.getState(),
    viewIds: () => {
      const s = api!.getState();
      return s.viewIndex.map((dataIndex) => {
        const row = s.data[dataIndex] as Row | undefined;
        return row ? row.id : "";
      });
    },
    dataIds: () => api!.getState().data.map((row) => (row as Row | undefined)?.id ?? ""),
    changes,
    saves,
    held: () => held,
    act: (fn) => act(fn),
    settle,
    setSorts: (sorts) => {
      if (mode === "C" || mode === "SS") act(() => sortSetter(sorts));
      else act(() => api!.getState().actions.setSorts(sorts));
    },
    setFilters: (filters) => {
      if (mode === "C" || mode === "FS") act(() => filterSetter(filters));
      else act(() => api!.getState().actions.setFilters(filters));
    },
    cell: (rowId, columnId) => {
      const row = (api!.getState().data as readonly (Row | undefined)[]).find((r) => r?.id === rowId);
      return row ? row[columnId as keyof Row] : undefined;
    },
    replaceData: (rows) => act(() => dataReplacer(rows)),
    setProps: (next) => act(() => propsSetter(next)),
    goToPage: (page) => act(() => pageSetter(page)),
    load: async (start, end) => {
      if (mode !== "Z") return;
      act(() => loadRows(start, end));
      await settle();
    },
  };
  if (mode === "Z") await mounted.load(0, options.initialLoad ?? all.length);
  return mounted;
}
