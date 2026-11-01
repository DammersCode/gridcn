import type { FetchFilterValuesContext, FilterNode, RowRange, ServerSpec, SortSpec } from "./data-grid";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertEqual = <A, B>(_ok: Equal<A, B>) => {};

assertEqual<ServerSpec, { sorts: readonly SortSpec[]; filters: readonly FilterNode[]; searchText: string }>(true);
assertEqual<RowRange, { start: number; end: number }>(true);
assertEqual<FetchFilterValuesContext["query"], string>(true);
// @ts-expect-error - the value-list context field is `query`
void ({} as FetchFilterValuesContext).search;
