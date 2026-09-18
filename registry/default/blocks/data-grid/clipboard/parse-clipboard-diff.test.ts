import { describe, expect, it } from "vitest";
import { parseClipboardText } from "./parse-clipboard";

/**
 * Differential test for the slice-based `parseClipboardText` rewrite (2026-08-20 perf fix,
 * data-pipeline audit lead 4): the char-by-char `field += ch` original kept here verbatim, asserted
 * byte-identical to the new implementation across a matrix of field shapes. Proves the 3-4x speedup
 * (274ms -> 84ms measured at 20MB TSV) didn't change output.
 */

/** The pre-rewrite implementation, unchanged, for A/B comparison only. */
function parseClipboardTextOriginal(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldPending = false;
  let i = 0;
  const len = text.length;

  const endField = () => {
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
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
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
      endRow();
      i += text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    fieldPending = true;
    i += 1;
  }

  if (fieldPending || row.length > 0) {
    endRow();
  }

  return rows;
}

/** Builds a TSV/CSV-with-quoting payload from a 2D field grid, quoting any field that needs it. */
function toTsv(grid: string[][]): string {
  return grid
    .map((row) =>
      row
        .map((field) => {
          const needsQuoting = /["\t\r\n]/.test(field);
          return needsQuoting ? `"${field.replace(/"/g, '""')}"` : field;
        })
        .join("\t"),
    )
    .join("\n");
}

function assertSameParse(text: string): void {
  expect(parseClipboardText(text)).toEqual(parseClipboardTextOriginal(text));
}

describe("parseClipboardText: differential vs pre-rewrite implementation", () => {
  const fieldVariants: string[] = [
    "",
    "plain",
    " leading space",
    "trailing space ",
    '"',
    '""',
    'say "hi"',
    "has\ttab",
    "has\nnewline",
    "has\r\ncrlf",
    "has\rlonecr",
    "日本語",
    "emoji 😀🎉",
    "café",
    "a".repeat(500),
    "mixed \"quote\" and\ttab and\nnewline",
    "\t\t\t",
    "\n\n\n",
  ];

  for (const field of fieldVariants) {
    it(`matches for a single-field row: ${JSON.stringify(field)}`, () => {
      assertSameParse(toTsv([[field]]));
    });
  }

  it("matches across every field variant combined into rows of varying width", () => {
    const grid: string[][] = [];
    for (let i = 0; i < fieldVariants.length; i += 3) {
      grid.push(fieldVariants.slice(i, i + 3));
    }
    assertSameParse(toTsv(grid));
  });

  it("matches for raw (non-quoted-builder) payloads with mixed row separators", () => {
    const cases = [
      "a\tb\nc\td",
      "a\tb\r\nc\td\r\n",
      "a\tb\rc\td",
      "",
      "\n",
      "\t",
      'a\t"b\tc"\td',
      '"a""b"\tc',
      '"a\nb"\t"c\r\nd"',
      "a\t\tb\t",
      '""\t""',
      "no-trailing-newline",
      "trailing-newline\n",
      "😀\t日本語\ncafé\t\"quoted 😀\"",
    ];
    for (const text of cases) assertSameParse(text);
  });

  it("matches for a large generated grid (many rows/cols, deterministic pseudo-random content)", () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]!;

    const grid: string[][] = [];
    for (let r = 0; r < 200; r++) {
      const row: string[] = [];
      for (let c = 0; c < 10; c++) {
        row.push(pick(fieldVariants));
      }
      grid.push(row);
    }
    assertSameParse(toTsv(grid));
  });
});
