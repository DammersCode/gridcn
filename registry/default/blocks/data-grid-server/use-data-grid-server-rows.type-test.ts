import { useDataGridServerRows } from "./use-data-grid-server-rows";

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
