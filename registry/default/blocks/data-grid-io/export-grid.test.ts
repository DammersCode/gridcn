import { describe, expect, it, vi } from "vitest";
import type { CellType, ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { buildExportHeaders, buildExportRows, buildXlsx, downloadBlob, exportGrid, quoteCsvField, rowsToCsv, type ExportGridOptions } from "./export-grid";
import { parseImportFile } from "./parse-import-file";
import { listZip, XLSX_TYPE } from "./xlsx-fixtures.test-helper";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/data-grid-sdk";

type Row = { id: string; name: string; note: string };

const textCellType: CellType<Row, string> = {
  Cell: () => null,
  Editor: () => null,
  toText: (value) => value ?? "",
  fromText: (text) => text,
  clearValue: () => "",
  isEmpty: (value) => value === "",
};

function makeColumns(): ColumnDef<Row, unknown>[] {
  return [
    { id: "name", header: "Name", accessorKey: "name", type: "text" },
    { id: "note", header: "Note", accessorKey: "note", type: "text" },
  ];
}

function makeState(overrides: Partial<DataGridStoreState> = {}): DataGridStoreState {
  const data: Row[] = [
    { id: "1", name: "Alice", note: 'has "quotes"' },
    { id: "2", name: "Bob", note: "line1\nline2" },
    { id: "3", name: "Ünïcödé", note: "comma, here" },
  ];
  const columns = makeColumns();
  return {
    data,
    visibleColumns: columns as never,
    viewIndex: [0, 1, 2],
    cellTypes: { text: textCellType as never },
    ...overrides,
  } as unknown as DataGridStoreState;
}

describe("quoteCsvField", () => {
  it("leaves plain fields unquoted", () => {
    expect(quoteCsvField("plain", ",")).toBe("plain");
  });

  it("quotes a field containing the delimiter", () => {
    expect(quoteCsvField("a,b", ",")).toBe('"a,b"');
  });

  it("quotes and doubles internal quotes", () => {
    expect(quoteCsvField('has "quotes"', ",")).toBe('"has ""quotes"""');
  });

  it("quotes fields with embedded newlines", () => {
    expect(quoteCsvField("line1\nline2", ",")).toBe('"line1\nline2"');
  });

  it("does not quote a comma when the delimiter is a semicolon", () => {
    expect(quoteCsvField("a,b", ";")).toBe("a,b");
  });

  it("preserves umlauts/unicode without escaping", () => {
    expect(quoteCsvField("Ünïcödé", ",")).toBe("Ünïcödé");
  });
});

describe("rowsToCsv round-trip", () => {
  it("round-trips commas, quotes, newlines, and umlauts through papaparse", async () => {
    const Papa = await import("papaparse");
    const rows = [
      ["Name", "Note"],
      ["Alice", 'has "quotes"'],
      ["Bob", "line1\nline2"],
      ["Ünïcödé", "comma, here"],
    ];
    const csv = rowsToCsv(rows, ",");
    const parsed = Papa.default.parse<string[]>(csv, { skipEmptyLines: true });
    expect(parsed.data).toEqual(rows);
  });

  it("neutralizes formula-like fields by default and keeps them raw with sanitizeFormulas false", () => {
    const rows = [["=1+1", "+cmd", "-5", "plain"]];
    expect(rowsToCsv(rows, ",")).toBe("'=1+1,'+cmd,-5,plain");
    expect(rowsToCsv(rows, ",", false)).toBe("=1+1,+cmd,-5,plain");
  });
});

describe("buildExportRows with a throwing cell type", () => {
  it("exports the safe value text instead of throwing", () => {
    const throwing = { ...textCellType, toText: () => { throw new Error("hostile"); } };
    const state = makeState({ cellTypes: { text: throwing as never } });
    expect(buildExportRows(state, "view")[0]).toEqual(["Alice", 'has "quotes"']);
  });
});

describe("buildExportRows / buildExportHeaders", () => {
  it("serializes headers from column.header", () => {
    expect(buildExportHeaders(makeState())).toEqual(["Name", "Note"]);
  });

  it("prefers headerText over a string header when both are set", () => {
    const state = makeState({ visibleColumns: [{ id: "name", header: "Name", headerText: "Full Name", accessorKey: "name", type: "text" }] as never });
    expect(buildExportHeaders(state)).toEqual(["Full Name"]);
  });

  it("falls back to the column id when header is not a string and there is no headerText", () => {
    const state = makeState({ visibleColumns: [{ id: "name", header: () => null, accessorKey: "name", type: "text" }] as never });
    expect(buildExportHeaders(state)).toEqual(["name"]);
  });

  it("resolves values via accessorFn when the column defines one, over accessorKey", () => {
    const state = makeState({
      visibleColumns: [{ id: "full", header: "Full", accessorFn: (row: Row) => `${row.name}!`, type: "text" }] as never,
    });
    expect(buildExportRows(state, "view")[0]).toEqual(["Alice!"]);
  });

  it("emits an empty cell when the column's type has no registered cell type", () => {
    const state = makeState({
      visibleColumns: [{ id: "name", header: "Name", accessorKey: "name", type: "missing-type" }] as never,
    });
    expect(buildExportRows(state, "view")[0]).toEqual([""]);
  });

  it("serializes cell values through the cell type's toText, never raw values", () => {
    const toTextSpy = vi.fn((value: string) => `[${value}]`);
    const state = makeState({ cellTypes: { text: { ...textCellType, toText: toTextSpy } as never } });
    const rows = buildExportRows(state, "view");
    expect(toTextSpy).toHaveBeenCalled();
    expect(rows[0]).toEqual(["[Alice]", '[has "quotes"]']);
  });

  it("defaults to the export text and uses the display text with options.text: 'display'", () => {
    const state = makeState({
      cellTypes: {
        text: {
          ...textCellType,
          toText: (value: string) => `raw:${value}`,
          toDisplayText: (value: string) => `fmt(${value})`,
        } as never,
      },
      visibleColumns: [{ id: "name", header: "Name", accessorKey: "name", type: "text" }] as never,
    });
    expect(buildExportRows(state, "view")[0]).toEqual(["raw:Alice"]);
    expect(buildExportRows(state, "view", { text: "export" })[0]).toEqual(["raw:Alice"]);
    expect(buildExportRows(state, "view", { text: "display" })[0]).toEqual(["fmt(Alice)"]);
  });

  it("scope 'view' walks viewIndex (respects an active sort)", () => {
    // reversed order simulates a descending sort on `name`.
    const state = makeState({ viewIndex: [2, 1, 0] });
    const rows = buildExportRows(state, "view");
    expect(rows.map((r) => r[0])).toEqual(["Ünïcödé", "Bob", "Alice"]);
  });

  it("scope 'all' ignores viewIndex/sort and walks data order", () => {
    const state = makeState({ viewIndex: [2, 1, 0] });
    const rows = buildExportRows(state, "all");
    expect(rows.map((r) => r[0])).toEqual(["Alice", "Bob", "Ünïcödé"]);
  });

  it("scope 'selection' exports the rows a cell range covers, in view order", () => {
    const state = makeState({
      selection: {
        rows: { hasIndex: () => false, toArray: () => [] },
        current: { range: { x: 0, y: 1, width: 1, height: 2 }, rangeStack: [] },
      } as never,
    });
    const rows = buildExportRows(state, "selection");
    expect(rows.map((r) => r[0])).toEqual(["Bob", "Ünïcödé"]);
  });

  it("scope 'selection' reads ctrl-click stacked ranges too", () => {
    const state = makeState({
      selection: {
        rows: { hasIndex: () => false, toArray: () => [] },
        current: {
          range: { x: 0, y: 0, width: 1, height: 1 },
          rangeStack: [{ x: 0, y: 2, width: 1, height: 1 }],
        },
      } as never,
    });
    const rows = buildExportRows(state, "selection");
    expect(rows.map((r) => r[0])).toEqual(["Alice", "Ünïcödé"]);
  });

  it("scope 'selection' reads the rows channel (checkbox markers) too", () => {
    const state = makeState({
      selection: { rows: { hasIndex: () => false, toArray: () => [0] }, current: null } as never,
    });
    const rows = buildExportRows(state, "selection");
    expect(rows.map((r) => r[0])).toEqual(["Alice"]);
  });

  it("scope 'selection' follows view order under a sort, not data order", () => {
    const state = makeState({
      viewIndex: [2, 1, 0],
      selection: {
        rows: { hasIndex: () => false, toArray: () => [] },
        current: { range: { x: 0, y: 0, width: 1, height: 2 }, rangeStack: [] },
      } as never,
    });
    const rows = buildExportRows(state, "selection");
    expect(rows.map((r) => r[0])).toEqual(["Ünïcödé", "Bob"]);
  });

  it("scope 'selection' exports nothing when nothing is selected", () => {
    const state = makeState({ selection: { rows: { hasIndex: () => false, toArray: () => [] }, current: null } as never });
    expect(buildExportRows(state, "selection")).toEqual([]);
  });

  it("skips lazy holes (undefined rows) in every scope without calling accessors on them", () => {
    // sparse array: holes at indices 1 and 2, as data-grid-lazy produces.
    const data = new Array<Row>(4);
    data[0] = { id: "1", name: "Alice", note: "n1" };
    data[3] = { id: "4", name: "Dora", note: "n4" };
    const columns = [
      { id: "name", header: "Name", accessorKey: "name", type: "text" },
      { id: "shout", header: "Shout", accessorFn: (row: Row) => `${row.name}!`, type: "text" },
    ] as never;
    const state = makeState({ data, viewIndex: [0, 1, 2, 3], visibleColumns: columns });
    expect(buildExportRows(state, "view")).toEqual([["Alice", "Alice!"], ["Dora", "Dora!"]]);
    expect(buildExportRows(state, "all")).toEqual([["Alice", "Alice!"], ["Dora", "Dora!"]]);
    const selectionState = makeState({
      data,
      viewIndex: [0, 1, 2, 3],
      visibleColumns: columns,
      selection: {
        rows: { hasIndex: () => false, toArray: () => [] },
        current: { range: { x: 0, y: 0, width: 2, height: 4 }, rangeStack: [] },
      } as never,
    });
    expect(buildExportRows(selectionState, "selection")).toEqual([["Alice", "Alice!"], ["Dora", "Dora!"]]);
  });
});

describe("downloadBlob", () => {
  it("creates an object URL, clicks a temporary (DOM-attached) anchor, and defers the revoke", () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

    const clickSpy = vi.fn();
    const anchor = document.createElement("a");
    anchor.click = clickSpy;
    const createElementSpy = vi.spyOn(document, "createElement").mockReturnValue(anchor);

    downloadBlob(new Blob(["x"]), "test.csv");

    expect(createObjectURL).toHaveBeenCalled();
    expect(anchor.download).toBe("test.csv");
    expect(clickSpy).toHaveBeenCalled();
    // Firefox/Safari read the blob URL asynchronously after click() — appending to the DOM and not
    // revoking on the same tick is what keeps the download alive there (unreachable in this jsdom test).
    expect(anchor.isConnected).toBe(false); // removed again right after click(), once queued
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    createElementSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});

describe("exportGrid — includeHeaders", () => {
  it("omits the header row when includeHeaders is false", async () => {
    const createObjectURL = vi.fn((blob: Blob) => {
      blob.text().then((text) => {
        capturedCsv = text;
      });
      return "blob:mock-url";
    });
    let capturedCsv = "";
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    const anchor = document.createElement("a");
    anchor.click = vi.fn();
    vi.spyOn(document, "createElement").mockReturnValue(anchor);

    await exportGrid(makeState(), { format: "csv", includeHeaders: false });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(capturedCsv).not.toContain("Name");
    expect(capturedCsv).toContain("Alice");

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});

describe("exportGrid — CSV BOM", () => {
  // blob.text() STRIPS a UTF-8 BOM during decoding, so the presence check must happen at byte level
  // (BOM = EF BB BF).
  async function captureCsv(options: ExportGridOptions): Promise<{ bomBytes: number[]; text: string }> {
    let bomBytes: number[] = [];
    let text = "";
    const createObjectURL = vi.fn((blob: Blob) => {
      void blob.arrayBuffer().then((buf) => {
        const bytes = new Uint8Array(buf);
        bomBytes = [bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0];
        text = new TextDecoder("utf-8").decode(buf);
      });
      return "blob:mock-url";
    });
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    const anchor = document.createElement("a");
    anchor.click = vi.fn();
    vi.spyOn(document, "createElement").mockReturnValue(anchor);
    try {
      await exportGrid(makeState(), options);
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { bomBytes, text };
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  }

  it("prefixes the CSV with a UTF-8 BOM by default (Excel opens UTF-8 correctly)", async () => {
    const { bomBytes, text } = await captureCsv({ format: "csv" });
    expect(bomBytes).toEqual([0xef, 0xbb, 0xbf]);
    expect(text).toContain("Name,Note");
  });

  it("omits the BOM when csvBom is false", async () => {
    const { bomBytes, text } = await captureCsv({ format: "csv", csvBom: false });
    expect(bomBytes[0]).not.toBe(0xef);
    expect(text).toContain("Name,Note");
  });
});

describe("exportGrid — formula sanitizing", () => {
  async function captureCsv(options: ExportGridOptions): Promise<string> {
    let text = "";
    const createObjectURL = vi.fn((blob: Blob) => {
      void blob.text().then((value) => {
        text = value;
      });
      return "blob:mock-url";
    });
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    const anchor = document.createElement("a");
    anchor.click = vi.fn();
    vi.spyOn(document, "createElement").mockReturnValue(anchor);
    try {
      const attackState = makeState({
        data: [
          { id: "1", name: "-5", note: '=HYPERLINK("http://x")' },
          { id: "2", name: "-5abc", note: "@SUM(A1)" },
          { id: "3", name: "ok", note: "normal" },
        ],
      });
      await exportGrid(attackState, { csvBom: false, ...options });
      await new Promise((resolve) => setTimeout(resolve, 0));
      return text;
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  }

  it("neutralizes formula-like cells by default while -5 stays a number", async () => {
    const csv = await captureCsv({ format: "csv" });
    expect(csv).toContain('-5,"\'=HYPERLINK(""http://x"")"');
    expect(csv).toContain("'@SUM(A1)");
    expect(csv).toContain("'-5abc");
    expect(csv).toContain("ok,normal");
  });

  it("emits the raw formula string when sanitizeFormulas is false", async () => {
    const csv = await captureCsv({ format: "csv", sanitizeFormulas: false });
    expect(csv).toContain('"=HYPERLINK(""http://x"")"');
    expect(csv).not.toContain("'@SUM");
  });
});

function stubDownload(): void {
  // a subclass keeps `new URL()` working for the module loader while the download is stubbed
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => "blob:mock-url"), revokeObjectURL: vi.fn() }));
  const anchor = document.createElement("a");
  anchor.click = vi.fn();
  vi.spyOn(document, "createElement").mockReturnValue(anchor);
}

describe("exportGrid lazy xlsx loading", () => {
  it("loads hucre only when an xlsx export runs, never for a csv export", async () => {
    vi.resetModules();
    const hucreLoaded = vi.fn();
    vi.doMock("hucre/xlsx", async (importOriginal) => {
      hucreLoaded();
      return importOriginal();
    });
    const { exportGrid: freshExportGrid } = await import("./export-grid");
    stubDownload();

    await freshExportGrid(makeState(), { format: "csv" });
    expect(hucreLoaded).not.toHaveBeenCalled();

    await freshExportGrid(makeState(), { format: "xlsx" });
    expect(hucreLoaded).toHaveBeenCalledTimes(1);

    vi.doUnmock("hucre/xlsx");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});

describe("exportGrid — xlsx builds the table once", () => {
  it("calls toText exactly once per cell for an xlsx export", async () => {
    stubDownload();
    const toTextSpy = vi.fn((value: string) => value ?? "");
    const state = makeState({ cellTypes: { text: { ...textCellType, toText: toTextSpy } as never } });

    await exportGrid(state, { format: "xlsx" });

    // 3 rows x 2 columns: a double table build would call toText 12 times instead of 6.
    expect(toTextSpy).toHaveBeenCalledTimes(6);

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("exports a CSV named export.csv when called with no options", async () => {
    const createObjectURL = vi.fn(() => "blob:mock-url");
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    const anchor = document.createElement("a");
    anchor.click = vi.fn();
    vi.spyOn(document, "createElement").mockReturnValue(anchor);

    await exportGrid(makeState());

    expect(anchor.download).toBe("export.csv");

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});

describe("buildXlsx", () => {
  it("resolves with an xlsx Blob whose single sheet is named per workbookName, defaulting to 'Sheet1'", async () => {
    const blob = await buildXlsx(makeState());
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe(XLSX_TYPE);
    await expect(parseImportFile(new File([blob], "export.xlsx"))).resolves.toMatchObject({ sheetNames: ["Sheet1"] });

    const named = await buildXlsx(makeState(), { workbookName: "Q3 Data" });
    await expect(parseImportFile(new File([named], "export.xlsx"))).resolves.toMatchObject({ sheetNames: ["Q3 Data"] });
  });

  it("writes every cell as a string, never a formula, and round-trips the text unchanged", async () => {
    const data = [
      { id: "1", name: "=1+1", note: '=HYPERLINK("http://x")' },
      { id: "2", name: "00123", note: "+cmd|' /C calc'!A0" },
      { id: "3", name: "1e5", note: "TRUE" },
    ];
    const blob = await buildXlsx(makeState({ data }));

    const sheetXml = new TextDecoder().decode(listZip(new Uint8Array(await blob.arrayBuffer())).find((entry) => entry.name === "xl/worksheets/sheet1.xml")?.data);
    expect(sheetXml).not.toMatch(/<f[ >]/);
    const parsed = await parseImportFile(new File([blob], "export.xlsx"));
    expect(parsed.rows).toEqual([["Name", "Note"], ...data.map((row) => [row.name, row.note])]);
  });

  it("cuts cell text to the 32,767-character Excel limit", async () => {
    const data = [{ id: "1", name: "x".repeat(40_000), note: "short" }];
    const blob = await buildXlsx(makeState({ data }));
    const parsed = await parseImportFile(new File([blob], "export.xlsx"));
    expect(parsed.rows[1]![0]).toBe("x".repeat(32_767));
    expect(parsed.rows[1]![1]).toBe("short");
  });

  it("rejects a workbookName that Excel does not accept as a sheet name", async () => {
    await expect(buildXlsx(makeState(), { workbookName: "Q3/Q4" })).rejects.toThrow();
    await expect(buildXlsx(makeState(), { workbookName: "x".repeat(32) })).rejects.toThrow();
  });

  it("compresses every part of the workbook", async () => {
    const blob = await buildXlsx(makeState());

    const entries = listZip(new Uint8Array(await blob.arrayBuffer()));
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(entry, entry.name).toMatchObject({ method: 8 });
  });
});

describe("exportGrid — maxRows", () => {
  it("truncates data rows to maxRows and dev-warns when the scope exceeds it", async () => {
    let capturedCsv = "";
    const createObjectURL = vi.fn((blob: Blob) => {
      blob.text().then((text) => {
        capturedCsv = text;
      });
      return "blob:mock-url";
    });
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    const anchor = document.createElement("a");
    anchor.click = vi.fn();
    vi.spyOn(document, "createElement").mockReturnValue(anchor);
    const warnSpy = vi.spyOn(console, "warn");

    try {
      await exportGrid(makeState(), { format: "csv", maxRows: 2 });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(capturedCsv).toContain("Alice");
      expect(capturedCsv).toContain("Bob");
      expect(capturedCsv).not.toContain("Ünïcödé");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("export truncated to 2 of 3"));
    } finally {
      warnSpy.mockRestore();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});

describe("export — maxRows caps before building rows", () => {
  function makeLargeState(accessorFn: (row: Row) => unknown): DataGridStoreState {
    const data: Row[] = Array.from({ length: 100_000 }, (_, i) => ({ id: String(i), name: `Name ${i}`, note: "" }));
    return makeState({
      data,
      visibleColumns: [{ id: "name", header: "Name", accessorFn, type: "text" }] as never,
      viewIndex: data.map((_, i) => i),
    });
  }

  it("buildExportRows calls the cell accessor only for the capped rows", () => {
    const accessorFn = vi.fn((row: Row) => row.name);

    const rows = buildExportRows(makeLargeState(accessorFn), "view", { maxRows: 10 });

    expect(rows).toHaveLength(10);
    expect(accessorFn).toHaveBeenCalledTimes(10);
  });

  it("exportGrid reads only maxRows rows and still warns with the full count", async () => {
    const accessorFn = vi.fn((row: Row) => row.name);
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:mock-url"), revokeObjectURL: vi.fn() });
    const anchor = document.createElement("a");
    anchor.click = vi.fn();
    vi.spyOn(document, "createElement").mockReturnValue(anchor);
    const warnSpy = vi.spyOn(console, "warn");

    try {
      await exportGrid(makeLargeState(accessorFn), { format: "csv", maxRows: 10 });

      expect(accessorFn).toHaveBeenCalledTimes(10);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("export truncated to 10 of 100000"));
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});
