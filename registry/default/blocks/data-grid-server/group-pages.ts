"use client";

import { useDataGridServerPager, type DataGridPaginationControls } from "@/registry/default/blocks/data-grid-pagination/data-grid-pagination";
import { DEFAULT_PAGE_SIZES } from "@/registry/default/blocks/data-grid-pagination/pagination-math";
import { createGroupStore, landGroups, listFor, type GroupStore } from "./group-lists";
import { readGroupsAnswer, type ServerGroupsAnswer } from "./read-groups-answer";

/** Pages mode of the group engine: the top level is one page of groups, and a block of any list holds `pageSize` entries. */
export type GroupPagesConfig = {
  page: number;
  pageSize: number;
  pageSizeOptions?: readonly number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

export const pageWindowOf = (pages: GroupPagesConfig | undefined) => (pages ? { start: (pages.page - 1) * pages.pageSize, end: pages.page * pages.pageSize } : undefined);

export function isGroupsAnswer(answer: unknown): answer is ServerGroupsAnswer {
  return typeof answer === "object" && answer !== null && Array.isArray((answer as { groups?: unknown }).groups);
}

/** A store whose top level holds the `initialAnswer` as block `block`; `null` when the answer is not a usable groups answer. */
export function seedGroupStore<TData>(answer: unknown, groupBy: readonly string[], blockSize: number, block: number, aggregateIds: readonly string[]): GroupStore<TData> | null {
  if (!isGroupsAnswer(answer)) return null;
  try {
    const start = block * blockSize;
    const read = readGroupsAnswer(answer, { start, end: start + blockSize }, { topLevel: true, aggregateIds }, () => {});
    const store = createGroupStore<TData>(groupBy, blockSize);
    landGroups(store, listFor(store, [], null), block, read.groups, read.groupCount, 0);
    if (read.totalRowCount !== undefined) store.leafCount = read.totalRowCount;
    return store;
  } catch {
    return null;
  }
}

/** The pager of a grouped pages source: a page counts top-level groups. Inert (no count) without `pages`. */
export function useGroupPager(pages: GroupPagesConfig | undefined, groupCount: number | null): { pager: DataGridPaginationControls; plugins: ReturnType<typeof useDataGridServerPager>["gridProps"]["plugins"] } {
  const { pager, gridProps } = useDataGridServerPager({
    page: pages?.page ?? 1,
    pageSize: pages?.pageSize ?? 1,
    pageSizeOptions: pages?.pageSizeOptions ?? DEFAULT_PAGE_SIZES,
    totalRowCount: pages ? groupCount : null,
    unit: "groups",
    onPageChange: pages?.onPageChange ?? noop,
    onPageSizeChange: pages?.onPageSizeChange,
  });
  return { pager, plugins: gridProps.plugins };
}

function noop() {}
