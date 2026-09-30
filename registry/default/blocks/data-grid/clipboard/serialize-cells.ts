const NEEDS_QUOTING = /[\t\n\r"]/;

/** Escapes a single TSV field per Excel quoting rules (quote wrap + doubled internal quotes). */
function quoteTsvField(cell: string): string {
  if (!NEEDS_QUOTING.test(cell)) return cell;
  return `"${cell.replace(/"/g, '""')}"`;
}

/** A leading one of these makes a CSV/TSV cell a formula in Excel, LibreOffice, and Sheets. */
const FORMULA_LEAD_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/** Values where a leading `+` or `-` is still a plain number. */
const PLAIN_NUMBER_RE = /^[+-]?\d+(\.\d+)?$/;

/**
 * Prefixes a formula-like cell (leading `=`, `+`, `-`, `@`, TAB, or CR; plain numbers exempt) with a
 * single quote. External spreadsheets treat that quote as a hidden text marker, so a CSV export or
 * clipboard paste cannot run `=HYPERLINK(...)`-style formulas in another sheet.
 */
export function sanitizeFormulaCell(value: string): string {
  const lead = value[0];
  if (lead === undefined || !FORMULA_LEAD_CHARS.has(lead) || PLAIN_NUMBER_RE.test(value)) return value;
  return `'${value}`;
}

/** Options for {@link serializeCells}. */
export type SerializeCellsOptions = {
  /** Prefix formula-like cells with `'` in the text/plain payload so external spreadsheets read them as text; default `false`, which keeps the grid's own copy/paste round-trip byte-identical. */
  sanitizeFormulas?: boolean;
};

/** Escapes text and preserves whitespace fidelity for Excel/Sheets: tabs -> 4 spaces, runs of >=2 spaces wrapped in a span. Also the round-trip check `parse-clipboard.ts` applies to `data-gridcn-raw`. */
export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\t/g, "    ")
    .replace(/  +/g, (run) => `<span>${" ".repeat(run.length)}</span>`)
    .replace(/\n/g, "<br>");
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Serializes a rectangular block of display strings into clipboard `text/plain` (quoted TSV)
 * and `text/html` (a `<table>` carrying the raw value in `data-gridcn-raw` per cell).
 */
export function serializeCells(cells: string[][], options: SerializeCellsOptions = {}): { text: string; html: string } {
  const { sanitizeFormulas = false } = options;
  const text = cells
    .map((row) => row.map((cell) => quoteTsvField(sanitizeFormulas ? sanitizeFormulaCell(cell) : cell)).join("\t"))
    .join("\n");

  const rowsHtml = cells
    .map((row) => {
      const cellsHtml = row
        .map((cell) => `<td data-gridcn-raw="${escapeHtmlAttr(cell)}">${escapeHtmlText(cell)}</td>`)
        .join("");
      return `<tr>${cellsHtml}</tr>`;
    })
    .join("");

  return { text, html: `<table><tbody>${rowsHtml}</tbody></table>` };
}
