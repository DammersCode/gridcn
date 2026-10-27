import { type DataGridReadState } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { MAX_CELL_TEXT, buildExportHeaders, buildExportRows, exportDataIndices } from "./export-grid";

/** Default number of rows printed when `maxRows` is not given. */
const DEFAULT_PRINT_MAX_ROWS = 10_000;
/** Hard ceiling on the printed table's cell count (a multi-million-cell DOM table hangs the print dialog). */
const PRINT_CELL_CEILING = 500_000;
/** Fallback removal (ms) for the print iframe when the window's `afterprint` never fires. */
const PRINT_FALLBACK_MS = 60_000;

/** Paper sizes for {@link PrintGridOptions.pageSize}. */
export type PrintPageSize = "A3" | "A4" | "Letter" | "Legal";

/** CSS `@page` size keyword per paper size. */
const PAGE_SIZE_CSS: Record<PrintPageSize, string> = { A3: "A3", A4: "A4", Letter: "letter", Legal: "legal" };

/** Options for {@link printGrid}. */
export type PrintGridOptions = {
  /** Which rows to print; default `"view"` (the current sort and filter order). */
  scope?: "view" | "all" | "selection";
  /** Printed as an `<h1>` heading and the document title. */
  title?: string;
  /** Emit a `<thead>` header row; default `true`. */
  includeHeaders?: boolean;
  /** Paper size; default `"A4"`. */
  pageSize?: PrintPageSize;
  /** Page orientation; default: `landscape` above 6 visible columns, else `portrait`. */
  orientation?: "portrait" | "landscape";
  /** Cap on the rows printed (the header row is not counted); default 10,000, further cut by the 500,000-cell ceiling. */
  maxRows?: number;
};

let openIframe: HTMLIFrameElement | null = null;
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

function printCss(pageSize: string, orientation: "portrait" | "landscape"): string {
  return [
    `@page { size: ${pageSize} ${orientation}; margin: 12mm; }`,
    "body { font: 10pt/1.4 system-ui, sans-serif; color: #000; }",
    "h1 { font-size: 14pt; margin: 0 0 8px; }",
    "table { border-collapse: collapse; width: 100%; }",
    "thead { display: table-header-group; }",
    "tr { break-inside: avoid; }",
    "th, td { border: 1px solid #999; padding: 2px 6px; text-align: left; }",
    "th { font-weight: 600; }",
    "p { margin: 8px 0 0; }",
  ].join("\n");
}

/**
 * Prints the grid's rows as a plain paged table: the rows are resolved through the cell-type
 * pipeline's display text (`toDisplayText ?? toText`), built into a hidden, sandboxed iframe's
 * document with `textContent` only (no value ever passes an HTML parser), and the browser print
 * dialog is opened — its "Save as PDF" produces the PDF. Visible columns only, in view order;
 * lazy holes and hidden columns never print. `options.maxRows` caps the rows (default 10,000,
 * further cut to fit the 500,000-cell ceiling); when the cap cut the output, the table ends
 * with a truncation note. The iframe is removed on `afterprint` (with a 60 s fallback timer),
 * and a second call while one is open replaces the first. No-op without a DOM (SSR).
 */
export function printGrid(state: DataGridReadState, options: PrintGridOptions = {}): void {
  if (typeof document === "undefined") return;
  removeOpenIframe();

  const scope = options.scope ?? "view";
  const includeHeaders = options.includeHeaders ?? true;
  const colCount = state.visibleColumns.length;
  const maxRows = Math.min(options.maxRows ?? DEFAULT_PRINT_MAX_ROWS, Math.floor(PRINT_CELL_CEILING / Math.max(colCount, 1)));
  const total = exportDataIndices(state, scope).length;
  const rows = buildExportRows(state, scope, { text: "display", maxRows });
  const headers = buildExportHeaders(state);
  const orientation = options.orientation ?? (colCount > 6 ? "landscape" : "portrait");
  // Untyped callers can pass any string; only the fixed map reaches the CSS.
  const requestedSize = options.pageSize ?? "A4";
  const pageSize = Object.hasOwn(PAGE_SIZE_CSS, requestedSize) ? PAGE_SIZE_CSS[requestedSize] : "A4";

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

  doc.title = options.title ?? "";
  const meta = doc.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = "default-src 'none'; style-src 'unsafe-inline'";
  const style = doc.createElement("style");
  style.textContent = printCss(pageSize, orientation);
  doc.head.append(meta, style);
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
  if (rows.length < total) {
    const note = doc.createElement("p");
    note.textContent = state.labels.io.printTruncated(rows.length, total);
    doc.body.append(note);
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
