import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CellType, ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { IMPORT_CANCELLED_MESSAGE } from "./build-imported-rows";
import { MAX_CHECK_MESSAGE_LENGTH, MAX_CHECK_REFUSALS, readImportCheckAnswer } from "./import-check";
import { parseImportFile } from "./parse-import-file";
import { useDataGridImportPreview, type ImportTargetColumn } from "./use-data-grid-import";

vi.mock("./parse-import-file", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./parse-import-file")>();
  return { ...actual, parseImportFile: vi.fn() };
});

const columnIds = new Set(["name", "age"]);
const read = (answer: unknown, rowCount = 10) => readImportCheckAnswer(answer, rowCount, columnIds);

describe("readImportCheckAnswer", () => {
  it("treats no answer and an empty answer as no refusals", () => {
    expect(read(undefined)).toEqual({ status: "checked", refusals: [], more: 0 });
    expect(read(null)).toEqual({ status: "checked", refusals: [], more: 0 });
    expect(read({})).toEqual({ status: "checked", refusals: [], more: 0 });
  });

  it("reads refusals and the summary", () => {
    const answer = { rejected: [{ rowIndex: 2, columnId: "name", message: "taken" }, { rowIndex: 0 }], summary: { created: 5, updated: 0 } };
    expect(read(answer)).toEqual({ status: "checked", refusals: [{ rowIndex: 2, columnId: "name", message: "taken" }, { rowIndex: 0 }], more: 0, summary: { created: 5, updated: 0 } });
  });

  it("drops a column id that is not a live column and cuts the message", () => {
    const long = "m".repeat(MAX_CHECK_MESSAGE_LENGTH + 50);
    const checked = read({ rejected: [{ rowIndex: 1, columnId: "ghost", message: long }] });
    expect(checked).toMatchObject({ status: "checked", refusals: [{ rowIndex: 1, message: "m".repeat(MAX_CHECK_MESSAGE_LENGTH) }] });
    expect("columnId" in (checked as { refusals: object[] }).refusals[0]!).toBe(false);
  });

  it("reads at most 1,000 entries and counts the rest as more", () => {
    const rejected = Array.from({ length: MAX_CHECK_REFUSALS + 25 }, () => ({ rowIndex: 0 }));
    const checked = read({ rejected });
    expect(checked).toMatchObject({ status: "checked", more: 25 });
    expect((checked as { refusals: unknown[] }).refusals).toHaveLength(MAX_CHECK_REFUSALS);
  });

  it.each([
    ["a string", "nope"],
    ["an array", []],
    ["rejected as an object", { rejected: {} }],
    ["an entry that is not an object", { rejected: [3] }],
    ["a fractional row index", { rejected: [{ rowIndex: 1.5 }] }],
    ["a negative row index", { rejected: [{ rowIndex: -1 }] }],
    ["a row index past the rows", { rejected: [{ rowIndex: 10 }] }],
    ["a string row index", { rejected: [{ rowIndex: "1" }] }],
    ["a numeric column id", { rejected: [{ rowIndex: 1, columnId: 4 }] }],
    ["a numeric message", { rejected: [{ rowIndex: 1, message: 4 }] }],
    ["a negative summary count", { summary: { created: -1 } }],
    ["a fractional summary count", { summary: { updated: 0.5 } }],
    ["a string summary count", { summary: { skipped: "3" } }],
    ["a summary that is not an object", { summary: 3 }],
  ])("fails on %s", (_name, answer) => {
    expect(read(answer)).toEqual({ status: "failed" });
  });

  it("fails on a getter that throws, and never reads past 1,000 entries of a huge array", () => {
    const hostile = { get rejected(): never { throw new Error("boom"); } };
    expect(read(hostile)).toEqual({ status: "failed" });
    const huge = new Array(5_000_000).fill(null);
    huge.fill({ rowIndex: 0 }, 0, MAX_CHECK_REFUSALS);
    expect(read({ rejected: huge })).toMatchObject({ status: "checked", more: 5_000_000 - MAX_CHECK_REFUSALS });
  });
});

type Row = { name: string; age: string };
const columns: ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "age", header: "Age", accessorKey: "age" },
];
const textType: CellType<Row, string> = { Cell: () => null, Editor: () => null, toText: (v) => v ?? "", fromText: (t) => t, clearValue: () => "", isEmpty: (v) => v === "" };
const cellTypes = { text: textType } as never;
const targets: ImportTargetColumn[] = [{ id: "name", header: "Name" }, { id: "age", header: "Age" }];

async function loadedHook() {
  vi.mocked(parseImportFile).mockResolvedValue({ rows: [["Name", "Age"], ["Ann", "3"], ["Bo", "4"]], delimiter: "," });
  const hook = renderHook(() => useDataGridImportPreview({ columnFallback: (i) => `Column ${i}` }));
  await act(async () => {
    await hook.result.current.loadFile(new File(["x"], "people.csv"), targets);
  });
  return hook;
}

describe("build() with checkImport", () => {
  const base = { columns, cellTypes, createRow: (): Row => ({ name: "", age: "" }) };

  it("passes the built rows and the file facts, and returns the read answer", async () => {
    const { result } = await loadedHook();
    const checkImport = vi.fn(() => ({ rejected: [{ rowIndex: 1, columnId: "age", message: "too old" }], summary: { created: 1 } }));
    const built = await result.current.build<Row>({ ...base, checkImport });
    const [rows, ctx] = checkImport.mock.calls[0] as unknown as [Row[], { fileName: string; mapping: unknown[]; signal: AbortSignal; rejected: unknown[] }];
    expect(rows.map((r) => r.name)).toEqual(["Ann", "Bo"]);
    expect(ctx.fileName).toBe("people.csv");
    expect(ctx.mapping).toHaveLength(2);
    expect(ctx.rejected).toEqual([]);
    expect(built?.check).toEqual({ status: "checked", refusals: [{ rowIndex: 1, columnId: "age", message: "too old" }], more: 0, summary: { created: 1 } });
  });

  it("leaves `check` out without the option", async () => {
    const { result } = await loadedHook();
    expect(Object.keys((await result.current.build<Row>(base))!)).not.toContain("check");
  });

  it("maps a throw and a rejection to a failed check", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = await loadedHook();
    expect((await result.current.build<Row>({ ...base, checkImport: () => { throw new Error("down"); } }))?.check).toEqual({ status: "failed" });
    expect((await result.current.build<Row>({ ...base, checkImport: () => Promise.reject(new Error("down")) }))?.check).toEqual({ status: "failed" });
    warn.mockRestore();
  });

  it("rejects as cancelled when the signal aborts while the check runs", async () => {
    const { result } = await loadedHook();
    const controller = new AbortController();
    const build = result.current.build<Row>({
      ...base,
      signal: controller.signal,
      checkImport: () => new Promise((resolve) => setTimeout(resolve, 20)),
    });
    controller.abort();
    await expect(build).rejects.toThrow(IMPORT_CANCELLED_MESSAGE);
  });
});
