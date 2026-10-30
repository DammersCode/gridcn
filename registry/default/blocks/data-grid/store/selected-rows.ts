import type { DataGridStoreState } from "./types";

/** The selection as a value a bulk action sends to a server. */
export type DataGridSelectedRows =
  | {
      mode: "ids";
      /** Row ids of the checked loaded rows and the remembered ones. Unloaded rows have no id and are left out. */
      ids: readonly string[];
      excludedIds: readonly [];
      count: number;
    }
  | {
      mode: "allMatching";
      ids: readonly [];
      /** Every row of the result is selected except these: the remembered exclusions and the unchecked loaded rows. */
      excludedIds: readonly string[];
      /** `totalRowCount` minus the exclusions; `undefined` when the size of the result is unknown. */
      count: number | undefined;
    };

type Source = Pick<DataGridStoreState, "selection" | "hiddenCheckedRowIds" | "allMatching" | "data" | "viewIndex" | "getRowId" | "totalRowCount">;

/** Reads the checked rows as ids, or as "all matching except these ids". */
export function readSelectedRows(s: Source): DataGridSelectedRows {
  const { rows } = s.selection;
  if (!s.allMatching) {
    const ids: string[] = [];
    for (const viewRow of rows.toArray()) {
      const dataRow = s.viewIndex[viewRow];
      const record = dataRow === undefined ? undefined : s.data[dataRow];
      if (dataRow !== undefined && record !== undefined) ids.push(s.getRowId(record, dataRow));
    }
    for (const id of s.hiddenCheckedRowIds) ids.push(id);
    return { mode: "ids", ids, excludedIds: [], count: ids.length };
  }
  const excluded = new Set(s.hiddenCheckedRowIds);
  for (let viewRow = 0; viewRow < s.viewIndex.length; viewRow++) {
    const dataRow = s.viewIndex[viewRow]!;
    const record = s.data[dataRow];
    if (record === undefined) continue;
    const id = s.getRowId(record, dataRow);
    if (rows.hasIndex(viewRow)) excluded.delete(id);
    else excluded.add(id);
  }
  const total = s.totalRowCount;
  return { mode: "allMatching", ids: [], excludedIds: [...excluded], count: typeof total === "number" ? Math.max(0, total - excluded.size) : undefined };
}
