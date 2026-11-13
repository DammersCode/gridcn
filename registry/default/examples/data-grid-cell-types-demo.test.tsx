import { describe, expect, it } from "vitest";
import { numberCellType } from "@/registry/default/blocks/data-grid/data-grid";
import { cellTypesDemoColumns } from "./data-grid-cell-types-demo";

const column = (id: string) => cellTypesDemoColumns.find((c) => c.id === id)!;

describe("cell types demo number columns", () => {
  it("Validated reaches validate with an age under 18", () => {
    const { options, validate } = column("age") as { options?: { min?: number }; validate: (v: unknown) => string | null };
    expect(options?.min).toBeUndefined();
    const typed = numberCellType.fromText("5", options);
    expect(validate(typed)).toBe("Must be 18 or older");
  });

  it("Clamped moves a typed value into 18 to 100", () => {
    const { options } = column("level") as { options: { min: number; max: number } };
    expect(numberCellType.fromText("5", options)).toBe(18);
    expect(numberCellType.fromText("500", options)).toBe(100);
  });
});
