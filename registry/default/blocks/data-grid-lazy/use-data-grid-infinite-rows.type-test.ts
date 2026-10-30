import { useDataGridInfiniteRows } from "./use-data-grid-infinite-rows";

type Row = { id: string };

/** Compile-only: `fetchRows` and `getRowId` are the only required options, and the cursor type flows into the context. */
export function minimalOptions() {
  return useDataGridInfiniteRows<Row, string>({
    getRowId: (row) => row.id,
    fetchRows: async ({ cursor, start, limit, signal }) => {
      const typed: string | undefined = cursor;
      void [typed, start + limit, signal.aborted];
      return { rows: [] as Row[], nextCursor: null };
    },
  });
}
