import { createDataGridHooks, useDataGridViewIndex } from "./data-grid";

type Order = { id: string; total: number };

export const { useDataGridApi, useDataGridRow, useDataGridVisibleColumns, useDataGridAllColumns, useDataGridSelector } = createDataGridHooks<Order>();

export function useTypedReads() {
  const row = useDataGridRow(0);
  const total: number | undefined = row?.total;
  // @ts-expect-error -- the row type comes from the factory
  const missing: unknown = row?.name;
  const columns = useDataGridVisibleColumns();
  const all = useDataGridAllColumns();
  const ids = useDataGridSelector((state) => state.data.map((order) => order.id));
  const idList: string[] = ids;
  const api = useDataGridApi();
  const first: Order | undefined = api.getRow(0);
  return { total, missing, columns, all, idList, first };
}
export function usePublicStateOnly() {
  const sortState = useDataGridSelector((state) => state.sortState);
  const internalKeys = useDataGridSelector((state) => {
    // @ts-expect-error -- engine-internal fields are not part of the selector state
    const dataWrite: unknown = state.dataWrite;
    // @ts-expect-error -- engine-internal fields are not part of the selector state
    const pointer: unknown = state.selectionPointer;
    return [dataWrite, pointer];
  });
  return { sortState, internalKeys };
}

export function useReadonlyViewIndex() {
  const viewIndex: readonly number[] = useDataGridViewIndex();
  // @ts-expect-error -- the view index is read-only
  const mutable: number[] = useDataGridViewIndex();
  return { viewIndex, mutable };
}
