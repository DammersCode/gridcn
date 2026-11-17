import { afterEach, describe, expect, it, vi } from "vitest";
import type { CellType, ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { buildCsv, buildXlsx, exportGrid, type ExportGridOptions } from "./export-grid";
import { settlePending, type ExportCell, type PendingCell } from "./export-source";
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

function makeState(names: string[]): DataGridStoreState {
  const data = names.map((name) => ({ id: name, name }));
  const columns: ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name", type: "text" }];
  return { data, visibleColumns: columns as never, viewIndex: data.map((_, i) => i), cellTypes: { text: textCellType as never }, sortState: [], filterState: [], searchText: "" } as unknown as DataGridStoreState;
}

async function exportCsv(names: string[], formatCell: ExportGridOptions["formatCell"], extra: object = {}): Promise<string> {
  let file: Blob | undefined;
  await exportGrid(makeState(names), { csvBom: false, output: (blob) => void (file = blob), formatCell, ...extra });
  return file!.text();
}

afterEach(() => vi.restoreAllMocks());

describe("async formatCell", () => {
  it("awaits a promise per cell on loaded rows and keeps the order", async () => {
    const text = await exportCsv(["a", "b", "c"], async ({ value }) => {
      await Promise.resolve();
      return `${value as string}!`;
    });
    expect(text).toBe("Name\r\na!\r\nb!\r\nc!");
  });

  it("mixes sync and async results in one export, with a source too", async () => {
    const format = ({ value }: { value: unknown }) => (value === "b" ? Promise.resolve(2) : (value as string));
    expect(await exportCsv(["a", "b", "c"], format)).toBe("Name\r\na\r\n2\r\nc");
    expect(await exportCsv([], format, { source: () => [{ id: "1", name: "a" }, { id: "2", name: "b" }] })).toBe("Name\r\na\r\n2");
  });

  it("applies the sync bounds to a resolved value", async () => {
    const long = "x".repeat(40_000);
    const text = await exportCsv(["a", "b"], ({ value }) => Promise.resolve(value === "a" ? "=1+1" : long));
    const [, formula, cut] = text.split("\r\n");
    expect(formula).toBe("'=1+1");
    expect(cut).toHaveLength(32_767);
  });

  it("rejects the export on a rejection and aborts the signal the hook received", async () => {
    let seen: AbortSignal | undefined;
    const failure = new Error("lookup failed");
    await expect(
      exportGrid(makeState(["a", "b"]), {
        output: () => undefined,
        formatCell: ({ signal, value }) => {
          seen = signal;
          return value === "b" ? Promise.reject(failure) : Promise.resolve("ok");
        },
      }),
    ).rejects.toBe(failure);
    expect(seen?.aborted).toBe(true);
  });

  it("does not leak an unhandled rejection from a cell that fails after the first failure", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    await expect(exportGrid(makeState(["a", "b"]), { output: () => undefined, formatCell: ({ value }) => Promise.reject(new Error(String(value))) })).rejects.toThrow("a");
    await new Promise((resolve) => setTimeout(resolve, 20));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("rejects with the signal's reason when the export aborts while promises are pending", async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    await expect(
      exportGrid(makeState(["a"]), {
        output: () => undefined,
        signal: controller.signal,
        formatCell: () => {
          controller.abort(reason);
          return Promise.resolve("x");
        },
      }),
    ).rejects.toBe(reason);
  });

  it("writes typed XLSX cells from resolved numbers", async () => {
    let file: Blob | undefined;
    await exportGrid(makeState(["a"]), { format: "xlsx", output: (blob) => void (file = blob), formatCell: () => Promise.resolve(42) });
    expect((await parseImportFile(new File([file!], "x.xlsx"))).rows).toEqual([["Name"], ["42"]]);
    const blob = await buildXlsx(makeState(["a"]), { formatCell: () => Promise.resolve(7) });
    expect((await parseImportFile(new File([blob], "x.xlsx"))).rows).toEqual([["Name"], ["7"]]);
  });

  it("makes buildCsv throw a TypeError that names exportGrid", () => {
    const options = { formatCell: () => Promise.resolve("x") } as never;
    expect(() => buildCsv(makeState(["a"]), options)).toThrow(/TypeError|exportGrid/);
    expect(() => buildCsv(makeState(["a"]), options)).toThrow(TypeError);
  });

  it("reads the signal after each group of pending cells and leaves the cells empty when it aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    const rows: ExportCell[][] = Array.from({ length: 25_000 }, () => [null]);
    const pending: PendingCell[] = rows.map((row) => ({ row, index: 0, value: Promise.resolve("v") }));
    await expect(settlePending(pending, false, controller.signal)).rejects.toThrow("stop");
    expect(rows[0]![0]).toBeNull();
    expect(rows[24_999]![0]).toBeNull();
  });
});
