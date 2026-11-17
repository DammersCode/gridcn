import { describe, expect, it, vi } from "vitest";
import { resolveColumnValidate } from "../../cell-types/capabilities";
import type { AnyColumnDef } from "../../store/types";
import { resolveBulkWrites, type BulkCandidate } from "../validate-batch";

type Row = { id: number; sku: string };

function setup(count: number, validateMany: (cells: readonly { value: unknown; row: unknown }[]) => (string | null)[], extra: Partial<AnyColumnDef> = {}) {
  const column = { id: "sku", header: "SKU", accessorKey: "sku", validateMany, ...extra } as unknown as AnyColumnDef;
  const data: Row[] = Array.from({ length: count }, (_, i) => ({ id: i, sku: `s${i}` }));
  const validate = resolveColumnValidate(column);
  const candidates: BulkCandidate[] = data.map((row, i) => ({ viewRowIndex: i, columnId: "sku", value: `n${i}`, validate, row, rowId: String(i) }));
  return { grid: { data, columns: [column] }, candidates, column };
}

describe("validateMany", () => {
  it("runs once for a 10,000-cell batch and rejects the cells it names", () => {
    const many = vi.fn((cells: readonly { value: unknown }[]) => cells.map((cell) => (cell.value === "n7" ? "taken" : null)));
    const { grid, candidates } = setup(10_000, many);
    const resolution = resolveBulkWrites(candidates, grid);
    if (resolution instanceof Promise) throw new Error("expected a sync resolution");
    expect(many).toHaveBeenCalledTimes(1);
    expect(many.mock.calls[0]![0]).toHaveLength(10_000);
    expect(resolution.writes).toHaveLength(9_999);
    expect(resolution.rejected).toEqual([expect.objectContaining({ rowId: "7", columnId: "sku", message: "taken" })]);
  });

  it("runs after the column's own validate", () => {
    const many = vi.fn((cells: readonly unknown[]) => cells.map(() => null));
    const { grid, candidates } = setup(3, many, { validate: (value: unknown) => (value === "n1" ? "bad" : null) } as Partial<AnyColumnDef>);
    const resolution = resolveBulkWrites(candidates, grid);
    if (resolution instanceof Promise) throw new Error("expected a sync resolution");
    expect(resolution.rejected.map((r) => r.message)).toEqual(["bad"]);
  });

  it("rejects every cell when it returns the wrong number of answers", () => {
    const { grid, candidates } = setup(3, () => [null]);
    const resolution = resolveBulkWrites(candidates, grid);
    if (resolution instanceof Promise) throw new Error("expected a sync resolution");
    expect(resolution.writes).toHaveLength(0);
    expect(resolution.rejected).toHaveLength(3);
  });
});
