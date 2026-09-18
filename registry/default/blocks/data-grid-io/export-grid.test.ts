import { describe, expect, it, vi } from "vitest";
import type { CellType, ColumnDef, DataGridStoreState } from "@/registry/default/blocks/data-grid/data-grid";
import { buildExportHeaders, buildExportRows, downloadBlob, exportGrid, quoteCsvField, rowsToCsv, type ExportGridOptions } from "./export-grid";

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
        rows: { hasIndex: () => false },
        current: { range: { x: 0, y: 1, width: 1, height: 2 }, rangeStack: [] },
      } as never,
    });
    const rows = buildExportRows(state, "selection");
    expect(rows.map((r) => r[0])).toEqual(["Bob", "Ünïcödé"]);
  });

  it("scope 'selection' reads the rows channel (checkbox markers) too", () => {
    const state = makeState({
      selection: { rows: { hasIndex: (i: number) => i === 0 }, current: null } as never,
    });
    const rows = buildExportRows(state, "selection");
    expect(rows.map((r) => r[0])).toEqual(["Alice"]);
  });

  it("scope 'selection' follows view order under a sort, not data order", () => {
    const state = makeState({
      viewIndex: [2, 1, 0],
      selection: {
        rows: { hasIndex: () => false },
        current: { range: { x: 0, y: 0, width: 1, height: 2 }, rangeStack: [] },
      } as never,
    });
    const rows = buildExportRows(state, "selection");
    expect(rows.map((r) => r[0])).toEqual(["Ünïcödé", "Bob"]);
  });

  it("scope 'selection' exports nothing when nothing is selected", () => {
    const state = makeState({ selection: { rows: { hasIndex: () => false }, current: null } as never });
    expect(buildExportRows(state, "selection")).toEqual([]);
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

describe("exportGrid lazy xlsx loading", () => {
  it("does not import xlsx for a csv export", async () => {
    vi.resetModules();
    const xlsxModuleSpy = vi.fn();
    vi.doMock("xlsx", () => {
      xlsxModuleSpy();
      return { utils: {}, write: vi.fn() };
    });

    const { exportGrid: freshExportGrid } = await import("./export-grid");
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const anchor = document.createElement("a");
    anchor.click = vi.fn();
    vi.spyOn(document, "createElement").mockReturnValue(anchor);

    await freshExportGrid(makeState(), { format: "csv" });

    expect(xlsxModuleSpy).not.toHaveBeenCalled();

    vi.doUnmock("xlsx");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("imports xlsx only when an xlsx export actually runs", async () => {
    vi.resetModules();
    const xlsxModuleSpy = vi.fn();
    const aoa_to_sheet = vi.fn(() => ({}));
    const book_new = vi.fn(() => ({}));
    const book_append_sheet = vi.fn();
    const write = vi.fn(() => new ArrayBuffer(0));
    vi.doMock("xlsx", () => {
      xlsxModuleSpy();
      return { utils: { aoa_to_sheet, book_new, book_append_sheet }, write };
    });

    const { exportGrid: freshExportGrid } = await import("./export-grid");
    expect(xlsxModuleSpy).not.toHaveBeenCalled();

    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const anchor = document.createElement("a");
    anchor.click = vi.fn();
    vi.spyOn(document, "createElement").mockReturnValue(anchor);

    await freshExportGrid(makeState(), { format: "xlsx" });

    expect(xlsxModuleSpy).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalled();

    vi.doUnmock("xlsx");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
