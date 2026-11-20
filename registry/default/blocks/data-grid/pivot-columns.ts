import type { GroupKey, ServerPivotLayout } from "./group-types";
import type { ServerAggregate } from "./server-spec";
import { groupKeyText } from "./store/group-state";
import type { ColumnDef, ColumnGroupDef } from "./types";

/** Most generated columns a pivot grid holds. */
export const MAX_PIVOT_COLUMNS = 200;

const encode = (text: string): string => {
  try {
    return encodeURIComponent(text);
  } catch {
    throw new TypeError(`the pivot text ${JSON.stringify(text.slice(0, 40))} is not well-formed`);
  }
};

const keySegment = (pivotColumnId: string, key: GroupKey) => `${encode(pivotColumnId)}=${encode(groupKeyText(key))}`;

/** The generated column id of one key and one value. Throws a `TypeError` when a text holds a lone surrogate. */
export function pivotColumnId(pivotColumnId: string, key: GroupKey, value: ServerAggregate): string {
  return `__pivot:${keySegment(pivotColumnId, key)}|${encode(value.columnId)}=${value.reducer}`;
}

/** The header group id of one key. */
export function pivotGroupId(pivotColumnId: string, key: GroupKey): string {
  return `__pivotgroup:${keySegment(pivotColumnId, key)}`;
}

/** A generated column: `pivotIndex` indexes the held columns and the slot's `pivotCells`. */
export type PivotColumnDef<TData> = ColumnDef<TData> & { readonly pivotIndex: number };

export type PivotHeaderLabels = {
  /** Header of the empty key. */
  empty: string;
  /** Header of one value, such as "Sum of Amount". */
  value: (reducer: ServerAggregate["reducer"], column: string) => string;
};

const headerTextOf = <TData>(column: ColumnDef<TData> | undefined, id: string) => column?.headerText ?? (typeof column?.header === "string" ? column.header : id);

/**
 * The generated columns of a held set, in held order, at most {@link MAX_PIVOT_COLUMNS}. Pure: equal inputs give equal output,
 * so a caller memoizes it on the held set. With 2 or more values, `groups` holds one `__pivotgroup:` header group per key.
 */
export function buildPivotColumns<TData>(pivot: ServerPivotLayout, sourceColumns: readonly ColumnDef<TData>[], labels: PivotHeaderLabels): { columns: PivotColumnDef<TData>[]; groups: ColumnGroupDef[] } {
  const byId = new Map(sourceColumns.map((column) => [column.id, column]));
  const grouped = pivot.values.length > 1;
  const groups = new Map<string, ColumnGroupDef & { children: string[] }>();
  const columns = pivot.columns.slice(0, MAX_PIVOT_COLUMNS).map((descriptor, pivotIndex): PivotColumnDef<TData> => {
    const key = descriptor.path[0] ?? null;
    const value = pivot.values[descriptor.valueIndex]!;
    const source = byId.get(value.columnId);
    const keyText = groupKeyText(key);
    const keyLabel = keyText === "" ? labels.empty : keyText;
    const header = grouped ? labels.value(value.reducer, headerTextOf(source, value.columnId)) : keyLabel;
    const id = pivotColumnId(pivot.columnId, key, value);
    if (grouped) {
      const groupId = pivotGroupId(pivot.columnId, key);
      const group = groups.get(groupId);
      if (group) group.children.push(id);
      else groups.set(groupId, { id: groupId, header: keyLabel, headerText: keyLabel, children: [id] });
    }
    const type = value.reducer === "count" ? "number" : source?.type;
    const options = value.reducer === "count" ? undefined : source?.options;
    return {
      id,
      header,
      headerText: header,
      ...(type === undefined ? null : { type }),
      ...(options === undefined ? null : { options }),
      readOnly: true,
      sortable: false,
      filterable: false,
      reorderable: false,
      pinnable: false,
      groupable: false,
      aggregate: value.reducer,
      pivotIndex,
    };
  });
  return { columns, groups: [...groups.values()] };
}
