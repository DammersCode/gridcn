const NEEDS_QUOTING = /[\t\n\r"]/;

/** Escapes a single TSV field per Excel quoting rules (quote wrap + doubled internal quotes). */
function quoteTsvField(cell: string): string {
  if (!NEEDS_QUOTING.test(cell)) return cell;
  return `"${cell.replace(/"/g, '""')}"`;
}

/** Escapes text and preserves whitespace fidelity for Excel/Sheets: tabs -> 4 spaces, runs of >=2 spaces wrapped in a span. */
function escapeHtmlText(value: string): string {
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
export function serializeCells(cells: string[][]): { text: string; html: string } {
  const text = cells.map((row) => row.map(quoteTsvField).join("\t")).join("\n");

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
