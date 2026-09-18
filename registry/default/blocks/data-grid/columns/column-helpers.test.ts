import { afterEach, describe, expect, it, vi } from "vitest";
import { defineColumns, getCellValue, setCellValue } from "./column-helpers";
import type { ColumnDef } from "../types";

type Row = { id: string; name: string; age: number; active: boolean };

const row: Row = { id: "a", name: "Alice", age: 30, active: true };

describe("getCellValue", () => {
  it("reads via accessorKey", () => {
    const column: ColumnDef<Row, string> = { id: "name", header: "Name", accessorKey: "name" };
    expect(getCellValue(row, column)).toBe("Alice");
  });

  it("reads via accessorFn, preferring it over accessorKey", () => {
    const column: ColumnDef<Row, string> = {
      id: "name",
      header: "Name",
      accessorKey: "name",
      accessorFn: (r) => r.name.toUpperCase(),
    };
    expect(getCellValue(row, column)).toBe("ALICE");
  });

  it("throws a descriptive error when neither accessor is present", () => {
    const column: ColumnDef<Row, string> = { id: "mystery", header: "Mystery" };
    expect(() => getCellValue(row, column)).toThrow(/mystery/);
    expect(() => getCellValue(row, column)).toThrow(/accessorKey or accessorFn/);
  });
});

describe("setCellValue", () => {
  it("spreads onto accessorKey immutably when no setValue is given", () => {
    const column: ColumnDef<Row, string> = { id: "name", header: "Name", accessorKey: "name" };
    const next = setCellValue(row, column, "Bob");
    expect(next).toEqual({ ...row, name: "Bob" });
    expect(next).not.toBe(row);
    expect(row.name).toBe("Alice");
  });

  it("uses a custom setValue when provided", () => {
    const setValue = vi.fn((r: Row, value: number): Row => ({ ...r, age: value }));
    const column: ColumnDef<Row, number> = { id: "age", header: "Age", accessorKey: "age", setValue };
    const next = setCellValue(row, column, 31);
    expect(setValue).toHaveBeenCalledWith(row, 31);
    expect(next).toEqual({ ...row, age: 31 });
  });

  it("throws a descriptive error when unwritable (accessorFn-only, no setValue)", () => {
    const column: ColumnDef<Row, string> = {
      id: "computed",
      header: "Computed",
      accessorFn: (r) => r.name,
    };
    expect(() => setCellValue(row, column, "x")).toThrow(/computed/);
    expect(() => setCellValue(row, column, "x")).toThrow(/not writable/);
  });
});

describe("defineColumns dev-mode warnings", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("warns on duplicate column ids", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const columns = defineColumns<Row>()([
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "name", header: "Name Again", accessorKey: "name" },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/duplicate column id "name"/));
    expect(columns).toHaveLength(2);
    warn.mockRestore();
  });

  it("warns on columns with neither accessorKey nor accessorFn", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    defineColumns<Row>()([{ id: "mystery", header: "Mystery" }]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/mystery.*neither accessorKey nor accessorFn/));
    warn.mockRestore();
  });

  it("does not warn for valid, unique columns", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    defineColumns<Row>()([
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "age", header: "Age", accessorKey: "age", type: "number" },
    ]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not warn in production mode", () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    defineColumns<Row>()([
      { id: "dup", header: "A" },
      { id: "dup", header: "B" },
    ]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns the same array reference (identity function)", () => {
    vi.stubEnv("NODE_ENV", "production");
    const input = [{ id: "name", header: "Name", accessorKey: "name" as const }];
    const output = defineColumns<Row>()(input);
    expect(output).toBe(input);
  });
});
