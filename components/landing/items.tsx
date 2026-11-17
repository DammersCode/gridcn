import {
  ArrowLeftRight,
  ArrowUpDown,
  BookmarkCheck,
  Blocks,
  Clipboard,
  Command,
  Braces,
  Database,
  FileSpreadsheet,
  Grid3x3,
  Keyboard,
  Languages,
  LayoutGrid,
  ListFilter,
  Link2,
  ListOrdered,
  MousePointer2,
  PaintBucket,
  ScanSearch,
  PanelBottom,
  Palette,
  Pin,
  Radio,
  Search,
  ShieldCheck,
  TextSearch,
  Undo2,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";

export const kitTiles: { icon: LucideIcon; title: string; text: string; href: string }[] = [
  { icon: MousePointer2, title: "Range selection", text: "Drag a rectangular range. Select rows and columns with the pointer.", href: "/docs/selection-shortcuts/pointer-selection" },
  { icon: Clipboard, title: "Clipboard", text: "Copy, cut and paste with Ctrl+C, Ctrl+X and Ctrl+V. Reads HTML and tab-separated text from Excel, Sheets and Numbers.", href: "/docs/clipboard-undo/clipboard" },
  { icon: PaintBucket, title: "Fill handle", text: "Drag the corner to copy a selection. Two cells that form a series continue it: Item 1, Item 2 becomes Item 3, Item 4.", href: "/docs/clipboard-undo/fill-handle" },
  { icon: Braces, title: "Typed columns", text: "defineColumns infers the value type of each column.", href: "/docs/learning-path/define-columns" },
  { icon: LayoutGrid, title: "Virtualized DOM", text: "Each cell is a real DOM element. The grid draws only the rows and columns in view.", href: "/docs/performance/virtualization" },
  { icon: Palette, title: "shadcn tokens", text: "The grid takes your theme colors and radius, in light and dark mode.", href: "/docs/theme-style-language/colors-radius" },
  { icon: Radio, title: "Streaming updates", text: "updateCells pushes live values by row id.", href: "/docs/rows-live-data/stream-updates" },
  { icon: Languages, title: "Labels and RTL", text: "One typed labels object translates the grid. Right-to-left layout has browser tests.", href: "/docs/theme-style-language/labels-i18n" },
  { icon: ShieldCheck, title: "Validation", text: "A function or schema checks a cell before it commits. Soft rules only flag it.", href: "/docs/editing-cells/validation" },
  { icon: ListFilter, title: "Sorting and filtering", text: "Sort by several columns. Filter per column in and/or groups, from a menu or from code.", href: "/docs/sort-filter-search/filtering" },
  { icon: Keyboard, title: "Keyboard navigation", text: "Move, extend, edit and select with the keyboard. The keymap prop remaps the grid's shortcuts.", href: "/docs/selection-shortcuts/keyboard-navigation" },
  { icon: ArrowLeftRight, title: "Column order and pinning", text: "Drag columns into a new order. Pin columns to the start or end side.", href: "/docs/columns/column-order-pinning" },
];

export type AddOnTile = { block: string; icon: LucideIcon; title: string; href: string };

export const addOnTiles: AddOnTile[] = [
  { block: "data-grid", icon: Grid3x3, title: "Core grid", href: "/docs/learning-path/install-gridcn#install-the-core-grid" },
  { block: "data-grid-fill", icon: PaintBucket, title: "Fill handle", href: "/docs/clipboard-undo/fill-handle" },
  { block: "data-grid-history", icon: Undo2, title: "Undo and redo", href: "/docs/clipboard-undo/undo-redo" },
  { block: "data-grid-find-replace", icon: TextSearch, title: "Find and replace", href: "/docs/sort-filter-search/find-replace" },
  { block: "data-grid-io", icon: FileSpreadsheet, title: "Import and export", href: "/docs/import-export/import" },
  { block: "dropzone", icon: Upload, title: "File dropzone", href: "/docs/import-export/import" },
  { block: "data-grid-url-state", icon: Link2, title: "URL state", href: "/docs/sort-filter-search/url-state" },
  { block: "data-grid-views", icon: BookmarkCheck, title: "Saved views", href: "/docs/sort-filter-search/saved-views" },
  { block: "data-grid-pinned-rows", icon: Pin, title: "Pinned rows and totals", href: "/docs/rows-pages-menus/pinned-rows" },
  { block: "data-grid-presence", icon: Users, title: "Presence", href: "/docs/rows-live-data/show-presence" },
  { block: "data-grid-context-menu", icon: Blocks, title: "Context menu", href: "/docs/rows-pages-menus/context-menu" },
  { block: "data-grid-keybindings", icon: Command, title: "Keybindings dialog", href: "/docs/selection-shortcuts/shortcut-remapping" },
  { block: "data-grid-status-bar", icon: PanelBottom, title: "Status bar", href: "/docs/selection-shortcuts/status-bar" },
  { block: "data-grid-toolbar", icon: Search, title: "Toolbar and search", href: "/docs/sort-filter-search/toolbar" },
  { block: "data-grid-sort-list", icon: ArrowUpDown, title: "Sort list", href: "/docs/sort-filter-search/sorting" },
  { block: "data-grid-pagination", icon: ListOrdered, title: "Client pagination", href: "/docs/rows-pages-menus/client-pagination" },
  { block: "data-grid-server", icon: Database, title: "Server rows", href: "/docs/data-modes/query-server-rows" },
  { block: "data-grid-lookup", icon: ScanSearch, title: "Lookup cell", href: "/docs/editing-cells/lookup-cell" },
];

export const COMPARISON_DATE = "2026-11-16";
export const FEATURE_MATRIX_HREF = "/docs/fit-features/feature-matrix";

const AG = "https://www.ag-grid.com/react-data-grid";
const MUI = "https://mui.com/x/react-data-grid";
const NOT_BUILT = "Not built";

type Cell = { value: string; href: string };
type Row = { feature: string; cells: [Cell, Cell, Cell] };

export const comparison: { columns: string[]; rows: Row[] } = {
  columns: ["gridcn", "AG Grid", "MUI X"],
  rows: [
    {
      feature: "Range selection",
      cells: [
        { value: "Free, core", href: "/docs/selection-shortcuts/pointer-selection" },
        { value: "Enterprise", href: `${AG}/cell-selection/` },
        { value: "Premium", href: `${MUI}/cell-selection/` },
      ],
    },
    {
      feature: "Clipboard paste",
      cells: [
        { value: "Free, core", href: "/docs/clipboard-undo/clipboard" },
        { value: "Enterprise", href: `${AG}/clipboard/` },
        { value: "Premium", href: `${MUI}/clipboard/` },
      ],
    },
    {
      feature: "Fill handle",
      cells: [
        { value: "Free, add-on", href: "/docs/clipboard-undo/fill-handle" },
        { value: "Enterprise", href: `${AG}/cell-selection-fill-handle/` },
        { value: "Premium", href: `${MUI}/clipboard/#drag-to-fill` },
      ],
    },
    {
      feature: "Undo and redo",
      cells: [
        { value: "Free, add-on", href: "/docs/clipboard-undo/undo-redo" },
        { value: "Community", href: `${AG}/undo-redo-edits/` },
        { value: "Premium", href: `${MUI}/undo-redo/` },
      ],
    },
    {
      feature: "Row grouping",
      cells: [
        { value: NOT_BUILT, href: FEATURE_MATRIX_HREF },
        { value: "Enterprise", href: `${AG}/grouping/` },
        { value: "Premium", href: `${MUI}/row-grouping/` },
      ],
    },
    {
      feature: "Tree data",
      cells: [
        { value: NOT_BUILT, href: FEATURE_MATRIX_HREF },
        { value: "Enterprise", href: `${AG}/tree-data/` },
        { value: "Pro", href: `${MUI}/tree-data/` },
      ],
    },
    {
      feature: "Pivoting",
      cells: [
        { value: NOT_BUILT, href: FEATURE_MATRIX_HREF },
        { value: "Enterprise", href: `${AG}/pivoting/` },
        { value: "Premium", href: `${MUI}/pivoting/` },
      ],
    },
    {
      feature: "Master-detail",
      cells: [
        { value: NOT_BUILT, href: FEATURE_MATRIX_HREF },
        { value: "Enterprise", href: `${AG}/master-detail/` },
        { value: "Pro", href: `${MUI}/master-detail/` },
      ],
    },
  ],
};
