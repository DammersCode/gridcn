import { describe, it, expect } from "vitest";
import { serializeCells, sanitizeFormulaCell } from "./serialize-cells";
import { parseClipboardHtml, parseClipboardText, parseClipboard } from "./parse-clipboard";

describe("serializeCells", () => {
  it("joins rows with \\n and cells with \\t", () => {
    const { text } = serializeCells([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(text).toBe("a\tb\nc\td");
  });

  it("quotes cells containing a tab", () => {
    const { text } = serializeCells([["a\tb"]]);
    expect(text).toBe('"a\tb"');
  });

  it("quotes cells containing a newline", () => {
    const { text } = serializeCells([["a\nb"]]);
    expect(text).toBe('"a\nb"');
  });

  it("quotes and doubles internal quotes", () => {
    const { text } = serializeCells([['say "hi"']]);
    expect(text).toBe('"say ""hi"""');
  });

  it("does not quote cells with leading or trailing whitespace (Excel never does)", () => {
    expect(serializeCells([[" a"]]).text).toBe(" a");
    expect(serializeCells([["a "]]).text).toBe("a ");
  });

  it("does not quote plain cells", () => {
    expect(serializeCells([["hello"]]).text).toBe("hello");
    expect(serializeCells([[""]]).text).toBe("");
  });

  it("produces an html table with raw attribute and escaped display text", () => {
    const { html } = serializeCells([["a\nb"]]);
    expect(html).toContain("<table>");
    expect(html).toContain('data-gridcn-raw="a\nb"'); // raw attr keeps literal newline
    expect(html).toContain("a<br>b");
  });

  it("html-escapes special characters in display text and attribute", () => {
    const { html } = serializeCells([['<b>&"</b>']]);
    expect(html).toContain('data-gridcn-raw="&lt;b&gt;&amp;&quot;&lt;/b&gt;"');
    expect(html).toContain("&lt;b&gt;&amp;&quot;&lt;/b&gt;");
  });

  it("converts tabs to 4 spaces (wrapped as a whitespace-run span) in html display text", () => {
    const { html } = serializeCells([["a\tb"]]);
    expect(html).toContain("a<span>    </span>b");
    expect(html).not.toContain("a\tb</td>");
  });

  it("wraps runs of >=2 spaces in a span so paste preserves them", () => {
    const { html } = serializeCells([["c  d"]]);
    expect(html).toContain("c<span>  </span>d");
  });

  it("does not wrap a single space", () => {
    const { html } = serializeCells([["c d"]]);
    expect(html).toContain("<td data-gridcn-raw=\"c d\">c d</td>");
  });

  it("keeps the text payload byte-identical by default (the grid's own copy/paste round-trip)", () => {
    expect(serializeCells([["=HYPERLINK()", "-5"]]).text).toBe('=HYPERLINK()\t-5');
  });

  it("prefixes formula-like cells with a single quote when sanitizeFormulas is on", () => {
    const { text } = serializeCells([["=HYPERLINK()", "-5", "-5abc", "\tx"]], { sanitizeFormulas: true });
    // the tab field is TSV-quoted by quoteTsvField
    expect(text).toBe("'=HYPERLINK()\t-5\t'-5abc\t\"'\tx\"");
  });
});

describe("serializeCells with sanitizeFormulas", () => {
  it("neutralizes the HTML cell text too, and a grid paste still reads back the raw value", () => {
    const { html } = serializeCells([['=HYPERLINK("x")', "+A1", "-5"]], { sanitizeFormulas: true });
    const cells = new DOMParser().parseFromString(html, "text/html").querySelectorAll("td");

    expect(Array.from(cells, (cell) => cell.textContent)).toEqual([`'=HYPERLINK("x")`, "'+A1", "-5"]);
    expect(parseClipboardHtml(html)).toEqual([['=HYPERLINK("x")', "+A1", "-5"]]);
  });

  it("still rejects a raw attribute whose cell text is neither the value nor its sanitized form", () => {
    const html = `<table><tbody><tr><td data-gridcn-raw="=EVIL()">'=SAFE()</td></tr></tbody></table>`;
    expect(parseClipboardHtml(html)).toEqual([["'=SAFE()"]]);
  });
});

describe("sanitizeFormulaCell", () => {
  it("prefixes a leading formula character with a single quote", () => {
    expect(sanitizeFormulaCell('=HYPERLINK("http://x")')).toBe("'=HYPERLINK(\"http://x\")");
    expect(sanitizeFormulaCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(sanitizeFormulaCell("-5abc")).toBe("'-5abc");
    expect(sanitizeFormulaCell("\tx")).toBe("'" + "\tx");
    expect(sanitizeFormulaCell("\rx")).toBe("'" + "\rx");
  });

  it("prefixes a leading plus, which Excel also runs as a formula", () => {
    expect(sanitizeFormulaCell('+HYPERLINK("x")')).toBe(`'+HYPERLINK("x")`);
    expect(sanitizeFormulaCell("+1+cmd|' /C calc'!A0")).toBe("'+1+cmd|' /C calc'!A0");
  });

  it("leaves plain numbers and other text untouched", () => {
    expect(sanitizeFormulaCell("-5")).toBe("-5");
    expect(sanitizeFormulaCell("+5")).toBe("+5");
    expect(sanitizeFormulaCell("1.5")).toBe("1.5");
    expect(sanitizeFormulaCell("text")).toBe("text");
    expect(sanitizeFormulaCell("")).toBe("");
  });
});

describe("parseClipboardHtml", () => {
  it("returns null when there is no table", () => {
    expect(parseClipboardHtml("<div>no table here</div>")).toBeNull();
  });

  it("ignores a data-gridcn-raw that disagrees with the node text", () => {
    const html =
      '<table><tbody><tr><td data-gridcn-raw="raw-value">Display Value</td></tr></tbody></table>';
    expect(parseClipboardHtml(html)).toEqual([["Display Value"]]);
  });

  it("ignores a data-gridcn-raw hiding a formula-looking value behind plain text", () => {
    const html = '<table><tr><td data-gridcn-raw="=HYPERLINK(&quot;http://x&quot;)">1</td></tr></table>';
    expect(parseClipboardHtml(html)).toEqual([["1"]]);
  });

  it("trusts a data-gridcn-raw that is the grid's own serialization (round-trip)", () => {
    const { html } = serializeCells([["a\nb"], ["a\tb"], ["c  d"], ["plain"]]);
    expect(parseClipboardHtml(html)).toEqual([
      ["a\nb"],
      ["a\tb"],
      ["c  d"],
      ["plain"],
    ]);
  });

  it.each([
    ["a non-breaking space", "a\u00a0b"],
    ["a lone carriage return", "a\rb"],
    ["a CRLF pair", "a\r\nb"],
    ["a tab next to a non-breaking space", "a\t\u00a0b"],
    ["a formula-looking value with a carriage return", "=1\r+2"],
  ])("round-trips %s through the grid's own serialization", (_name, value) => {
    const plain = serializeCells([[value]]).html;
    expect(parseClipboardHtml(plain)).toEqual([[value]]);
    const sanitized = serializeCells([[value]], { sanitizeFormulas: true }).html;
    expect(parseClipboardHtml(sanitized)).toEqual([[value]]);
  });

  it("falls back to textContent with <br> as newline when no data attrs (real Excel paste)", () => {
    const html =
      "<html><body><table><tr><td>line1<br>line2</td><td>plain</td></tr></table></body></html>";
    expect(parseClipboardHtml(html)).toEqual([["line1\nline2", "plain"]]);
  });

  it("handles nested spans without data attrs", () => {
    const html =
      "<table><tr><td><span>hello <b>world</b></span></td></tr></table>";
    expect(parseClipboardHtml(html)).toEqual([["hello world"]]);
  });

  it("parses multiple rows and th cells", () => {
    const html =
      "<table><tr><th>Header1</th><th>Header2</th></tr><tr><td>a</td><td>b</td></tr></table>";
    expect(parseClipboardHtml(html)).toEqual([
      ["Header1", "Header2"],
      ["a", "b"],
    ]);
  });

  it("finds the first table if multiple are present", () => {
    const html = "<table><tr><td>first</td></tr></table><table><tr><td>second</td></tr></table>";
    expect(parseClipboardHtml(html)).toEqual([["first"]]);
  });

  it("does not descend into a nested table's own rows/cells", () => {
    const html =
      "<table><tr><td>outer<table><tr><td>inner</td></tr></table></td></tr></table>";
    expect(parseClipboardHtml(html)).toEqual([["outerinner"]]);
  });

  it("separates block-level children (e.g. <p> per line) with a newline", () => {
    const html = "<table><tr><td><p>line1</p><p>line2</p></td></tr></table>";
    expect(parseClipboardHtml(html)).toEqual([["line1\nline2"]]);
  });
});

describe("parseClipboardText", () => {
  it("splits simple TSV rows and cells", () => {
    expect(parseClipboardText("a\tb\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("drops a trailing empty row from a final newline", () => {
    expect(parseClipboardText("a\tb\n")).toEqual([["a", "b"]]);
  });

  it("handles Excel-style CRLF row separators", () => {
    expect(parseClipboardText("a\tb\r\nc\td\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("treats tabs and newlines inside quotes as literal", () => {
    expect(parseClipboardText('"a\tb"\tc')).toEqual([["a\tb", "c"]]);
    expect(parseClipboardText('"a\nb"\tc')).toEqual([["a\nb", "c"]]);
  });

  it("unescapes doubled quotes inside a quoted field", () => {
    expect(parseClipboardText('"say ""hi"""')).toEqual([['say "hi"']]);
  });

  it("handles empty cells and empty input", () => {
    expect(parseClipboardText("a\t\tb")).toEqual([["a", "", "b"]]);
    expect(parseClipboardText("")).toEqual([]);
  });

  it("handles unicode content", () => {
    expect(parseClipboardText("héllo\t日本語\n😀\tb")).toEqual([
      ["héllo", "日本語"],
      ["😀", "b"],
    ]);
  });

  it("handles a lone \\r as a row separator", () => {
    expect(parseClipboardText("a\tb\rc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("parses a standalone quoted empty field", () => {
    expect(parseClipboardText('""')).toEqual([[""]]);
  });

  it("keeps a trailing row ending in a quoted empty field", () => {
    expect(parseClipboardText('"a"\n""')).toEqual([["a"], [""]]);
  });

  it("handles CRLF inside a quoted field as literal", () => {
    expect(parseClipboardText('"a\r\nb"\tc')).toEqual([["a\r\nb", "c"]]);
  });
});

describe("parseClipboard text bound", () => {
  it("returns no cells for a text payload far larger than maxCells cells can hold", () => {
    const giantField = "x".repeat(2 * 1024 * 1024);
    expect(parseClipboard({ text: giantField }, 10)).toEqual([]);
  });

  it("parses a long cell below the bound", () => {
    const longField = "x".repeat(50_000);
    expect(parseClipboard({ text: `${longField}\tb` }, 10)).toEqual([[longField, "b"]]);
  });
});

describe("parseClipboard", () => {
  it("prefers html when it yields a table", () => {
    const { html } = serializeCells([["from-html"]]);
    const text = "from-text";
    expect(parseClipboard({ html, text })).toEqual([["from-html"]]);
  });

  it("falls back to text when html has no table", () => {
    const html = "<div>no table</div>";
    const text = "a\tb";
    expect(parseClipboard({ html, text })).toEqual([["a", "b"]]);
  });

  it("falls back to text when html is absent", () => {
    expect(parseClipboard({ text: "a\tb" })).toEqual([["a", "b"]]);
  });

  it("returns an empty array when neither html nor text is usable", () => {
    expect(parseClipboard({})).toEqual([]);
    expect(parseClipboard({ html: "<div>none</div>" })).toEqual([]);
  });

  it("falls back to text when html has a table but no rows", () => {
    expect(parseClipboard({ html: "<table></table>", text: "a\tb" })).toEqual([["a", "b"]]);
  });
});

describe("round-trip: serializeCells -> parseClipboardText", () => {
  const cases: string[][][] = [
    [["simple", "cells"]],
    [["multi\nline", "cell"]],
    [["has\ttab", "has\"quote\""]],
    [["  leading and trailing  ", ""]],
    [["日本語", "emoji 😀", "café"]],
    [
      ["a", "b", "c"],
      ["1", "2", "3"],
    ],
  ];

  for (const grid of cases) {
    it(`round-trips ${JSON.stringify(grid)}`, () => {
      const { text } = serializeCells(grid);
      expect(parseClipboardText(text)).toEqual(grid);
    });
  }
});

describe("round-trip: serializeCells -> parseClipboardHtml", () => {
  const cases: string[][][] = [
    [["simple", "cells"]],
    [["multi\nline", "cell"]],
    [["has\ttab", "has\"quote\""]],
    [["日本語", "emoji 😀", "café"]],
    [["", "empty next door"]],
  ];

  for (const grid of cases) {
    it(`round-trips ${JSON.stringify(grid)}`, () => {
      const { html } = serializeCells(grid);
      expect(parseClipboardHtml(html)).toEqual(grid);
    });
  }
});
