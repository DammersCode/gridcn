import { createDataGridHooks } from "./data-grid";

type Order = { id: string; total: number };

export const { useDataGridApi, useDataGridRow, useDataGridVisibleColumns, useDataGridAllColumns, useDataGridSelector } = createDataGridHooks<Order>();

export function useTypedReads() {
  const row = useDataGridRow(0);
  const total: number | undefined = row?.total;
  // @ts-expect-error -- the row type comes from the factory
  row?.name;
  const columns = useDataGridVisibleColumns();
  const all = useDataGridAllColumns();
  const ids = useDataGridSelector((state) => state.data.map((order) => order.id));
  const idList: string[] = ids;
  const api = useDataGridApi();
  const first: Order | undefined = api.getRow(0);
  return { total, columns, all, idList, first };
}
