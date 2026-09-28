import { describe, expect, it } from "vitest";
import { columnLabelText, encodeTemplate } from "./column-format-helpers";
import type { ColumnDef } from "../types";

type Row = { id: string; name: string };
const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "email", header: "Email", headerText: "E-mail", accessorKey: "name" },
  { id: "custom", header: "Custom node", accessorKey: "name" },
];

describe("columnLabelText", () => {
  it("prefers headerText over header and id", () => {
    expect(columnLabelText(columns[1]!)).toBe("E-mail");
  });

  it("falls back to a string header", () => {
    expect(columnLabelText(columns[0]!)).toBe("Name");
  });

  it("falls back to the id when the header is not a string", () => {
    const column: ColumnDef<Row, unknown> = { id: "custom", header: <span>node</span>, accessorKey: "name" };
    expect(columnLabelText(column)).toBe("custom");
  });
});

describe("encodeTemplate", () => {
  it("run-length-encodes consecutive equal widths", () => {
    expect(encodeTemplate([100, 100, 200, 200, 200, 50])).toBe("repeat(2, 100px) repeat(3, 200px) 50px");
  });

  it("emits a single segment without repeat for a run of one", () => {
    expect(encodeTemplate([100, 200, 300])).toBe("100px 200px 300px");
  });

  it("returns an empty string for no widths", () => {
    expect(encodeTemplate([])).toBe("");
  });
});
