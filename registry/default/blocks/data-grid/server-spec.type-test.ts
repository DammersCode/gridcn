import type { FetchFilterValuesContext, FilterNode, RowRange, ServerSpec, SortSpec } from "./data-grid";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertEqual = <A, B>(_ok: Equal<A, B>) => {};

assertEqual<ServerSpec, { sorts: readonly SortSpec[]; filters: readonly FilterNode[]; filterJoin?: "or"; searchText: string; groupBy?: readonly string[]; aggregates?: readonly { columnId: string; reducer: "sum" | "avg" | "min" | "max" | "count" }[]; pivot?: { columnIds: readonly string[] } }>(true);
const _specOfToday: ServerSpec = { sorts: [], filters: [], searchText: "" };
void _specOfToday;
assertEqual<RowRange, { start: number; end: number }>(true);
assertEqual<FetchFilterValuesContext["query"], string>(true);
// @ts-expect-error - the value-list context field is `query`
void ({} as FetchFilterValuesContext).search;

const _negatedGroupOfToday: ServerSpec = { sorts: [], filters: [{ join: "and", filters: [] }, { join: "or", not: true, filters: [] }], searchText: "" };
void _negatedGroupOfToday;
