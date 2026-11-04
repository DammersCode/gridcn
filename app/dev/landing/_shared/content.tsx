import {
  ArrowUpDown,
  Blocks,
  Bot,
  Clipboard,
  CloudDownload,
  Database,
  FileSpreadsheet,
  Gauge,
  Keyboard,
  Languages,
  LayoutGrid,
  Link2,
  ListOrdered,
  MousePointer2,
  PaintBucket,
  Palette,
  Pencil,
  Pin,
  Radio,
  RefreshCw,
  Shapes,
  Undo2,
  Users,
  Bookmark,
  Timer,
} from "lucide-react";

export const headlineFeatures = [
  { icon: MousePointer2, title: "Range selection", text: "Anchor and rectangular range, Ctrl-click multi-range, keyboard extension." },
  { icon: Clipboard, text: "Native copy, cut and paste in TSV and HTML. Round-trips with Excel, Sheets and Numbers.", title: "Spreadsheet clipboard" },
  { icon: PaintBucket, title: "Fill handle", text: 'Drag to tile a selection, with series inference: "Item 1" becomes "Item 2".' },
];

export const coreTraits = [
  { icon: LayoutGrid, title: "Real DOM, real virtualization", text: "CSS Grid and subgrid, virtualized rows, smooth at 100k rows.", href: "/docs/performance" },
  { icon: Keyboard, title: "Typed columns", text: "defineColumns<TData>() infers value types. Accessor typos are compile errors.", href: "/docs/quick-start#define-columns" },
  { icon: Palette, title: "shadcn tokens only", text: "No bespoke palette. Dark mode works the moment your theme does.", href: "/docs/styling-theming" },
  { icon: Radio, title: "Streaming updates", text: "updateCells and updateRows push live rows into the view.", href: "/docs/streaming-updates" },
  { icon: Languages, title: "i18n and RTL", text: "Typed label objects, mirrored pinning and pointer math.", href: "/docs/i18n" },
];

export const addOnTiles = [
  { icon: PaintBucket, title: "Fill handle", href: "/docs/addons/fill" },
  { icon: Undo2, title: "Undo and redo", href: "/docs/addons/undo-redo" },
  { icon: ArrowUpDown, title: "Sorting and filtering", href: "/docs/sorting-filtering-search" },
  { icon: FileSpreadsheet, title: "Import and export", href: "/docs/addons/import-export" },
  { icon: Link2, title: "URL state", href: "/docs/addons/url-state" },
  { icon: Blocks, title: "Context menu", href: "/docs/columns" },
  { icon: MousePointer2, title: "Keybindings dialog", href: "/docs/selection-keyboard" },
  { icon: Pin, title: "Pinned rows", href: "/docs/addons/pinned-rows" },
  { icon: Users, title: "Multiplayer presence", href: "/docs/addons/presence" },
  { icon: Bookmark, title: "Saved views", href: "/docs/addons/views" },
  { icon: CloudDownload, title: "Lazy loading", href: "/docs/lazy-loading" },
  { icon: ListOrdered, title: "Pagination", href: "/docs/pagination" },
  { icon: Pencil, title: "Cell editing types", href: "/docs/editing-cell-types" },
  { icon: ArrowUpDown, title: "Toolbar and search", href: "/docs/sorting-filtering-search" },
  { icon: ArrowUpDown, title: "Sort list", href: "/docs/sorting-filtering-search" },
  { icon: Timer, title: "Debounced inputs", href: "/docs/hooks/use-debounce" },
];

export const agentSkills = [
  { icon: Gauge, title: "gridcn-performance", text: "Audits a slow grid against the memoization and virtualization traps, in order." },
  { icon: Shapes, title: "gridcn-custom-cell-type", text: "Builds a cell type that pastes, sorts and edits like the built-ins." },
  { icon: Database, title: "gridcn-data-source", text: "Picks client, streaming, lazy or paged data and wires server sort and filter." },
  { icon: Blocks, title: "gridcn-addons", text: "Wires several add-ons into one grid, each output in the right place." },
  { icon: RefreshCw, title: "gridcn-upgrade", text: "Pulls upstream fixes into copied source and keeps your local edits." },
];

export const comparison = {
  columns: ["gridcn", "AG Grid", "MUI X", "TanStack Table"],
  rows: [
    { feature: "Range selection", values: ["Free", "Enterprise", "Premium", "Headless"] },
    { feature: "Excel / Sheets clipboard round-trip", values: ["Free", "Enterprise", "Premium", "Headless"] },
    { feature: "Fill handle", values: ["Add-on", "Enterprise", "Premium (v9)", "—"] },
    { feature: "Undo & redo", values: ["Add-on", "Community (v36)", "Premium", "Headless"] },
    { feature: "npx shadcn add", values: ["One line", "—", "—", "Examples only"] },
  ],
};

export const AgentIcon = Bot;
