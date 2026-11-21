import { type DataGridReadState, type GridDirection } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { normalizeLimit } from "./normalize-limit";
import { MAX_CELL_TEXT, buildExportHeaders, buildExportRows, exportRowPlan, exportRows } from "./export-grid";
import { abortReason, sourceStateOf, type ExportSource } from "./export-source";

/** Default number of rows printed when `maxRows` is not given. */
const DEFAULT_PRINT_MAX_ROWS = 10_000;
/** Hard ceiling on the printed table's cell count (a multi-million-cell DOM table hangs the print dialog). */
const PRINT_CELL_CEILING = 500_000;
/** Longest `css` option, in characters. */
export const MAX_PRINT_CSS_LENGTH = 65_536;
/** Fallback removal (ms) for the print iframe when the window's `afterprint` never fires. */
const PRINT_FALLBACK_MS = 60_000;

/** Paper sizes for {@link PrintGridOptions.paperSize}. */
export type PrintPaperSize = "A3" | "A4" | "Letter" | "Legal";

/** CSS `@page` size keyword per paper size. */
const PAPER_SIZE_CSS: Record<PrintPaperSize, string> = { A3: "A3", A4: "A4", Letter: "letter", Legal: "legal" };

/** Options for {@link printGrid}. */
export type PrintGridOptions = {
  /** Which rows to print: `"view"` (default) prints the current sort and filter order, every page of a paged grid; `"page"` the shown page only; `"all"` every row in `data` order; `"selection"` the selected rows in view order. */
  scope?: "view" | "page" | "all" | "selection";
  /** Printed as an `<h1>` heading and the document title. */
  title?: string;
  /** Emit a `<thead>` header row; default `true`. */
  includeHeaders?: boolean;
  /** Paper size of the printed page; default `"A4"`. */
  paperSize?: PrintPaperSize;
  /** Page orientation; default: `landscape` above 6 visible columns, else `portrait`. */
  orientation?: "portrait" | "landscape";
  /** Cap on the rows printed (the header row is not counted); default 10,000, further cut by the 500,000-cell ceiling. */
  maxRows?: number;
  /** Reading direction of the printed page. Default: the direction of the page that calls print. */
  direction?: GridDirection;
  /** Where the rows come from, for a grid that holds one page or some loaded blocks. With `source` the print ignores `scope` and the held rows. It receives the same context as the export source, and the `maxRows` and cell bounds apply. Under pivot it prints the source columns and never reads the pivot view. */
  source?: ExportSource;
  /** Header text per column id, replacing the column's label. A column without an entry keeps its label. */
  headers?: Readonly<Record<string, string>>;
  /** Extra CSS appended after the built-in rules, in a second `<style>` node. Longer than 65,536 characters rejects with a `RangeError`. Build it from constants only: a cell value in `css` can load a remote URL. */
  css?: string;
  /** Cancels the print: the promise rejects with the signal's reason and no dialog opens. */
  signal?: AbortSignal;
};

/** What a finished {@link printGrid} printed. */
export type PrintGridResult = {
  rowCount: number;
  /** True when `maxRows` or the cell ceiling cut the output. */
  truncated: boolean;
};

let openIframe: HTMLIFrameElement | null = null;
let activeRun: AbortController | null = null;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

/** Removes the currently open print iframe and clears its fallback timer. */
function removeOpenIframe(): void {
  if (fallbackTimer !== null) {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }
  openIframe?.remove();
  openIframe = null;
}

function cutText(text: string): string {
  return text.length > MAX_CELL_TEXT ? text.slice(0, MAX_CELL_TEXT) : text;
}

function printCss(paperSize: string, orientation: "portrait" | "landscape"): string {
  return [
    `@page { size: ${paperSize} ${orientation}; margin: 12mm; }`,
    "body { font: 10pt/1.4 system-ui, sans-serif; color: #000; }",
    "h1 { font-size: 14pt; margin: 0 0 8px; }",
    "table { border-collapse: collapse; width: 100%; }",
    "thead { display: table-header-group; }",
    "tr { break-inside: avoid; }",
    "th, td { border: 1px solid #999; padding: 2px 6px; text-align: start; }",
    "th { font-weight: 600; }",
    "p { margin: 8px 0 0; }",
  ].join("\n");
}

type PrintRows = { rows: string[][]; note: string | undefined };

function loadedPrintRows(state: DataGridReadState, scope: NonNullable<PrintGridOptions["scope"]>, maxRows: number): PrintRows {
  const total = exportRowPlan(state, scope).rows.length;
  const rows = buildExportRows(state, scope, { text: "display", maxRows });
  return { rows, note: rows.length < total ? state.labels.io.printTruncated(rows.length, total) : undefined };
}

async function sourcePrintRows(state: DataGridReadState, source: ExportSource, maxRows: number, signal: AbortSignal): Promise<PrintRows> {
  const rows: string[][] = [];
  const result = await exportRows<unknown, string>(state, { source, text: "display", maxRows, signal }, (batch) => {
    let size = 0;
    for (const row of batch) {
      rows.push(row);
      for (const cell of row) size += cell.length;
    }
    return size;
  });
  if (signal.aborted) throw abortReason(signal);
  return { rows, note: result.truncated ? state.labels.io.printTruncatedSource(rows.length) : undefined };
}

/**
 * Prints the grid's rows as a plain paged table: the rows are resolved through the cell-type
 * pipeline's display text (`toDisplayText ?? toText`), built into a hidden, sandboxed iframe's
 * document with `textContent` only (no value ever passes an HTML parser), and the browser print
 * dialog is opened — its "Save as PDF" produces the PDF. Visible columns only, in view order (a `source` print under pivot prints the source columns);
 * lazy holes and hidden columns never print. `options.maxRows` caps the rows (default 10,000,
 * further cut to fit the 500,000-cell ceiling); when the cap cut the output, the table ends
 * with a truncation note. The iframe is removed on `afterprint` (with a 60 s fallback timer),
 * and a second call replaces the first, aborting its pending `source`. Without `source` the
 * dialog opens before the call returns. No-op without a DOM (SSR).
 */
export async function printGrid(gridState: DataGridReadState, options: PrintGridOptions = {}): Promise<PrintGridResult> {
  if (typeof document === "undefined") return { rowCount: 0, truncated: false };
  const state = options.source ? sourceStateOf(gridState) : gridState;
  if (options.css !== undefined && options.css.length > MAX_PRINT_CSS_LENGTH) throw new RangeError(`[data-grid-io] print css is longer than ${MAX_PRINT_CSS_LENGTH} characters`);
  removeOpenIframe();
  activeRun?.abort();
  const run = new AbortController();
  activeRun = run;
  const signal = options.signal ? AbortSignal.any([options.signal, run.signal]) : run.signal;
  try {
    const colCount = state.visibleColumns.length;
    const maxRows = Math.min(normalizeLimit(options.maxRows, DEFAULT_PRINT_MAX_ROWS), Math.floor(PRINT_CELL_CEILING / Math.max(colCount, 1)));
    const { rows, note } = options.source ? await sourcePrintRows(state, options.source, maxRows, signal) : loadedPrintRows(state, options.scope ?? "view", maxRows);
    openPrintDocument(state, options, rows, note);
    return { rowCount: rows.length, truncated: note !== undefined };
  } finally {
    if (activeRun === run) activeRun = null;
  }
}

function openPrintDocument(state: DataGridReadState, options: PrintGridOptions, rows: string[][], note: string | undefined): void {
  const includeHeaders = options.includeHeaders ?? true;
  const colCount = state.visibleColumns.length;
  const headers = buildExportHeaders(state, undefined, options.headers);
  const orientation = options.orientation ?? (colCount > 6 ? "landscape" : "portrait");
  // Untyped callers can pass any string; only the fixed map reaches the CSS.
  const requestedSize = options.paperSize ?? "A4";
  const paperSize = Object.hasOwn(PAPER_SIZE_CSS, requestedSize) ? PAPER_SIZE_CSS[requestedSize] : "A4";

  const iframe = document.createElement("iframe");
  // attribute, not the sandbox IDL property: jsdom reflects the IDL property incompletely
  iframe.setAttribute("sandbox", "allow-same-origin allow-modals");
  // zero-size and off-screen: the iframe exists only to host the print document
  iframe.style.position = "fixed";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.visibility = "hidden";
  document.body.append(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return;
  }

  doc.documentElement.dir = options.direction ?? (getComputedStyle(document.documentElement).direction === "rtl" ? "rtl" : "ltr");
  doc.title = options.title ?? "";
  const meta = doc.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = "default-src 'none'; style-src 'unsafe-inline'";
  const style = doc.createElement("style");
  style.textContent = printCss(paperSize, orientation);
  doc.head.append(meta, style);
  if (options.css) {
    const extra = doc.createElement("style");
    extra.textContent = options.css;
    doc.head.append(extra);
  }
  if (options.title) {
    const heading = doc.createElement("h1");
    heading.textContent = options.title;
    doc.body.append(heading);
  }

  const table = doc.createElement("table");
  if (includeHeaders) {
    const thead = doc.createElement("thead");
    const headerRow = doc.createElement("tr");
    for (const header of headers) {
      const th = doc.createElement("th");
      th.scope = "col";
      th.textContent = cutText(header);
      headerRow.append(th);
    }
    thead.append(headerRow);
    table.append(thead);
  }
  const tbody = doc.createElement("tbody");
  for (const row of rows) {
    const tr = doc.createElement("tr");
    for (let i = 0; i < row.length; i++) {
      const td = doc.createElement("td");
      const align = state.cellTypes[state.visibleColumns[i]!.type ?? "text"]?.align;
      if (align) td.style.textAlign = align;
      td.textContent = cutText(row[i]!);
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  doc.body.append(table);
  if (note !== undefined) {
    const noteElement = doc.createElement("p");
    noteElement.textContent = note;
    doc.body.append(noteElement);
  }

  const cleanup = () => {
    win.removeEventListener("afterprint", cleanup);
    removeOpenIframe();
  };
  win.addEventListener("afterprint", cleanup);
  fallbackTimer = setTimeout(cleanup, PRINT_FALLBACK_MS);
  openIframe = iframe;
  win.print();
}
