export const HEADLINE = "A React data grid you own, with spreadsheet-style editing";
export const SUBLINE = "Range selection, paste from Excel, a fill handle and undo, free under Apache‑2.0. One shadcn command copies the source into your app.";

export const perfStats = [
  {
    value: "100,000",
    title: "Rows in the scroll tests",
    detail: "Real Chromium. The scroll suites fail the build when frame rate, long tasks or blank rows cross a limit.",
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
export const perfDemos = [
  { text: "100,000 rows in the browser", href: "/docs/server-data-examples/large-data-example" },
  { text: "100,000 rows loaded while you scroll", href: "/docs/server-data-examples/scroll-mode-example" },
  { text: "Live values pushed four times a second", href: "/docs/row-examples/streaming-rows-example" },
];

export const faq = [
  {
    question: "How do I get fixes after the source is in my app?",
    answer: "An upgrade reinstalls the registry files and asks before it replaces a file you changed.",
    links: [{ text: "Upgrade gridcn", href: "/docs/support-upgrades/upgrade-gridcn" }],
  },
  {
    question: "Does it work with React 18 or Tailwind 3?",
    answer: "No. The grid needs React 19 and Tailwind CSS 4.",
    links: [{ text: "Framework floors", href: "/docs/support-upgrades/browser-framework-support#framework-floors" }],
  },
  {
    question: "Which frameworks are tested?",
    answer: "Install tests cover Next.js 16 and Vite. The Next.js test builds and renders the core demo in a fresh project. The Vite test builds a fresh Vite app.",
    links: [{ text: "Framework floors", href: "/docs/support-upgrades/browser-framework-support#framework-floors" }],
  },
  {
    question: "How many rows can it hold?",
    answer: "The tests scroll 100,000 rows. Past that, the browser's height limit decides.",
    links: [{ text: "Row limits", href: "/docs/performance/row-limits" }],
  },
  {
    question: "Is it accessible?",
    answer: "Browser tests drive the grid with a real keyboard in Chromium, and an axe-core suite runs. The repository records no manual screen reader pass.",
    links: [
      { text: "Keyboard test coverage", href: "/docs/accessibility/keyboard-test-coverage" },
      { text: "Accessibility gaps", href: "/docs/accessibility/accessibility-gaps" },
    ],
  },
];

export const perfRunHref = "/docs/performance/run-benchmark";

export const serverHighlights = [
  { title: "Pages", text: "One page per request, with a row count, without one, or with a cursor.", href: "/docs/server-pagination/load-rows-page" },
  { title: "Server sort and filter", text: "With sortMode and filterMode set to server, the grid sends the spec and shows the rows you return.", href: "/docs/data-modes/query-server-rows" },
  { title: "Saves with rollback", text: "Turn edits into API calls. Roll a refused save back or refetch the rows.", href: "/docs/save-server/save-revert" },
  { title: "Selection across pages", text: "Checked rows stay checked by id. Select all matching rows of the result.", href: "/docs/rows-live-data/select-server-rows" },
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
