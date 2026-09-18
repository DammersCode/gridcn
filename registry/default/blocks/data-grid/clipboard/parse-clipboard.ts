const BLOCK_TAGS = new Set(["P", "DIV", "LI"]);

/** Converts a table cell's DOM content to text, treating `<br>` as a newline and separating block-level children (e.g. Apple Numbers' `<p>` per line) with one. */
function cellNodeToText(cell: Element): string {
  const raw = cell.getAttribute("data-gridcn-raw");
  if (raw !== null) return raw;

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
 * Prefers each cell's `data-gridcn-raw` attribute, falling back to text content with `<br>`
 * treated as a newline. Returns null when no table is present.
 */
export function parseClipboardHtml(html: string): string[][] | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (!table) return null;

  return Array.from(table.rows).map((row) =>
    Array.from(row.cells).map((cell) => cellNodeToText(cell)),
  );
}

/**
 * Parses a clipboard `text/plain` TSV payload with Excel-style quoting: a field starting with
 * `"` is quoted, `""` is an escaped quote, and tabs/newlines inside quotes are literal.
 * Handles both `\r\n` and `\n` row separators; a trailing empty row from a final newline is dropped.
 */
export function parseClipboardText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // tracks whether the current field has any content (incl. a closed "") so it isn't mistaken for "nothing pending"
  let fieldPending = false;
  let i = 0;
  const len = text.length;
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
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < len) {
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

  // final field/row, unless the input ended exactly on a row separator (trailing newline)
  if (fieldPending || row.length > 0) {
    endRow();
  }

  return rows;
}

/**
 * Produces a 2D string grid from clipboard data, preferring the HTML table representation
 * and falling back to TSV plain text. Returns an empty array when neither is usable.
 */
export function parseClipboard(data: { html?: string; text?: string }): string[][] {
  if (data.html) {
    const fromHtml = parseClipboardHtml(data.html);
    if (fromHtml && fromHtml.length > 0) return fromHtml;
  }
  if (data.text !== undefined) {
    return parseClipboardText(data.text);
  }
  return [];
}
