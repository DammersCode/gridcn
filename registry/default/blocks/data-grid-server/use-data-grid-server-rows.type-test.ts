import { useDataGridServerRows, type DataSourceState } from "./use-data-grid-server-rows";

type Row = { id: string };
const getRowId = (row: Row) => row.id;

export function scrollMode() {
  const server = useDataGridServerRows<Row>({
    mode: "scroll",
    getRowId,
    blockSize: 25,
    fetchRows: async ({ start, end, cursor }) => {
      cursor satisfies undefined;
      return { rows: [] as Row[], totalRowCount: end - start };
    },
  });
  server.unloadedCount satisfies number;
  server.evict({ start: 0, end: 1 });
  server.gridProps.onRenderedRowsChange({ start: 0, end: 1 });
  // @ts-expect-error scroll mode has no pager
  void server.pager;
}

export function pagesMode() {
  const server = useDataGridServerRows<Row>({
    getRowId,
    fetchRows: async ({ page, pageSize }) => ({ rows: [] as Row[], totalRowCount: page * pageSize }),
  });
  server.pager.page satisfies number;
  // @ts-expect-error pages mode has no loaded ranges
  void server.getLoadedRanges;
}

export function sequentialScroll() {
  const server = useDataGridServerRows<Row, string>({
    mode: "scroll",
    getRowId,
    fetchRows: async ({ cursor, start, end }) => {
      cursor satisfies string | undefined;
      return { rows: [] as Row[], nextCursor: end - start > 0 ? `after:${start}` : null };
    },
  });
  server.totalRowCount satisfies number | null;
  server.refresh();
  server.gridProps.plugins satisfies readonly unknown[];
}

export function requestState() {
  const pages = useDataGridServerRows<Row>({ getRowId, fetchRows: async () => ({ rows: [] as Row[] }) });
  const scroll = useDataGridServerRows<Row>({ mode: "scroll", getRowId, fetchRows: async () => ({ rows: [] as Row[] }) });
  pages satisfies DataSourceState;
  scroll satisfies DataSourceState;
}

export function cursorPages() {
  const server = useDataGridServerRows<Row, string>({
    getRowId,
    fetchRows: async ({ cursor, page }) => {
      cursor satisfies string | undefined;
      return { rows: [] as Row[], nextCursor: page < 3 ? `page:${page}` : null };
    },
  });
  server.pager.hasMore satisfies boolean;
}

export function defaultRowId() {
  useDataGridServerRows<Row>({ fetchRows: async () => ({ rows: [] as Row[], totalRowCount: 0 }) });
  useDataGridServerRows<Row>({ mode: "scroll", fetchRows: async () => ({ rows: [] as Row[], totalRowCount: 0 }) });
}

export function ownPluginsAndRenderedRows() {
  const pages = useDataGridServerRows<Row>({ getRowId, fetchRows: async () => ({ rows: [] as Row[] }), plugins: [{ name: "mine" }] });
  const scroll = useDataGridServerRows<Row>({ mode: "scroll", getRowId, fetchRows: async () => ({ rows: [] as Row[] }), plugins: [{ name: "mine" }], onRenderedRowsChange: (range) => void range.start });
  pages.gridProps.headerClickBehavior satisfies "sort";
  scroll.gridProps.headerClickBehavior satisfies "sort";
}

export function defaultSpecFunction() {
  useDataGridServerRows<Row>({ getRowId, fetchRows: async () => ({ rows: [] as Row[] }), defaultSpec: () => undefined });
  useDataGridServerRows<Row>({ getRowId, fetchRows: async () => ({ rows: [] as Row[] }), defaultSpec: () => ({ searchText: "a" }) });
}

export function groupedScrollMode() {
  const server = useDataGridServerRows<Row>({
    mode: "scroll",
    getRowId,
    defaultSpec: { groupBy: ["region"] },
    defaultExpanded: { mode: "collapsed", ids: [] },
    fetchRows: async ({ groupPath, childKind }) => {
      groupPath satisfies readonly { columnId: string; key: string | number | boolean | null }[] | undefined;
      if (childKind === "groups") return { groups: [{ key: "a", childCount: 1, totalRowCount: 1 }], groupCount: 1, totalRowCount: 1 };
      return { rows: [] as Row[], totalRowCount: 0 };
    },
  });
  server.gridProps.groupBy satisfies readonly string[] | undefined;
  server.gridProps.groupMode satisfies "server" | undefined;
}

export function groupedPagesMode() {
  const server = useDataGridServerRows<Row>({
    getRowId,
    defaultPageSize: 10,
    defaultSpec: { groupBy: ["region"] },
    defaultExpanded: { mode: "collapsed", ids: [] },
    fetchRows: async ({ page, pageSize, childKind }) => {
      page satisfies number;
      pageSize satisfies number;
      if (childKind === "groups") return { groups: [{ key: "a", childCount: 1, totalRowCount: 1 }], groupCount: 1, totalRowCount: 1 };
      return { rows: [] as Row[], totalRowCount: 0 };
    },
  });
  server.pager.page satisfies number;
}

export function holdOptOut() {
  useDataGridServerRows<Row>({ getRowId, enableHold: false, fetchRows: async () => ({ rows: [] as Row[], totalRowCount: 0 }) });
  useDataGridServerRows<Row>({ mode: "scroll", getRowId, enableHold: false, fetchRows: async () => ({ rows: [] as Row[], totalRowCount: 0 }) });
  // @ts-expect-error enableHold is a boolean
  useDataGridServerRows<Row>({ getRowId, enableHold: "off", fetchRows: async () => ({ rows: [] as Row[], totalRowCount: 0 }) });
}
