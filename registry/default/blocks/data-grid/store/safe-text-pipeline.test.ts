import { describe, expect, it } from "vitest";
import type { AnyColumnDef } from "./types";
import { cellTypes } from "../cell-types/cell-types";
import { computeViewIndex } from "./compute";

type Row = { id: string; value: unknown };

const hostile = () => Object.create(null);
const data: Row[] = [
  { id: "a", value: "alpha" },
  { id: "b", value: hostile() },
  { id: "c", value: "gamma" },
];

const columnsFor = (type?: string): readonly AnyColumnDef[] => [{ id: "value", header: "Value", accessorKey: "value", ...(type ? { type } : {}) } as AnyColumnDef];

describe("filter and sort over values String() cannot convert", () => {
  it.each([undefined, "text", "longText", "number", "date"])("a contains filter does not throw on a %s column", (type) => {
    expect(() =>
      computeViewIndex(data, columnsFor(type), [], [{ columnId: "value", operator: "contains", value: "a" }], "and", undefined, cellTypes as never),
    ).not.toThrow();
  });

  it.each([undefined, "text", "longText", "number", "date"])("an asc sort does not throw on a %s column", (type) => {
    expect(() => computeViewIndex(data, columnsFor(type), [{ columnId: "value", direction: "asc" }], [], "and", undefined, cellTypes as never)).not.toThrow();
  });
});
