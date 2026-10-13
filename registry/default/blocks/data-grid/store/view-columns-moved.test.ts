import { describe, expect, it } from "vitest";
import { visibleColumnsMoved } from "./compute";
import type { AnyColumnDef } from "./types";

const columns = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "age", header: "Age", accessorKey: "age" },
];

describe("visibleColumnsMoved", () => {
  const name = columns[0] as AnyColumnDef;
  const age = columns[1] as AnyColumnDef;

  it("is false for the same array and for an appended trailing column", () => {
    const visible = [name];
    expect(visibleColumnsMoved(visible, visible)).toBe(false);
    expect(visibleColumnsMoved([name], [name, age])).toBe(false);
  });

  it("is true for a shrink and for a changed prefix", () => {
    expect(visibleColumnsMoved([name, age], [name])).toBe(true);
    expect(visibleColumnsMoved([name, age], [age, name])).toBe(true);
    expect(visibleColumnsMoved([age], [name, age])).toBe(true);
  });
});
