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

  it("falls back to the plain text of a node header", () => {
    const column: ColumnDef<Row, unknown> = { id: "custom", header: <span>node</span>, accessorKey: "name" };
    expect(columnLabelText(column)).toBe("node");
  });

  it("reads host elements and fragments, and skips a component", () => {
    const Icon = () => <svg />;
    const header = (
      <span>
        <Icon /> Name <b>of</b> <>user</> {7}
      </span>
    );
    expect(columnLabelText({ id: "c", header })).toBe("Name of user 7");
  });

  it("reads an sr-only label", () => {
    expect(columnLabelText({ id: "actions", header: <span className="sr-only">Actions</span> })).toBe("Actions");
  });

  it("falls back to the id when a node header holds no text", () => {
    expect(columnLabelText({ id: "icon", header: <svg /> })).toBe("icon");
  });

  it("bounds the depth and the length of the walk", () => {
    let deep = <i>core</i>;
    for (let i = 0; i < 50; i++) deep = <span>{deep}</span>;
    expect(columnLabelText({ id: "deep", header: deep })).toBe("deep");
    expect(columnLabelText({ id: "long", header: <span>{"x".repeat(5000)}</span> }).length).toBeLessThanOrEqual(200);
  });

  it("headerText still wins over a node header", () => {
    expect(columnLabelText({ id: "c", header: <span>node</span>, headerText: "Given" })).toBe("Given");
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
