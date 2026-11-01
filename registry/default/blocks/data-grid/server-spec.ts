import type { FilterNode, SortSpec } from "./types";

/** A half-open row range: `start` is included, `end` is excluded. */
export type RowRange = { start: number; end: number };

/** The sort, filter, and quick-search text of a server request, handed to `fetchRows` so a request carries its own spec. */
export type ServerSpec = {
  sorts: readonly SortSpec[];
  filters: readonly FilterNode[];
  searchText: string;
};

export const EMPTY_SERVER_SPEC: ServerSpec = { sorts: [], filters: [], searchText: "" };

/** A spec compared by content: the generated `filterId`s change when the same filters are re-created. */
export function serverSpecKey(spec: ServerSpec): string {
  return JSON.stringify(spec, (key, value: unknown) => (key === "filterId" ? undefined : value));
}
