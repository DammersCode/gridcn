"use client";

import { createContext, use, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEFAULT_LABELS, GRID_ATTR, type DataGridPaginationLabels } from "@/registry/default/blocks/data-grid/data-grid";
import type { DataGridPaginationControls } from "./use-data-grid-pagination";
import { pageWindow } from "./pagination-math";

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
export type DataGridPaginationBarProps = DataGridPaginationControls & {
  className?: string;
  /**
   * i18n override for this footer's strings, deep-merge semantics like core's `labels` prop
   * (see `deepMergeLabels`). Standalone default since this component renders outside
   * `DataGridProvider` in the spec's usage (`<DataGrid /><DataGridPaginationBar /></>` as siblings)
   * and so has no store to read `useDataGridLabels()` from.
   */
  labels?: Partial<DataGridPaginationLabels>;
  /** How many numbered page buttons the default layout shows at once (forwarded to `DataGridPaginationPages`; ignored with `children`). */
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
 * Works identically for client and server mode — both produce the same
 * `DataGridPaginationControls` shape from `useDataGridPagination`, so this component never knows
 * which mode it's rendering for.
 */
export function DataGridPaginationBar(props: DataGridPaginationBarProps): ReactNode {
  const { page, pageCount, pageSize, pageSizeOptions, total, onPageChange, onPageSizeChange, className, labels: labelsOverride, windowSize, children } = props;
  const controls: DataGridPaginationControls = { page, pageCount, pageSize, pageSizeOptions, total, onPageChange, onPageSizeChange };
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

/** The "x–y of z" range label (or {@link DataGridPaginationLabels.rangeEmpty} when `total` is 0). */
export function DataGridPaginationRange(): ReactNode {
  const { controls, labels } = usePaginationBarContext("DataGridPaginationRange");
  const { page, pageSize, total } = controls;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return <span className="text-xs tabular-nums text-muted-foreground">{total === 0 ? labels.rangeEmpty : labels.range(from, to, total)}</span>;
}

/** The rows-per-page `Select`. */
export function DataGridPaginationPageSize(): ReactNode {
  const { controls, labels } = usePaginationBarContext("DataGridPaginationPageSize");
  const { pageSize, pageSizeOptions, onPageSizeChange } = controls;

  return (
    <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
      <SelectTrigger className="h-8 w-fit" aria-label={labels.pageSizeAriaLabel}>
        <SelectValue />
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
      <ChevronsLeft />
    </Button>
  );
}

/** Page − 1; disabled on page 1. */
export function DataGridPaginationPrev(): ReactNode {
  const { controls, labels } = usePaginationBarContext("DataGridPaginationPrev");
  const { page, onPageChange } = controls;

  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.previousPage} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
      <ChevronLeft />
    </Button>
  );
}

/** Props for {@link DataGridPaginationPages}. */
export type DataGridPaginationPagesProps = {
  /** How many numbered page buttons to show at once (see {@link pageWindow}). */
  windowSize?: number;
};

/** The windowed numbered page buttons — the only source of page numbers in the composable layout. */
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

/** Page + 1; disabled on the last page. */
export function DataGridPaginationNext(): ReactNode {
  const { controls, labels } = usePaginationBarContext("DataGridPaginationNext");
  const { page, pageCount, onPageChange } = controls;

  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.nextPage} disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
      <ChevronRight />
    </Button>
  );
}

/** Jump to the last page; disabled on the last page. */
export function DataGridPaginationLast(): ReactNode {
  const { controls, labels } = usePaginationBarContext("DataGridPaginationLast");
  const { page, pageCount, onPageChange } = controls;

  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.lastPage} disabled={page >= pageCount} onClick={() => onPageChange(pageCount)}>
      <ChevronsRight />
    </Button>
  );
}
