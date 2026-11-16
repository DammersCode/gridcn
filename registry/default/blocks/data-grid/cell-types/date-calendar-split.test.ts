import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("date editor bundle", () => {
  it("loads the calendar on demand, so a grid without an open date editor ships no date picker", () => {
    const source = readFileSync(join(process.cwd(), "registry/default/blocks/data-grid/cell-types/date.tsx"), "utf8");
    expect(source).not.toMatch(/^import[^;]*["']@\/components\/ui\/calendar["']/m);
    expect(source).toMatch(/import\(\s*["']@\/components\/ui\/calendar["']\s*\)/);
  });
});
