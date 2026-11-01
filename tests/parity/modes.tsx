import { act, render } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import type { ColumnDef, DataChange, FilterNode, SortSpec } from "@/registry/default/blocks/data-grid/types";
import type { WriteAck } from "@/registry/default/blocks/data-grid/store/write-ack";
import { useDataGridPagination } from "@/registry/default/blocks/data-grid-pagination/use-data-grid-pagination";
import { useDataGridLazyRows } from "@/registry/default/blocks/data-grid-lazy/use-data-grid-lazy-rows";

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
  /** Extra provider props; they win over the mode's props. */
  props?: Record<string, unknown>;
  /** The writes an `onSave` of the `API` mode answers; default accepts everything. */
  saveAnswer?: (change: DataChange<Row>) => Promise<WriteAck<Row>> | WriteAck<Row>;
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

  function Probe(): ReactNode {
    api = useDataGridStoreApi();
    return null;
  }

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
        {...options.props}
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
            {...options.props}
          >
            <Probe />
          </DataGridProvider>
        );
      case "PC":
        return <PagedClient all={all} extra={options.props} record={record} />;
      case "PS":
        return <Controlled window={all.slice(0, PAGE)} extra={{ totalRowCount: all.length }} />;
      case "Z":
        return <Lazy all={all} extra={options.props} record={record} />;
      case "C":
        return (
          <Controlled
            window={all}
            extra={{
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
        return <Controlled window={all} extra={{ sortMode: "server", sortState: sorts, onSortChange: setSorts }} />;
      case "FS":
        return <Controlled window={all} extra={{ filterMode: "server", filterState: filters, onFilterChange: setFilters }} />;
      case "API":
        return (
          <Controlled
            window={all}
            extra={{
              onSave: async (change: DataChange<Row>) => {
                saves.push(change);
                return options.saveAnswer ? options.saveAnswer(change) : undefined;
              },
            }}
          />
        );
    }
  }

  function PagedClient({ all: rows, extra, record: rec }: { all: Row[]; extra?: Record<string, unknown>; record: typeof record }) {
    const [full, setFull] = useState<readonly Row[]>(rows);
    const pager = useDataGridPagination({ data: full, pageSize: PAGE });
    const page = pager.pageData ?? [];
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
          setFull((prev) => [...next, ...prev.slice(PAGE)]);
        }}
        {...extra}
      >
        <Probe />
      </DataGridProvider>
    );
  }

  function Lazy({ all: rows, extra, record: rec }: { all: Row[]; extra?: Record<string, unknown>; record: typeof record }) {
    const lazy = useDataGridLazyRows<Row>({
      total: rows.length,
      getRowId,
      pageSize: rows.length,
      fetchRows: async ({ start, end }) => rows.slice(start, end),
    });
    loadRows = (start, end) => lazy.gridProps.onRenderedRowsChange({ start, end });
    held = lazy.gridProps.data as readonly Row[];
    return (
      <DataGridProvider
        columns={columns}
        {...lazy.gridProps}
        {...baseProps}
        onDataChange={(next: readonly Row[], change: DataChange<Row>) => {
          rec(next, change);
          lazy.onDataChange(next, change);
        }}
        {...extra}
      >
        <Probe />
      </DataGridProvider>
    );
  }

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
    load: async (start, end) => {
      if (mode !== "Z") return;
      act(() => loadRows(start, end));
      await settle();
    },
  };
  if (mode === "Z") await mounted.load(0, all.length);
  return mounted;
}
