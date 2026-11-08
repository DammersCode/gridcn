import { afterEach, describe, expect, it, vi } from "vitest";
import type { CellType, ColumnDef, ServerSpec } from "@/registry/default/blocks/data-grid/data-grid";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { DEFAULT_LABELS } from "@/registry/default/blocks/data-grid/labels";
import { exportGrid } from "./export-grid";
import { parseImportFile } from "./parse-import-file";

type Row = { id: string; name: string };

const textCellType: CellType<Row, string> = {
  Cell: () => null,
  Editor: () => null,
  toText: (value) => value ?? "",
  fromText: (text) => text,
  clearValue: () => "",
  isEmpty: (value) => value === "",
};

const CRLF = String.fromCharCode(13, 10);
const sorts = [{ columnId: "name", direction: "asc" }] as const;

function makeState(held: Row[] = [{ id: "p", name: "page-row" }]): DataGridStoreState {
  const columns: ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name", type: "text" }];
  return {
    data: held,
    visibleColumns: columns as never,
    viewIndex: held.map((_, i) => i),
    cellTypes: { text: textCellType as never },
    sortState: sorts,
    filterState: [],
    searchText: "ann",
  } as unknown as DataGridStoreState;
}

function captureDownload(): () => Promise<string> {
  let blob: Blob | undefined;
  vi.stubGlobal("URL", { ...URL, createObjectURL: (b: Blob) => ((blob = b), "blob:x"), revokeObjectURL: vi.fn() });
  const anchor = document.createElement("a");
  anchor.click = vi.fn();
  vi.spyOn(document, "createElement").mockReturnValue(anchor);
  return async () => (blob ? await blob.text() : "");
}

async function* batches(...lists: Row[][]): AsyncGenerator<Row[]> {
  for (const list of lists) yield list;
}

const row = (name: string): Row => ({ id: name, name });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("exportGrid with a source", () => {
  it("exports the source rows instead of the held page and hands the spec to the source", async () => {
    const read = captureDownload();
    const source = vi.fn(({ spec }: { spec: ServerSpec }) => Promise.resolve([row(`s-${spec.searchText}`)]));
    const result = await exportGrid(makeState(), { source, csvBom: false });
    expect(source.mock.calls[0]![0].spec).toEqual({ sorts, filters: [], searchText: "ann" });
    expect(await read()).toBe("Name\r\ns-ann");
    expect(result).toEqual({ rowCount: 1, truncated: false });
  });

  it("joins batches of an async source into one file and reports progress", async () => {
    const read = captureDownload();
    const progress = vi.fn();
    await exportGrid(makeState(), { source: () => batches([row("a"), row("b")], [row("c")]), csvBom: false, onProgress: progress });
    expect(await read()).toBe("Name\r\na\r\nb\r\nc");
    expect(progress.mock.calls.map(([p]) => p.rowCount)).toEqual([2, 3]);
  });

  it("neutralizes formula-like text like a loaded export", async () => {
    const read = captureDownload();
    await exportGrid(makeState(), { source: () => Promise.resolve([row("=1+1")]), csvBom: false });
    expect(await read()).toBe("Name\r\n'=1+1");
  });

  it("skips null rows", async () => {
    const read = captureDownload();
    await exportGrid(makeState(), { source: () => Promise.resolve([row("a"), null as never, undefined as never]), csvBom: false });
    expect(await read()).toBe("Name\r\na");
  });

  it("stops at maxRows, ends the source, and reports truncated", async () => {
    const read = captureDownload();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let aborted = false;
    const result = await exportGrid(makeState(), {
      csvBom: false,
      maxRows: 3,
      source: async function* ({ signal }) {
        signal.addEventListener("abort", () => (aborted = true));
        yield [row("a"), row("b")];
        yield [row("c"), row("d")];
        yield [row("never")];
      },
    });
    expect(await read()).toBe("Name\r\na\r\nb\r\nc");
    expect(result).toEqual({ rowCount: 3, truncated: true });
    expect(aborted).toBe(true);
    expect(warn).toHaveBeenCalled();
  });

  it("is not truncated when the source ends exactly at maxRows", async () => {
    captureDownload();
    const result = await exportGrid(makeState(), { source: () => batches([row("a"), row("b")]), maxRows: 2 });
    expect(result).toEqual({ rowCount: 2, truncated: false });
  });

  it("stops at maxBytes within one slice of rows", async () => {
    captureDownload();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const many = Array.from({ length: 3000 }, (_, i) => row(`r${i}`));
    const result = await exportGrid(makeState(), { source: () => Promise.resolve(many), csvBom: false, maxBytes: 100 });
    expect(result).toEqual({ rowCount: 1000, truncated: true });
  });

  it("rejects a source that yields empty batches forever", async () => {
    captureDownload();
    await expect(
      exportGrid(makeState(), {
        source: async function* () {
          for (;;) yield [];
        },
      }),
    ).rejects.toThrow(RangeError);
  });

  it("truncates one batch that is far longer than maxRows", async () => {
    captureDownload();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const many = Array.from({ length: 5000 }, (_, i) => row(`r${i}`));
    expect(await exportGrid(makeState(), { source: () => Promise.resolve(many), maxRows: 10 })).toEqual({ rowCount: 10, truncated: true });
    expect(await exportGrid(makeState(), { source: () => Promise.resolve(many), maxRows: 0 })).toEqual({ rowCount: 0, truncated: true });
  });

  it("rejects on abort even when the source ignores its signal and never settles", async () => {
    const read = captureDownload();
    const controller = new AbortController();
    const pending = exportGrid(makeState(), { source: () => new Promise<Row[]>(() => {}), signal: controller.signal });
    controller.abort(new Error("stop"));
    await expect(pending).rejects.toThrow("stop");
    expect(await read()).toBe("");
  });

  it("keeps exporting when onProgress throws", async () => {
    const read = captureDownload();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await exportGrid(makeState(), { source: () => Promise.resolve([row("a")]), csvBom: false, onProgress: () => { throw new Error("ui"); } });
    expect(await read()).toBe("Name" + CRLF + "a");
  });

  it("downloads nothing from a loaded export whose signal aborted", async () => {
    const read = captureDownload();
    await expect(exportGrid(makeState(), { signal: AbortSignal.abort() })).rejects.toBeDefined();
    expect(await read()).toBe("");
  });

  it("takes a plain array from the source and clamps unusable limits", async () => {
    captureDownload();
    const rows = [row("a"), row("b")];
    expect(await exportGrid(makeState(), { source: () => rows, maxRows: -5 })).toEqual({ rowCount: 0, truncated: true });
    expect(await exportGrid(makeState(), { source: () => rows, maxRows: Number.NaN })).toEqual({ rowCount: 2, truncated: false });
    expect(await exportGrid(makeState(), { source: () => rows, maxRows: Infinity })).toEqual({ rowCount: 2, truncated: false });
    expect((await exportGrid(makeState(), { source: () => rows, maxBytes: Number.NaN })).truncated).toBe(false);
    expect(await exportGrid(makeState(), { maxRows: Number.NaN })).toEqual({ rowCount: 1, truncated: false });
    expect(await exportGrid(makeState(), { maxRows: -3 })).toEqual({ rowCount: 0, truncated: true });
  });

  it("rejects an invalid xlsx sheet name before it calls the source", async () => {
    captureDownload();
    const source = vi.fn((_ctx: { spec: ServerSpec; signal: AbortSignal }) => [row("a")]);
    for (const name of ["a/b", "", "'quoted", "history"]) {
      await expect(exportGrid(makeState(), { format: "xlsx", sheetName: name, source })).rejects.toThrow("sheet name");
    }
    expect(source).not.toHaveBeenCalled();
  });

  it("yields while it walks a long array so Cancel can land", async () => {
    captureDownload();
    const controller = new AbortController();
    const many = Array.from({ length: 400_000 }, (_, i) => row(`r${i}`));
    const pending = exportGrid(makeState(), { source: () => many, signal: controller.signal });
    setTimeout(() => controller.abort(new Error("stop")), 5);
    await expect(pending).rejects.toThrow("stop");
  });

  it("rejects a batch that is not an array and downloads nothing", async () => {
    const read = captureDownload();
    await expect(exportGrid(makeState(), { source: () => Promise.resolve({ length: 1e9 } as never) })).rejects.toThrow(TypeError);
    expect(await read()).toBe("");
  });

  it("rejects with the abort reason and downloads nothing when the signal aborts during a fetch", async () => {
    const read = captureDownload();
    const controller = new AbortController();
    const pending = exportGrid(makeState(), {
      signal: controller.signal,
      source: async () => {
        controller.abort(new Error("stop"));
        return [row("a")];
      },
    });
    await expect(pending).rejects.toThrow("stop");
    expect(await read()).toBe("");
  });

  it("rejects at once with a signal that is already aborted", async () => {
    captureDownload();
    const source = vi.fn((_ctx: { spec: ServerSpec; signal: AbortSignal }) => Promise.resolve<Row[]>([]));
    await expect(exportGrid(makeState(), { source, signal: AbortSignal.abort() })).rejects.toBeDefined();
    expect(source).not.toHaveBeenCalled();
  });

  it("writes an xlsx file from the source rows", async () => {
    let blob: Blob | undefined;
    vi.stubGlobal("URL", { ...URL, createObjectURL: (b: Blob) => ((blob = b), "blob:x"), revokeObjectURL: vi.fn() });
    const result = await exportGrid(makeState(), { format: "xlsx", source: () => batches([row("a")], [row("b")]) });
    expect(result.rowCount).toBe(2);
    const parsed = await parseImportFile(new File([blob!], "x.xlsx"));
    expect(parsed.rows).toEqual([["Name"], ["a"], ["b"]]);
  });
});

describe("exportGrid with a source per data mode", () => {
  const filters = [{ filterId: "f1", columnId: "name", operator: "contains", value: "a" }] as never;

  it("server pagination: the held page is not the export", async () => {
    const read = captureDownload();
    await exportGrid(makeState([row("page-1"), row("page-2")]), { source: () => Promise.resolve([row("all-1"), row("all-2"), row("all-3")]), csvBom: false });
    expect(await read()).toBe("Name\r\nall-1\r\nall-2\r\nall-3");
  });

  it("scroll rows: holes in the sparse data are not exported and the source decides the rows", async () => {
    const read = captureDownload();
    const sparse: Row[] = new Array<Row>(5);
    sparse[1] = row("loaded");
    await exportGrid(makeState(sparse), { source: () => Promise.resolve([row("a"), row("b")]), csvBom: false });
    expect(await read()).toBe("Name\r\na\r\nb");
  });

  it("sortMode server: the server sort reaches the source", async () => {
    captureDownload();
    const source = vi.fn((_ctx: { spec: ServerSpec; signal: AbortSignal }) => Promise.resolve<Row[]>([]));
    await exportGrid(makeState(), { source });
    expect(source.mock.calls[0]![0].spec.sorts).toEqual(sorts);
  });

  it("filterMode server: the filters and search text reach the source", async () => {
    captureDownload();
    const source = vi.fn((_ctx: { spec: ServerSpec; signal: AbortSignal }) => Promise.resolve<Row[]>([]));
    await exportGrid({ ...makeState(), filterState: filters } as unknown as DataGridStoreState, { source });
    expect(source.mock.calls[0]![0].spec).toMatchObject({ filters, searchText: "ann" });
  });

  it("own API: batches of an async generator are paged through with the abort signal", async () => {
    captureDownload();
    const api = vi.fn((_offset: number, _signal: AbortSignal) => [row("x")]);
    await exportGrid(makeState(), {
      source: async function* ({ signal }) {
        for (let offset = 0; offset < 2; offset += 1) yield await Promise.resolve(api(offset, signal));
      },
    });
    expect(api).toHaveBeenCalledTimes(2);
    expect(api.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
  });
});

describe("export status labels", () => {
  it("count one row in the singular and flag an incomplete file", () => {
    const { exportDone } = DEFAULT_LABELS.io;
    expect(exportDone(1, false)).toBe("1 row exported");
    expect(exportDone(1200, false)).toBe("1,200 rows exported");
    expect(exportDone(5, true)).toContain("incomplete");
  });
});
