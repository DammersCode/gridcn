"use client";

import { createContext, use, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEFAULT_LABELS, type DataGridPaginationLabels } from "@/registry/default/blocks/data-grid/data-grid";
import type { DataGridPaginationControls } from "./use-data-grid-pagination";
import { useDataGridPager } from "./use-data-grid-pager";
import { DEFAULT_PAGE_SIZES, pageWindow } from "./pagination-math";
import { GRID_ATTR } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** Default window size for {@link DataGridPaginationPages} when its `windowSize` prop is omitted. */
const DEFAULT_PAGE_WINDOW_SIZE = 5;

type PaginationBarContextValue = {
  controls: DataGridPaginationControls;
  labels: DataGridPaginationLabels;
};

const PaginationBarContext = createContext<PaginationBarContextValue | null>(null);

/** Resolves the enclosing bar's context, throwing with a clear message outside {@link DataGridPaginationBar}. */
function usePaginationBarContext(part: string): PaginationBarContextValue {
  const ctx = use(PaginationBarContext);
  if (!ctx) {
    throw new Error(`gridcn: <${part} /> must be used inside a <DataGridPaginationBar>.`);
  }
  return ctx;
}

/** Props for {@link DataGridPaginationBar}. */
type BarControls = Omit<DataGridPaginationControls, "pageSizeOptions">;

export type DataGridPaginationBarProps = (BarControls | { [K in keyof BarControls]?: never }) & {
  /** Page sizes the select offers. Default: the controls' own list (10, 25, 50, 100 inside a provider). */
  pageSizeOptions?: readonly number[];
  className?: string;
  /**
   * i18n override for this footer's strings, merged key by key over the built-in
   * `labels.pagination` defaults. The grid's own `labels` prop does not reach the footer, also
   * inside a `DataGridProvider`: pass the pagination strings here.
   */
  labels?: Partial<DataGridPaginationLabels>;
  /** How many numbered page buttons the default layout shows at once (forwarded to `DataGridPaginationPages`; ignored with `children`). Default 5. */
  windowSize?: number;
  /** Custom composition of parts; omit to render the default layout (range, page-size, first/prev/pages/next/last). */
  children?: ReactNode;
};

/**
 * Pagination footer bar: provides the shared `DataGridPaginationControls` + merged labels to its
 * children via context, shadcn-`Pagination` style. With no `children` it renders the default
 * layout so the common case stays a one-liner; pass `children` built from the parts below
 * (`DataGridPaginationRange`, `DataGridPaginationPageSize`, `DataGridPaginationFirst`,
 * `DataGridPaginationPrev`, `DataGridPaginationPages`, `DataGridPaginationNext`,
 * `DataGridPaginationLast`) for a custom arrangement.
 *
 * Works identically for every source: spread the `DataGridPaginationControls` of
 * `useDataGridPagination`, `useDataGridServerPager`, `useDataGridPager`, or `useDataGridServerRows`,
 * or pass no controls inside a `DataGridProvider` with `pageSize` to read the grid's own pager.
 */
export function DataGridPaginationBar(props: DataGridPaginationBarProps): ReactNode {
  return props.page === undefined ? <ProviderPaginationBar {...props} /> : <PaginationBarView {...props} controls={{ ...(props as BarControls), pageSizeOptions: props.pageSizeOptions ?? DEFAULT_PAGE_SIZES }} />;
}

/** The bar of a grid that pages its view: the controls come from the enclosing `DataGridProvider`. */
function ProviderPaginationBar(props: DataGridPaginationBarProps): ReactNode {
  const { pager: controls } = useDataGridPager(props.pageSizeOptions ? { pageSizeOptions: props.pageSizeOptions } : {});
  return <PaginationBarView {...props} controls={controls} />;
}

function PaginationBarView(props: DataGridPaginationBarProps & { controls: DataGridPaginationControls }): ReactNode {
  const { controls, className, labels: labelsOverride, windowSize, children } = props;
  const labels = { ...DEFAULT_LABELS.pagination, ...labelsOverride };

  return (
    <PaginationBarContext value={{ controls, labels }}>
      <div {...{ [GRID_ATTR.pagination]: "" }} className={cn("flex flex-wrap items-center justify-between gap-2 border-t border-border bg-background px-2 py-1.5", className)}>
        {children ?? (
          <>
            <DataGridPaginationRange />
            <div className="flex flex-wrap items-center gap-3">
              <DataGridPaginationPageSize />
              <div className="flex items-center gap-1">
                <DataGridPaginationFirst />
                <DataGridPaginationPrev />
                <DataGridPaginationPages windowSize={windowSize} />
                <DataGridPaginationNext />
                <DataGridPaginationLast />
              </div>
            </div>
          </>
        )}
      </div>
    </PaginationBarContext>
  );
}

/** The "x–y of z" range label, {@link DataGridPaginationLabels.rangeEmpty} when `totalRowCount` is 0, or {@link DataGridPaginationLabels.rangeUnknown} ("Page 3") when `totalRowCount` is `null`. */
export function DataGridPaginationRange(): ReactNode {
  const { controls, labels } = usePaginationBarContext("DataGridPaginationRange");
  const { page, pageSize, totalRowCount } = controls;
  if (totalRowCount === null) return <span className="text-xs tabular-nums text-muted-foreground">{labels.rangeUnknown(page)}</span>;
  const from = totalRowCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalRowCount);

  return <span className="text-xs tabular-nums text-muted-foreground">{totalRowCount === 0 ? labels.rangeEmpty : labels.range(from, to, totalRowCount)}</span>;
}

/** The rows-per-page `Select`. */
export function DataGridPaginationPageSize(): ReactNode {
  const { controls, labels } = usePaginationBarContext("DataGridPaginationPageSize");
  const { pageSize, pageSizeOptions, onPageSizeChange } = controls;
  if (pageSizeOptions.length === 0) return null;

  return (
    <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
      <SelectTrigger className="h-8 w-fit" aria-label={labels.pageSizeAriaLabel}>
        {/* explicit label lookup: SelectValue only resolves a mounted SelectItem's label, which the popup content isn't until first opened. */}
        <SelectValue>{(value: string) => labels.pageSizeOption(Number(value))}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {pageSizeOptions.map((size) => (
          <SelectItem key={size} value={String(size)}>
            {labels.pageSizeOption(size)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Jump to page 1; disabled on page 1. */
export function DataGridPaginationFirst(): ReactNode {
  const { controls, labels } = usePaginationBarContext("DataGridPaginationFirst");
  const { page, onPageChange } = controls;

  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.firstPage} disabled={page <= 1} onClick={() => onPageChange(1)}>
      <ChevronsLeft className="rtl:rotate-180" />
    </Button>
  );
}

/** Page − 1; disabled on page 1. */
export function DataGridPaginationPrev(): ReactNode {
  const { controls, labels } = usePaginationBarContext("DataGridPaginationPrev");
  const { page, onPageChange } = controls;

  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.previousPage} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
      <ChevronLeft className="rtl:rotate-180" />
    </Button>
  );
}

/** Props for {@link DataGridPaginationPages}. */
export type DataGridPaginationPagesProps = {
  /** How many numbered page buttons to show at once (see {@link pageWindow}). Default 5. */
  windowSize?: number;
};

/** The sliding numbered page buttons — the only source of page numbers in the composable layout. */
export function DataGridPaginationPages(props: DataGridPaginationPagesProps): ReactNode {
  const { windowSize = DEFAULT_PAGE_WINDOW_SIZE } = props;
  const { controls, labels } = usePaginationBarContext("DataGridPaginationPages");
  const { page, pageCount, onPageChange } = controls;
  const pages = pageWindow(page, pageCount, windowSize);

  return (
    <>
      {pages.map((p) => (
        <Button
          key={p}
          type="button"
          variant={p === page ? "default" : "ghost"}
          size="icon-sm"
          aria-label={labels.pageAriaLabel(p)}
          aria-current={p === page ? "page" : undefined}
          onClick={() => onPageChange(p)}
        >
          {p}
        </Button>
      ))}
    </>
  );
}

/** Page + 1; disabled when no next page exists. */
export function DataGridPaginationNext(): ReactNode {
  const { controls, labels } = usePaginationBarContext("DataGridPaginationNext");
  const { page, hasMore, onPageChange } = controls;

  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.nextPage} disabled={!hasMore} onClick={() => onPageChange(page + 1)}>
      <ChevronRight className="rtl:rotate-180" />
    </Button>
  );
}

/** Jump to the last page; disabled on the last page and while the count is unknown. */
export function DataGridPaginationLast(): ReactNode {
  const { controls, labels } = usePaginationBarContext("DataGridPaginationLast");
  const { page, pageCount, onPageChange } = controls;

  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.lastPage} disabled={controls.totalRowCount === null || page >= pageCount} onClick={() => onPageChange(pageCount)}>
      <ChevronsRight className="rtl:rotate-180" />
    </Button>
  );
}
