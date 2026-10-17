import { escapeHtmlText, sanitizeFormulaCell } from "./serialize-cells";

const BLOCK_TAGS = new Set(["P", "DIV", "LI"]);

/** Maps the character references the serializer and `innerHTML` disagree on (`&nbsp;`, `&#13;`) to their characters. */
function normalizeHtmlText(html: string): string {
  return html.replace(/&nbsp;/g, "\u00a0").replace(/&#13;/g, "\r");
}

/**
 * The grid's own `data-gridcn-raw` trust check: the attribute holds a value the DOM never sees
 * (raw "\t"/spaces/newlines the display renders as spans/`<br>`), so it is trusted only when it is
 * the serializer's own rendering of this exact cell — a hand-crafted payload cannot set it to a
 * different value without the cell's visible text contradicting it. The formula-sanitized
 * rendering (`'` prefix) of the same value also matches.
 */
function rawMatchesCell(raw: string, cell: Element): boolean {
  const rendered = normalizeHtmlText(cell.innerHTML);
  return rendered === normalizeHtmlText(escapeHtmlText(raw)) || rendered === normalizeHtmlText(escapeHtmlText(sanitizeFormulaCell(raw)));
}

/** Converts a table cell's DOM content to text, treating `<br>` as a newline and separating block-level children (e.g. Apple Numbers' `<p>` per line) with one. */
function cellNodeToText(cell: Element): string {
  const raw = cell.getAttribute("data-gridcn-raw");
  if (raw !== null && rawMatchesCell(raw, cell)) return raw;

  let out = "";
  for (const node of Array.from(cell.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (el.tagName === "BR") {
        out += "\n";
      } else if (BLOCK_TAGS.has(el.tagName) && out !== "") {
        out += "\n" + cellNodeToText(el);
      } else {
        out += cellNodeToText(el);
      }
    }
  }
  return out;
}

/**
 * Parses a clipboard `text/html` payload into a 2D string grid using the first `<table>` found.
 * Prefers each cell's `data-gridcn-raw` attribute — trusted only when it is the grid's own
 * serialization of the cell (it renders back to the cell's exact innerHTML) — falling back to
 * text content with `<br>` treated as a newline. With `maxCells`, parsing stops once the cell total passes it. Returns null when no table is present.
 */
export function parseClipboardHtml(html: string, maxCells?: number): string[][] | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (!table) return null;

  const rows: string[][] = [];
  let cellCount = 0;
  for (const tableRow of Array.from(table.rows)) {
    const cells: string[] = [];
    for (const cell of Array.from(tableRow.cells)) {
      cells.push(cellNodeToText(cell));
      if (maxCells !== undefined && cellCount + cells.length > maxCells) break;
    }
    rows.push(cells);
    cellCount += cells.length;
    if (maxCells !== undefined && cellCount > maxCells) break;
  }
  return rows;
}

/**
 * Parses a clipboard `text/plain` TSV payload with Excel-style quoting: a field starting with
 * `"` is quoted, `""` is an escaped quote, and tabs/newlines inside quotes are literal.
 * Handles both `\r\n` and `\n` row separators; a trailing empty row from a final newline is dropped.
 * With `maxCells`, parsing stops after the row that pushes the cell total past it; the caller trims that row.
 */
export function parseClipboardText(text: string, maxCells?: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // tracks whether the current field has any content (incl. a closed "") so it isn't mistaken for "nothing pending"
  let fieldPending = false;
  let i = 0;
  const len = text.length;
  let cellCount = 0;
  let full = false;
  // start of the current unflushed run; -1 means nothing pending (avoids per-char += allocation)
  let start = -1;

  const flush = () => {
    if (start !== -1) {
      field += text.slice(start, i);
      start = -1;
    }
  };
  const endField = () => {
    flush();
    row.push(field);
    field = "";
    fieldPending = false;
    if (maxCells !== undefined && cellCount + row.length > maxCells) full = true;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    cellCount += row.length;
    row = [];
    if (maxCells !== undefined && cellCount > maxCells) full = true;
  };

  while (i < len && !full) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        flush();
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (start === -1) start = i;
      i += 1;
      continue;
    }

    if (ch === '"' && field === "") {
      inQuotes = true;
      fieldPending = true;
      i += 1;
      continue;
    }
    if (ch === "\t") {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // lookahead for \r\n; a lone \r is treated as a row separator too
      endRow();
      i += text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i += 1;
      continue;
    }
    if (start === -1) start = i;
    fieldPending = true;
    i += 1;
  }

  if (full) {
    if (row.length > 0) rows.push(row);
    return rows;
  }

  // final field/row, unless the input ended exactly on a row separator (trailing newline)
  if (fieldPending || row.length > 0) {
    endRow();
  }

  return rows;
}

/** Upper bound for the markup one cell takes in a clipboard table; a larger payload skips the HTML parse. */
const HTML_CHARS_PER_CELL = 80;

/** Upper bound for the text one cell takes; a plain-text payload above the total is not parsed. */
const TEXT_CHARS_PER_CELL = 256;
const MIN_TEXT_CHARS = 1024 * 1024;

/**
 * Produces a 2D string grid from clipboard data, preferring the HTML table representation
 * and falling back to TSV plain text. With `maxCells`, an HTML payload too large for that many cells
 * is skipped, a text payload too large for them yields no cells, and the text parse stops early. Returns an empty array when neither is usable.
 */
export function parseClipboard(data: { html?: string; text?: string }, maxCells?: number): string[][] {
  if (data.html && (maxCells === undefined || data.html.length <= maxCells * HTML_CHARS_PER_CELL)) {
    const fromHtml = parseClipboardHtml(data.html, maxCells);
    if (fromHtml && fromHtml.length > 0) return fromHtml;
  }
  if (data.text !== undefined) {
    if (maxCells !== undefined && data.text.length > Math.max(maxCells * TEXT_CHARS_PER_CELL, MIN_TEXT_CHARS)) return [];
    return parseClipboardText(data.text, maxCells);
  }
  return [];
}
