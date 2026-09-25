import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDataGridImportPreview, type ImportTargetColumn } from "./use-data-grid-import";
import { parseImportFile, type ParsedImportFile } from "./parse-import-file";

vi.mock("./parse-import-file", () => ({
  parseImportFile: vi.fn(),
}));

const mockedParse = vi.mocked(parseImportFile);

const TARGETS: ImportTargetColumn[] = [{ id: "name", header: "Name" }];
const FILE_A = new File(["unused"], "a.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
const FILE_B = new File(["unused"], "b.csv", { type: "text/csv" });

/** A parse that never resolves until the test drives it — the slow in-flight sheet parse. */
function makeDeferredParse() {
  let resolve: (value: ParsedImportFile) => void = () => {};
  return {
    promise: new Promise<ParsedImportFile>((r) => {
      resolve = r;
    }),
    resolve,
  };
}

describe("useDataGridImportPreview — stale sheet parse after the file changed", () => {
  it("a late sheet parse from a replaced file cannot clobber the new file's preview", async () => {
    const deferred = makeDeferredParse();
    mockedParse.mockImplementation(async (file, options) => {
      if (options?.sheetName === "S2") return deferred.promise;
      if (file.name === "a.xlsx") return { rows: [["Name"], ["A-row"]], sheetNames: ["S1", "S2"], sheetName: "S1" };
      return { rows: [["Name"], ["B-row"]], delimiter: "," };
    });

    const { result } = renderHook(() => useDataGridImportPreview((index) => `Column ${index}`));

    await act(async () => {
      await result.current.loadFile(FILE_A, TARGETS);
    });
    expect(result.current.preview?.fileName).toBe("a.xlsx");

    // start the sheet re-parse, then replace the whole file before that parse lands.
    const { sheetSwitch, loadB } = await act(async () => {
      return {
        sheetSwitch: result.current.setSheetName("S2"),
        loadB: result.current.loadFile(FILE_B, TARGETS),
      };
    });
    await act(async () => {
      deferred.resolve({ rows: [["Name"], ["S2-row"]], sheetNames: ["S1", "S2"], sheetName: "S2" });
      await loadB;
      await sheetSwitch;
    });

    // the late "S2" parse is superseded by the new file load: preview belongs to b.csv.
    expect(result.current.preview?.fileName).toBe("b.csv");
    expect(result.current.preview?.rows).toEqual([["Name"], ["B-row"]]);
    expect(result.current.preview?.sheetName).toBeUndefined();
    expect(result.current.isParsing).toBe(false);
  });
});
