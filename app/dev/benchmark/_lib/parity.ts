/**
 * Feature-parity matrix — the single source of truth for both the runner's "Parity" section and
 * each per-grid page's parity note block. Every metric in this benchmark is only comparable to the
 * extent the grids render the same thing; wherever a library cannot be made to match, that gap is
 * recorded here so it is visible next to the numbers rather than silently folded into them.
 */

export type ParityLevel = "exact" | "approximate" | "impossible";

export type ParityCell = {
  level: ParityLevel;
  /** What the grid actually renders/does. Shown in the matrix cell. */
  summary: string;
  /** Required for approximate/impossible: WHY it can't match gridcn, one line. */
  note?: string;
};

/** Column + capability axes of the matrix — the same 8 columns every grid renders, then behaviors. */
export const PARITY_ASPECTS = [
  { id: "col-text", label: "text (name/email)", kind: "column" },
  { id: "col-number", label: "number (age/score)", kind: "column" },
  { id: "col-select", label: "select (role)", kind: "column" },
  { id: "col-date", label: "date (joined)", kind: "column" },
  { id: "col-checkbox", label: "checkbox (active)", kind: "column" },
  { id: "cap-editing", label: "editing", kind: "capability" },
  { id: "cap-selection", label: "selection model", kind: "capability" },
  { id: "cap-clipboard", label: "clipboard", kind: "capability" },
] as const;

export type ParityAspectId = (typeof PARITY_ASPECTS)[number]["id"];

export type GridParity = {
  /** Per-grid headline shown above its own note block. */
  headline: string;
  cells: Record<ParityAspectId, ParityCell>;
};

export const PARITY_MATRIX: Record<string, GridParity> = {
  gridcn: {
    headline: "Reference implementation — every other grid's parity is measured against this column.",
    cells: {
      "col-text": { level: "exact", summary: "text cell type, inline editor" },
      "col-number": { level: "exact", summary: "number cell type, min/max, right-aligned" },
      "col-select": { level: "exact", summary: "select cell type, choices dropdown editor" },
      "col-date": { level: "exact", summary: "date cell type, en-US display format + calendar editor" },
      "col-checkbox": { level: "exact", summary: "checkbox cell type, toggles in place" },
      "cap-editing": { level: "exact", summary: "all 8 columns editable, per-type editors" },
      "cap-selection": { level: "exact", summary: "cell / range / multi-range + row + column" },
      "cap-clipboard": { level: "exact", summary: "native Ctrl+C/V over ranges, TSV round-trip" },
    },
  },
  "mui-x": {
    headline: "MUI X DataGrid, MIT (community) tier — the closest MIT feature match; range selection and clipboard are paid Pro/Premium features.",
    cells: {
      "col-text": { level: "exact", summary: "default string column, editable" },
      "col-number": { level: "exact", summary: "type: 'number', editable, right-aligned" },
      "col-select": { level: "exact", summary: "type: 'singleSelect' + valueOptions, editable" },
      "col-date": {
        level: "approximate",
        summary: "type: 'date' with Date valueGetter, editable",
        note: "MUI's date column needs real Date objects, so this page converts the shared ISO string per cell — a per-render cost the other grids don't pay.",
      },
      "col-checkbox": { level: "exact", summary: "type: 'boolean', editable" },
      "cap-editing": { level: "approximate", summary: "single-cell edit on all 8 columns", note: "MIT tier has no fill handle and no paste-to-edit; only one cell can be edited per commit." },
      "cap-selection": {
        level: "impossible",
        summary: "row checkbox selection only",
        note: "Cell-range selection is Pro-tier (disableMultipleRowSelection aside, no cell range exists in MIT) — cannot be made equivalent at any price below a licence.",
      },
      "cap-clipboard": {
        level: "impossible",
        summary: "none",
        note: "Clipboard copy/paste is a Premium-tier feature; the MIT build ships no Ctrl+C handler at all.",
      },
    },
  },
  "react-data-grid": {
    headline: "react-data-grid (adazzle) — a real MIT DOM grid; the closest overall behavioural match after gridcn, but its rich editors are hand-rolled here.",
    cells: {
      "col-text": { level: "exact", summary: "renderTextEditor, editable" },
      "col-number": {
        level: "approximate",
        summary: "text editor coerced to number on commit",
        note: "RDG ships no numeric editor; this page wraps an <input type=number> itself, so validation/step behaviour is ours, not the library's.",
      },
      "col-select": {
        level: "approximate",
        summary: "hand-rolled <select> edit cell over the shared role choices",
        note: "RDG has no built-in select editor (only renderTextEditor) — the dropdown is benchmark code, so its render cost is not representative of a library-provided cell.",
      },
      "col-date": {
        level: "approximate",
        summary: "hand-rolled <input type=date> edit cell, ISO text display",
        note: "RDG has no date cell type; display is raw ISO rather than a formatted date, so it does less formatting work per cell than gridcn/MUI.",
      },
      "col-checkbox": {
        level: "approximate",
        summary: "SelectCellFormatter checkbox, toggles the row",
        note: "Reuses RDG's selection checkbox formatter as a boolean cell — visually equivalent, but it is not a first-class boolean column type.",
      },
      "cap-editing": { level: "approximate", summary: "all 8 columns editable via mixed built-in/hand-rolled editors", note: "Half the editors are benchmark code (see the select/date/number rows) because the library provides only a text editor." },
      "cap-selection": {
        level: "approximate",
        summary: "row checkbox selection + single active cell",
        note: "No multi-cell range or multi-range selection; drag-select across cells does not exist in RDG.",
      },
      "cap-clipboard": {
        level: "approximate",
        summary: "onCellCopy/onCellPaste wired for the active cell",
        note: "RDG exposes copy/paste as opt-in single-cell callbacks (wired here); there is no range copy producing TSV like gridcn's.",
      },
    },
  },
  tanstack: {
    headline: "TanStack Table + TanStack Virtual, assembled by hand — 'what raw TanStack gives you'. It is a table-state library, not a grid product; everything below the header row is benchmark code.",
    cells: {
      "col-text": { level: "exact", summary: "rendered text" },
      "col-number": { level: "approximate", summary: "rendered text, formatted to match", note: "Read-only — the number is formatted for visual parity but there is no editor to invoke." },
      "col-select": {
        level: "impossible",
        summary: "rendered badge showing the role",
        note: "Read-only baseline: TanStack has no cell editing at all, so a dropdown would be entirely benchmark code; a styled badge is the honest thin equivalent.",
      },
      "col-date": {
        level: "approximate",
        summary: "rendered text, same en-US format as gridcn",
        note: "Formatting matches so per-cell work is comparable, but there is no date editor or calendar.",
      },
      "col-checkbox": {
        level: "approximate",
        summary: "rendered check/dash glyph",
        note: "Read-only indicator — renders a boolean but cannot be toggled.",
      },
      "cap-editing": {
        level: "impossible",
        summary: "none",
        note: "TanStack Table has no editing layer; this is the single largest parity gap in the comparison and it makes every mount/scroll number here optimistic relative to the editable grids.",
      },
      "cap-selection": {
        level: "approximate",
        summary: "thin hand-rolled single cell-range drag-select",
        note: "~40 lines of benchmark code, not a library feature; no multi-range, no keyboard extension, no row/column selection.",
      },
      "cap-clipboard": {
        level: "impossible",
        summary: "none",
        note: "No clipboard layer exists in TanStack Table and none was hand-rolled — Ctrl+C does nothing.",
      },
    },
  },
};

export const PARITY_LEVEL_LABEL: Record<ParityLevel, string> = {
  exact: "exact",
  approximate: "approx",
  impossible: "n/a",
};

/** Every approximate/impossible cell for one grid, flattened for the per-page note block. */
export function parityGapsFor(gridId: string): { aspect: string; level: ParityLevel; note: string }[] {
  const parity = PARITY_MATRIX[gridId];
  if (!parity) return [];
  return PARITY_ASPECTS.flatMap((aspect) => {
    const cell = parity.cells[aspect.id];
    if (cell.level === "exact" || !cell.note) return [];
    return [{ aspect: aspect.label, level: cell.level, note: cell.note }];
  });
}
