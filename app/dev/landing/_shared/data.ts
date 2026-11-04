// DEV-ONLY landing drafts: delete app/dev/landing* and research/landing-page-*.md when a draft is chosen.
import parity from "@/research/parity-matrix.json";

type Status = "supported" | "gap" | "n/a";
type Cell = { status: Status };
type Feature = { id: string; feature: string; cells: Record<string, Cell> };

const features = parity.features as unknown as Feature[];

export const parityModes = parity.modes.map((mode) => ({
  id: mode.id,
  label: mode.label,
}));

export const parityRows = features.map((f) => ({
  id: f.id,
  feature: f.feature,
  statuses: parityModes.map((m) => f.cells[m.id].status),
}));

const count = (status: Status) =>
  parityRows.reduce((n, r) => n + r.statuses.filter((s) => s === status).length, 0);

export const parityTotals = {
  features: parityRows.length,
  modes: parityModes.length,
  cells: parityRows.length * parityModes.length,
  supported: count("supported"),
  gap: count("gap"),
  na: count("n/a"),
};

export const parityByMode = parityModes.map((m, i) => {
  const of = (s: Status) => parityRows.filter((r) => r.statuses[i] === s).length;
  return { ...m, supported: of("supported"), gap: of("gap"), na: of("n/a") };
});

export const perfStats = [
  {
    value: "0.3–7.6 ms",
    title: "Streaming sort update",
    detail: "1 to 256 changed rows, one sort column, 100k rows. Production build.",
    source: "streaming updates",
    href: "/docs/streaming-updates",
  },
  {
    value: "51 ms",
    title: "Text sort",
    detail: "100k rows, down from 68 ms. In the browser.",
    source: "changelog",
    href: "https://github.com/DammersCode/gridcn/blob/main/CHANGELOG.md",
  },
  {
    value: "16.8 ms",
    title: "Longest frame on jump scroll",
    detail: "Median over a jump sequence at 100k rows, down from 91.7 ms. Headless test. Frames over 33 ms: 4 to 0.",
    source: "performance guide",
    href: "/docs/performance",
  },
];

export const perfNote = "Your hardware and cells change these numbers.";
  "Measured in this repository's regression suite on 100,000 rows. Your hardware and cells change them.";

export const serverHighlights = [
  { title: 'Lazy rows', text: 'Row blocks load as you scroll. One hook, one fetch function.', href: '/docs/lazy-loading' },
  { title: 'Server pagination', text: 'Pages with or without a row count.', href: '/docs/pagination' },
  { title: 'Server sort and filter', text: 'The grid sends the sort and the filter groups; you answer with rows.', href: '/docs/sorting-filtering-search' },
  { title: 'Saves with rollback', text: 'onSave acknowledges or rejects each change. A rejected cell rolls back.', href: '/docs/recipes/data-fetching/server-round-trip' },
  { title: 'Selection across pages', text: 'Checked rows stay checked by id. Select all matching rows of the result.', href: '/docs/data-modes' },
  { title: 'Filter values from the server', text: 'The set filter lists values your backend returns.', href: '/docs/data-modes' },
];

export const coreFeatures = [
  { title: "Range selection", text: "Rectangular and multi-range, keyboard extension." },
  { title: "Spreadsheet clipboard", text: "TSV and HTML round-trip with Excel and Sheets." },
  { title: "Fill handle", text: "Drag to tile, with series inference." },
  { title: "Typed columns", text: "defineColumns<TData>() infers value types." },
  { title: "shadcn tokens only", text: "Dark mode works the moment your theme does." },
  { title: "i18n and RTL", text: "Typed labels, mirrored pinning." },
];

export const addOns = [
  ["Fill handle", "/docs/addons/fill"],
  ["Undo and redo", "/docs/addons/undo-redo"],
  ["Import and export", "/docs/addons/import-export"],
  ["URL state", "/docs/addons/url-state"],
  ["Pinned rows", "/docs/addons/pinned-rows"],
  ["Presence", "/docs/addons/presence"],
  ["Saved views", "/docs/addons/views"],
  ["Pagination", "/docs/pagination"],
  ["Lazy loading", "/docs/lazy-loading"],
] as const;

export const SITE_TAGLINE =
  "A data grid for the shadcn ecosystem. Range selection, spreadsheet clipboard and typed editors on real DOM cells. Local arrays or a server: the same grid."

export const PLAIN_PITCH = "A spreadsheet-style table for React and shadcn apps, installed as source code. Local array or server: the same grid, smooth at 100k rows.";
