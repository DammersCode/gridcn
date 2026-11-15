export const SUBLINE = "A data grid for React with range selection, paste from Excel, a fill handle and undo. One shadcn command copies the source into your app.";

export const perfStats = [
  {
    value: "100,000",
    title: "Rows in the scroll tests",
    detail: "Real Chromium. Scroll suites fail the build when a frame-rate, long-task or blank-row limit is crossed. The limits are not measurements.",
    source: "Benchmark results: thresholds",
    href: "/docs/performance/benchmark-results#thresholds",
  },
  {
    value: "4 to 7 ms",
    title: "Client sort of a number column",
    detail: "100,000 rows, unsorted input, one development machine, scripts/bench-sort.mjs. A text column took 5 to 93 ms.",
    source: "Benchmark results: sort speed",
    href: "/docs/performance/benchmark-results#sort-speed",
  },
  {
    value: "200 KiB",
    title: "Core grid, gzip",
    detail: "Minified esbuild build of the core import, React left out. Add-ons add their own source.",
    source: "Bundle size: core",
    href: "/docs/performance/bundle-cost#core",
  },
];

export const perfNote = "Your hardware and your cells change these numbers.";
export const perfRunHref = "/docs/performance/run-benchmark";

export const serverHighlights = [
  { title: "Scroll mode", text: "Row blocks load as the user scrolls. One hook: useDataGridServerRows.", href: "/docs/scroll-mode/load-rows-while-scrolling" },
  { title: "Pages", text: "One page per request, with a row count, without one, or with a cursor.", href: "/docs/server-pagination/load-rows-page" },
  { title: "Server sort and filter", text: "With sortMode and filterMode set to server, the grid sends the spec and shows the rows you return.", href: "/docs/data-modes/query-server-rows" },
  { title: "Server totals", text: "Pin a totals row that your server computes for the whole filtered result.", href: "/docs/data-modes/show-server-totals" },
  { title: "Streaming pushes", text: "updateCells and updateRows push live values. A server-ordered view marks changed rows as stale.", href: "/docs/rows-live-data/push-server-ordered-view" },
  { title: "Saves with rollback", text: "Turn edits into API calls. Roll a refused save back or refetch the rows.", href: "/docs/save-server/save-revert" },
  { title: "Selection across pages", text: "Checked rows stay checked by id. Select all matching rows of the result.", href: "/docs/rows-live-data/select-server-rows" },
  { title: "Row actions", text: "A row action that does nothing says why. A gate that never settles can time out.", href: "/docs/rows-live-data/handle-row-action-results" },
  { title: "Filter values from the server", text: "The header filter lists the values that your backend returns.", href: "/docs/sort-filter-search/header-filter" },
];

export const newInTwo = [
  { text: "One server data source. useDataGridServerRows serves scroll mode and pages, and replaces the lazy-rows hook.", href: "/docs/data-modes/query-server-rows" },
  { text: "Selection across pages. Checked rows stay checked by id, and the status bar offers to select all matching rows.", href: "/docs/rows-live-data/select-server-rows" },
  { text: "Saved views. Name a sort, filter, search and column layout and restore it later.", href: "/docs/sort-filter-search/saved-views" },
  { text: "Server totals. useDataGridServerAggregate pins a totals row that your server computes.", href: "/docs/data-modes/show-server-totals" },
  { text: "Async gates take an AbortSignal, and gateTimeoutMs stops a gate that never settles.", href: "/docs/editing-cells/cancel-async-gates" },
  { text: "Faster client sort. A number or text column sorts on integer keys instead of a comparator per pair.", href: "/docs/performance/benchmark-results#sort-speed" },
  { text: "Breaking changes. Read the migration guide before you upgrade a 1.x grid.", href: "/docs/support-upgrades/migrate-2-0" },
];

export const CLIENT_CODE = `"use client";

import { DataGrid, defineColumns } from "@/components/data-grid/data-grid";

type Person = { id: string; name: string; age: number };

const columns = defineColumns<Person>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text" },
  { id: "age", header: "Age", accessorKey: "age", type: "number" },
]);

const people: Person[] = [{ id: "1", name: "Ada Lovelace", age: 28 }];

export function PeopleGrid() {
  return <DataGrid defaultData={people} columns={columns} className="h-96" />;
}`;

export const SERVER_CODE = `const server = useDataGridServerRows<Order>({
  mode: "scroll",
  fetchRows: async ({ spec, start, end, signal }) => {
    const res = await fetch("/api/orders", {
      method: "POST",
      body: JSON.stringify({ spec, start, end }),
      signal,
    });
    const { rows, total } = await res.json();
    return { rows, totalRowCount: total };
  },
});

<DataGrid {...server.gridProps} columns={columns} className="h-96" />`;
