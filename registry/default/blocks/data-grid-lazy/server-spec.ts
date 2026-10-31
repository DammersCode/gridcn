import type { FilterNode, SortSpec } from "@/registry/default/blocks/data-grid/data-grid";

/** The sort, filter, and search of a server request, handed to `fetchRows` so a request carries its own spec. */
export type ServerSpec = {
  sorts: readonly SortSpec[];
  filters: readonly FilterNode[];
  search: string;
};

export const EMPTY_SERVER_SPEC: ServerSpec = { sorts: [], filters: [], search: "" };

/** A spec compared by content: the generated `filterId`s change when the same filters are re-created. */
export function serverSpecKey(spec: ServerSpec): string {
  return JSON.stringify(spec, (key, value: unknown) => (key === "filterId" ? undefined : value));
}
