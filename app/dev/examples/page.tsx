import type { ReactNode } from "react";
import DataGridMinimalDemo from "@/registry/default/examples/data-grid-minimal-demo";
import DataGridStreamingDemo from "@/registry/default/examples/data-grid-streaming-demo";
import DataGridDemo from "@/registry/default/examples/data-grid-demo";
import DataGridCellTypesDemo from "@/registry/default/examples/data-grid-cell-types-demo";
import DataGridSortingFilteringDemo from "@/registry/default/examples/data-grid-sorting-filtering-demo";
import DataGridHistoryDemo from "@/registry/default/examples/data-grid-history-demo";
import DataGridContextMenuDemo from "@/registry/default/examples/data-grid-context-menu-demo";
import DataGridKeybindingsDemo from "@/registry/default/examples/data-grid-keybindings-demo";
import DataGridIODemo from "@/registry/default/examples/data-grid-io-demo";
import DataGridUrlStateDemo from "@/registry/default/examples/data-grid-url-state-demo";
import DataGridRowMarkersDemo from "@/registry/default/examples/data-grid-row-markers-demo";
import DataGridCustomHeadersDemo from "@/registry/default/examples/data-grid-custom-headers-demo";
import DataGridCustomMarkersDemo from "@/registry/default/examples/data-grid-custom-markers-demo";
import DataGridPinningDemo from "@/registry/default/examples/data-grid-pinning-demo";
import DataGridLargeDataDemo from "@/registry/default/examples/data-grid-large-data-demo";
import DataGridPerformanceDemo from "@/registry/default/examples/data-grid-performance-demo";
import DataGridPinnedRowsDemo from "@/registry/default/examples/data-grid-pinned-rows-demo";
import DataGridConditionalStylingDemo from "@/registry/default/examples/data-grid-conditional-styling-demo";
import DataGridStylingPatternsDemo from "@/registry/default/examples/data-grid-styling-patterns-demo";
import DataGridLazyDemo from "@/registry/default/examples/data-grid-lazy-demo";
import DataGridPaginationDemo from "@/registry/default/examples/data-grid-pagination-demo";
import DataGridSortListDemo from "@/registry/default/examples/data-grid-sort-list-demo";
import DataGridPresenceDemo from "@/registry/default/examples/data-grid-presence-demo";
import DataGridEventsDemo from "@/registry/default/examples/data-grid-events-demo";
import DataGridCustomCellDemo from "@/registry/default/examples/data-grid-custom-cell-demo";
import DataGridValidationDemo from "@/registry/default/examples/data-grid-validation-demo";
import DataGridCellErrorsDemo from "@/registry/default/examples/data-grid-cell-errors-demo";
import DataGridI18nDemo from "@/registry/default/examples/data-grid-i18n-demo";
import DataGridFillPatternsDemo from "@/registry/default/examples/data-grid-fill-patterns-demo";
import DataGridLoadingDemo from "@/registry/default/examples/data-grid-loading-demo";
import DataGridPlaygroundDemo from "@/registry/default/examples/data-grid-playground-demo";

const SECTIONS: { title: string; description: string; demo: ReactNode }[] = [
  {
    title: "data-grid-minimal-demo",
    description: "The quick-start minimum: the core item alone, defaultData, zero app-side state.",
    demo: <DataGridMinimalDemo />,
  },
  {
    title: "data-grid-streaming-demo",
    description: "A live ticker: updateCells streams values in place; sorted rows hold position until you re-sort.",
    demo: <DataGridStreamingDemo />,
  },
  {
    title: "data-grid-demo",
    description: "The hero demo: editable cell types, range selection, fill handle, clipboard.",
    demo: <DataGridDemo />,
  },
  {
    title: "data-grid-cell-types-demo",
    description: "Every built-in cell type, a read-only column, validate, and a custom renderCell.",
    demo: <DataGridCellTypesDemo />,
  },
  {
    title: "data-grid-sorting-filtering-demo",
    description: "Search, filter menu, and multi-column sort via header clicks.",
    demo: <DataGridSortingFilteringDemo />,
  },
  {
    title: "data-grid-history-demo",
    description: "Undo/redo via the useDataGridState quick start.",
    demo: <DataGridHistoryDemo />,
  },
  {
    title: "data-grid-context-menu-demo",
    description: "Cell and header context menus.",
    demo: <DataGridContextMenuDemo />,
  },
  {
    title: "data-grid-keybindings-demo",
    description: "Runtime-generated keyboard shortcuts dialog.",
    demo: <DataGridKeybindingsDemo />,
  },
  {
    title: "data-grid-io-demo",
    description: "Import/export xlsx and csv.",
    demo: <DataGridIODemo />,
  },
  {
    title: "data-grid-url-state-demo",
    description: "Sort/filter/search synced to the URL via nuqs (app-router adapter).",
    demo: <DataGridUrlStateDemo />,
  },
  {
    title: "data-grid-row-markers-demo",
    description: "Row marker modes: none/number/checkbox/both.",
    demo: <DataGridRowMarkersDemo />,
  },
  {
    title: "data-grid-custom-headers-demo",
    description: "Column `header` as a component: three-state sort icons (useDataGridSortState); header click sorts in sort mode, custom headers own their display.",
    demo: <DataGridCustomHeadersDemo />,
  },
  {
    title: "data-grid-custom-markers-demo",
    description: "Custom row marker renderers: an icon marker reflecting selection plus a select-all header control; the cell's own gestures still select rows.",
    demo: <DataGridCustomMarkersDemo />,
  },
  {
    title: "data-grid-pinning-demo",
    description: "Column pinning, resize, and drag-to-reorder.",
    demo: <DataGridPinningDemo />,
  },
  {
    title: "data-grid-large-data-demo",
    description: "100k generated rows proving row virtualization.",
    demo: <DataGridLargeDataDemo />,
  },
  {
    title: "data-grid-performance-demo",
    description: "100k rows with a top-left FPS meter overlay.",
    demo: <DataGridPerformanceDemo />,
  },
  {
    title: "data-grid-pinned-rows-demo",
    description: "An averages row pinned under the header and a totals row pinned at the bottom, both recomputed live from the grid's data.",
    demo: <DataGridPinnedRowsDemo />,
  },
  {
    title: "data-grid-conditional-styling-demo",
    description: "Value-driven row/cell/column/header styling on a realistic HR dataset.",
    demo: <DataGridConditionalStylingDemo />,
  },
  {
    title: "data-grid-styling-patterns-demo",
    description: "A fully-styled brand column, a fully-styled at-risk row, and a density/rowHeight toggle.",
    demo: <DataGridStylingPatternsDemo />,
  },
  {
    title: "data-grid-lazy-demo",
    description: "100k rows, simulated-latency fetch on scroll, skeleton rows filling in as data lands.",
    demo: <DataGridLazyDemo />,
  },
  {
    title: "data-grid-pagination-demo",
    description: "Client-mode pagination: prev/next, page numbers, page-size select, range label.",
    demo: <DataGridPaginationDemo />,
  },
  {
    title: "data-grid-sort-list-demo",
    description: "Toolbar sort button + popover: add/remove sorts, toggle direction, reorder precedence.",
    demo: <DataGridSortListDemo />,
  },
  {
    title: "data-grid-presence-demo",
    description: "3 simulated users move cell/range selections on a timer via useDataGridPresence's setPresenceHighlights.",
    demo: <DataGridPresenceDemo />,
  },
  {
    title: "data-grid-events-demo",
    description: "Live inspector panel pretty-printing the latest payload per event (8 sources incl. onSelectionChange/onColumnLayoutChange).",
    demo: <DataGridEventsDemo />,
  },
  {
    title: "data-grid-custom-cell-demo",
    description: "A worked custom cell type: currency storage, cached locale-formatted display, symbol-stripping fromText.",
    demo: <DataGridCustomCellDemo />,
  },
  {
    title: "data-grid-validation-demo",
    description: "Sync function, sync Standard Schema, async Standard Schema (pending state), bulk-paste rejection, and a coercing transform.",
    demo: <DataGridValidationDemo />,
  },
  {
    title: "data-grid-cell-errors-demo",
    description: "Post-commit server rejection: setCellErrors paints a cell after a fake 422, clears on the next successful commit.",
    demo: <DataGridCellErrorsDemo />,
  },
  {
    title: "data-grid-i18n-demo",
    description: "Locale Select (English/Deutsch/Arabic) driving labels, plus an independent RTL Switch driving direction.",
    demo: <DataGridI18nDemo />,
  },
  {
    title: "data-grid-fill-patterns-demo",
    description: "Staged numeric/padded/text-number series columns for drag-fill series inference vs. tiling.",
    demo: <DataGridFillPatternsDemo />,
  },
  {
    title: "data-grid-loading-demo",
    description: "loading flag's three states: skeleton, indeterminate bar over existing rows, and empty state.",
    demo: <DataGridLoadingDemo />,
  },
  {
    title: "data-grid-playground-demo",
    description: "Every add-on composed in one grid, with independent toggles and an exclusive virtualized/paginated/lazy mode select.",
    demo: <DataGridPlaygroundDemo />,
  },
];

/** Renders every registry example item in one page — the advisor's live-check surface until the docs site exists. */
export default function ExamplesPage(): ReactNode {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-12 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">gridcn examples</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every registry:example item, rendered from its exact installable source.
        </p>
      </div>
      {SECTIONS.map((section) => (
        <section key={section.title} className="flex flex-col gap-2">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{section.title}</h2>
            <p className="text-sm text-muted-foreground">{section.description}</p>
          </div>
          {section.demo}
        </section>
      ))}
    </div>
  );
}
