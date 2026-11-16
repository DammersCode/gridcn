import { describe, expect, it } from "vitest";
import { rehypeRowIds, rowIdOf, type HastNode } from "../lib/rehype-row-ids";

const code = (value: string): HastNode => ({ type: "element", tagName: "code", children: [{ type: "text", value }] });
const row = (...cells: HastNode[]): HastNode => ({ type: "element", tagName: "tr", children: cells.map((c) => ({ type: "element", tagName: "td", children: [c] })) });

describe("rehypeRowIds", () => {
  it("gives the first row of a name an id and skips repeats and non-name cells", () => {
    const rows = [row(code("rowMarkers")), row(code("rowMarkers")), row(code("a b")), row({ type: "text", value: "plain" })];
    const tree = { type: "root", children: rows };
    rehypeRowIds()(tree);
    expect(rows.map((r) => r.properties?.["id"])).toEqual([rowIdOf("rowMarkers"), undefined, undefined, undefined]);
  });

  it("builds a stable id", () => {
    expect(rowIdOf("aria-label")).toBe("prop-aria-label");
  });
});
