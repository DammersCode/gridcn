import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDataGridImportPreview, type ImportTargetColumn } from "./use-data-grid-import";
import { parseImportFile, type ParsedImportFile } from "./parse-import-file";

vi.mock("./parse-import-file", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./parse-import-file")>();
  return { ...actual, parseImportFile: vi.fn() };
});

const mockedParse = vi.mocked(parseImportFile);

const TARGETS: ImportTargetColumn[] = [{ id: "name", header: "Name" }];
const FILE_A = new File(["unused"], "a.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
const FILE_B = new File(["unused"], "b.csv", { type: "text/csv" });

/** A parse that never settles until the test drives it — the slow in-flight parse. */
function makeDeferredParse() {
  let resolve: (value: ParsedImportFile) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  return {
    promise: new Promise<ParsedImportFile>((res, rej) => {
      resolve = res;
      reject = rej;
    }),
    resolve,
    reject,
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

  it("an aborted, superseded file load does not clear the newer load's isParsing", async () => {
    const a = makeDeferredParse();
    const b = makeDeferredParse();
    let call = 0;
    mockedParse.mockImplementation(() => {
      call += 1;
      return call === 1 ? a.promise : b.promise;
    });

    const { result } = renderHook(() => useDataGridImportPreview((index) => `Column ${index}`));

    let loadB: Promise<void> | undefined;
    await act(async () => {
      result.current.loadFile(FILE_A, TARGETS); // slow, in flight
      loadB = result.current.loadFile(FILE_B, TARGETS); // supersedes the first
    });
    expect(result.current.isParsing).toBe(true);

    // the slow first read aborts (as real file I/O does) while the second is still parsing
    await act(async () => {
      a.reject(new DOMException("Aborted", "AbortError"));
    });
    expect(result.current.isParsing).toBe(true);

    await act(async () => {
      b.resolve({ rows: [["Name"], ["B-row"]], delimiter: "," });
      await loadB;
    });
    expect(result.current.isParsing).toBe(false);
    expect(result.current.preview?.fileName).toBe("b.csv");
  });

  it("setDelimiter shows the parsing state while the re-parse is in flight", async () => {
    const deferred = makeDeferredParse();
    // the re-parse reuses the same file: the first call (the load) is fast, the second (the re-parse) is slow
    let csvCalls = 0;
    mockedParse.mockImplementation((file) => {
      if (file.name !== "b.csv") return deferred.promise;
      csvCalls += 1;
      return csvCalls === 1 ? Promise.resolve({ rows: [["Name"], ["B-row"]], delimiter: "," }) : deferred.promise;
    });

    const { result } = renderHook(() => useDataGridImportPreview((index) => `Column ${index}`));
    await act(async () => {
      await result.current.loadFile(FILE_B, TARGETS);
    });

    let reparse: Promise<void> | undefined;
    await act(async () => {
      reparse = result.current.setDelimiter(";"); // suspends on the deferred parse
    });
    expect(result.current.isParsing).toBe(true);

    await act(async () => {
      deferred.resolve({ rows: [["Name"], ["B2"]], delimiter: ";" });
      await reparse;
    });
    expect(result.current.isParsing).toBe(false);
    expect(result.current.preview?.delimiter).toBe(";");
  });

  it("a superseded delimiter re-parse cannot clobber the preview of a newer file", async () => {
    const deferred = makeDeferredParse();
    let csvCalls = 0;
    mockedParse.mockImplementation((file) => {
      if (file.name === "b.csv") {
          csvCalls += 1;
          return csvCalls === 1 ? Promise.resolve({ rows: [["Name"], ["B1"]], delimiter: "," }) : deferred.promise;
      }
      return Promise.resolve({ rows: [["Name"], ["C-row"]], delimiter: ";" });
    });
    const FILE_C = new File([], "c.csv", { type: "text/csv" });

    const { result } = renderHook(() => useDataGridImportPreview((index) => `Column ${index}`));
    await act(async () => {
      await result.current.loadFile(FILE_B, TARGETS);
    });

    const { reparse, loadC } = await act(async () => ({
      reparse: result.current.setDelimiter(";"), // slow, in flight
      loadC: result.current.loadFile(FILE_C, TARGETS), // supersedes the re-parse
    }));
    await act(async () => {
      deferred.resolve({ rows: [["Name"], ["B2"]], delimiter: ";" });
      await loadC;
      await reparse;
    });

    expect(result.current.preview?.fileName).toBe("c.csv");
    expect(result.current.preview?.rows).toEqual([["Name"], ["C-row"]]);
    expect(result.current.isParsing).toBe(false);
  });

  it("a failed delimiter re-parse sets the error instead of throwing and keeps the preview", async () => {
    // the re-parse uses the SAME file as the initial load: the mock fails only the second call
    let csvCalls = 0;
    mockedParse.mockImplementation((file) => {
      if (file.name !== "b.csv") throw new Error("boom");
      csvCalls += 1;
      return csvCalls === 1 ? Promise.resolve({ rows: [["Name"], ["B-row"]], delimiter: "," }) : Promise.reject(new Error("boom"));
    });

    const { result } = renderHook(() => useDataGridImportPreview((index) => `Column ${index}`));
    await act(async () => {
      await result.current.loadFile(FILE_B, TARGETS);
    });

    let threw = false;
    await act(async () => {
      try {
        await result.current.setDelimiter(";");
      } catch {
        threw = true;
      }
    });

    expect(threw).toBe(false);
    expect(result.current.error).toBe("errorParseFailed");
    expect(result.current.isParsing).toBe(false);
    expect(result.current.preview?.fileName).toBe("b.csv");
  });
});

describe("useDataGridImportPreview — SEC-02 limit errors map to their own keys", () => {
  it("surfaces errorFileTooLarge for a file-too-large parse", async () => {
    mockedParse.mockRejectedValue(new Error("file-too-large"));
    const { result } = renderHook(() => useDataGridImportPreview((index) => `Column ${index}`));
    await act(async () => {
      await result.current.loadFile(FILE_B, TARGETS);
    });
    expect(result.current.error).toBe("errorFileTooLarge");
    expect(result.current.preview).toBeNull();
    vi.restoreAllMocks();
  });

  it("surfaces errorTooManyCells for an over-dimension parse", async () => {
    mockedParse.mockRejectedValue(new Error("import-too-many-cells"));
    const { result } = renderHook(() => useDataGridImportPreview((index) => `Column ${index}`));
    await act(async () => {
      await result.current.loadFile(FILE_B, TARGETS);
    });
    expect(result.current.error).toBe("errorTooManyCells");
    vi.restoreAllMocks();
  });
});
