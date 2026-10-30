import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CellType, ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { buildImportedRows, IMPORT_CANCELLED_MESSAGE, IMPORT_CHUNK_THRESHOLD_ROWS } from "./build-imported-rows";
import { resolveImportMapping as applyImportOptions, type ImportTargetColumn } from "./match-import-column";
import { parseImportFile } from "./parse-import-file";
import { useDataGridImportPreview } from "./use-data-grid-import";

vi.mock("./parse-import-file", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./parse-import-file")>();
  return { ...actual, parseImportFile: vi.fn() };
});

type Row = { id: string; name: string };

const columns: ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const textCellType: CellType<Row, string> = {
  Cell: () => null,
  Editor: () => null,
  toText: (value) => value ?? "",
  fromText: (text) => text,
  clearValue: () => "",
  isEmpty: (value) => value === "",
};
const cellTypes = { text: textCellType } as never;
const TARGETS: ImportTargetColumn[] = [{ id: "name", header: "Name" }];
const FILE = new File(["unused"], "a.csv", { type: "text/csv" });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => vi.restoreAllMocks());

describe("mapColumn async", () => {
  it("stays synchronous when every result is sync", () => {
    const mapped = applyImportOptions(["Name"], TARGETS, { mapColumn: () => null });
    expect(mapped instanceof Promise).toBe(false);
    expect(mapped).toEqual([null]);
  });

  it("returns a Promise when a result is a promise, and keeps undefined as 'no override'", async () => {
    const mapped = applyImportOptions(["Name", "Other"], TARGETS, { mapColumn: (header) => (header === "Other" ? Promise.resolve("name") : Promise.resolve(undefined)) });
    expect(mapped instanceof Promise).toBe(true);
    expect(await mapped).toEqual(["name", "name"]);
  });

  it("a rejection rejects the whole mapping", async () => {
    await expect(applyImportOptions(["Name"], TARGETS, { mapColumn: () => Promise.reject(new Error("down")) })).rejects.toThrow("down");
  });

  it("the preview hook awaits an async mapColumn before it shows the mapping", async () => {
    vi.mocked(parseImportFile).mockResolvedValue({ rows: [["Header"], ["x"]], delimiter: "," });
    const d = deferred<string | null>();
    const { result } = renderHook(() => useDataGridImportPreview({ columnFallback: (i) => `Column ${i}`, defaults: { mapColumn: () => d.promise } }));
    let load!: Promise<void>;
    await act(async () => {
      load = result.current.loadFile(FILE, TARGETS);
      await Promise.resolve();
    });
    expect(result.current.preview).toBeNull();
    await act(async () => {
      d.resolve("name");
      await load;
    });
    expect(result.current.preview?.mapping).toEqual([{ importColumnIndex: 0, gridColumnId: "name" }]);
    expect(result.current.isParsing).toBe(false);
  });

  it("a rejected mapColumn falls back to the built-in match and warns, with no stuck state", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(parseImportFile).mockResolvedValue({ rows: [["Name"], ["x"]], delimiter: "," });
    const { result } = renderHook(() => useDataGridImportPreview({ columnFallback: (i) => `Column ${i}`, defaults: { mapColumn: () => Promise.reject(new Error("down")) } }));
    await act(async () => {
      await result.current.loadFile(FILE, TARGETS);
    });
    expect(result.current.preview?.mapping).toEqual([{ importColumnIndex: 0, gridColumnId: "name" }]);
    expect(result.current.isParsing).toBe(false);
    expect(warn.mock.calls.some(([message]) => String(message).includes("mapColumn rejected"))).toBe(true);
  });

  it("a newer file load supersedes a pending mapColumn", async () => {
    vi.mocked(parseImportFile).mockResolvedValue({ rows: [["Name"], ["x"]], delimiter: "," });
    const slow = deferred<string | null>();
    const calls = [slow.promise, Promise.resolve("name")];
    const { result } = renderHook(() => useDataGridImportPreview({ columnFallback: (i) => `Column ${i}`, defaults: { mapColumn: () => calls.shift()! } }));
    let first!: Promise<void>;
    await act(async () => {
      first = result.current.loadFile(FILE, TARGETS);
      await Promise.resolve();
    });
    await act(async () => {
      await result.current.loadFile(new File(["unused"], "b.csv"), TARGETS);
    });
    await act(async () => {
      slow.resolve(null);
      await first;
    });
    expect(result.current.preview?.fileName).toBe("b.csv");
    expect(result.current.preview?.mapping).toEqual([{ importColumnIndex: 0, gridColumnId: "name" }]);
  });
});

describe("import createRow async", () => {
  const build = (createRow: (index: number) => Row | Promise<Row>, count = 2, signal?: AbortSignal) =>
    buildImportedRows<Row>({
      dataRows: Array.from({ length: count }, (_, i) => [`n${i}`]),
      mapping: [{ importColumnIndex: 0, gridColumnId: "name" }],
      columns,
      cellTypes,
      createRow,
      signal,
    });

  it("stays synchronous when the factory is sync", () => {
    const result = build((index) => ({ id: `r${index}`, name: "" }));
    expect(result instanceof Promise).toBe(false);
  });

  it("returns a Promise for an async factory and folds the cells into the resolved rows", async () => {
    const result = build((index) => Promise.resolve({ id: `r${index}`, name: "" }));
    expect(result instanceof Promise).toBe(true);
    const { rows } = await result;
    expect(rows).toEqual([{ id: "r0", name: "n0" }, { id: "r1", name: "n1" }]);
  });

  it("accepts a mix of sync and async rows", async () => {
    const { rows } = await build((index) => (index === 0 ? { id: "s", name: "" } : Promise.resolve({ id: "p", name: "" })));
    expect(rows.map((row) => row.id)).toEqual(["s", "p"]);
  });

  it("a rejection rejects the build, so the dialog imports nothing", async () => {
    await expect(build(() => Promise.reject(new Error("down")))).rejects.toThrow("down");
  });

  it("an abort while the rows are pending cancels the build", async () => {
    const controller = new AbortController();
    const d = deferred<Row>();
    const result = build(() => d.promise, 1, controller.signal);
    controller.abort();
    d.resolve({ id: "x", name: "" });
    await expect(result).rejects.toThrow(IMPORT_CANCELLED_MESSAGE);
  });

  it("works on the chunked large-import path", async () => {
    const count = IMPORT_CHUNK_THRESHOLD_ROWS + 5;
    const { rows } = await build((index) => Promise.resolve({ id: `r${index}`, name: "" }), count);
    expect(rows).toHaveLength(count);
    expect(rows[count - 1]).toEqual({ id: `r${count - 1}`, name: `n${count - 1}` });
  });
});
