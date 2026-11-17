import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BLOCKS = join(process.cwd(), "registry/default/blocks");

function shippedSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return shippedSources(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|type-test)\./.test(entry.name) ? [path] : [];
  });
}

describe("date editor bundle", () => {
  it("loads the calendar on demand, so a grid without an open date editor ships no date picker", () => {
    const source = readFileSync(join(BLOCKS, "data-grid/cell-types/date.tsx"), "utf8");
    expect(source).not.toMatch(/^import[^;]*["']@\/components\/ui\/calendar["']/m);
    expect(source).toMatch(/import\(\s*["']\.\/date-calendar["']\s*\)/);
  });

  it("imports the calendar statically in the lazy sibling, so the shadcn CLI rewrites its alias", () => {
    const source = readFileSync(join(BLOCKS, "data-grid/cell-types/date-calendar.tsx"), "utf8");
    expect(source).toMatch(/^import \{ Calendar \} from "@\/components\/ui\/calendar";$/m);
    const registry = readFileSync(join(process.cwd(), "registry.json"), "utf8");
    expect(registry).toContain('"path": "registry/default/blocks/data-grid/cell-types/date-calendar.tsx"');
  });

  it("keeps the alias out of every dynamic import, because the shadcn CLI rewrites static imports only", () => {
    const aliased = shippedSources(BLOCKS).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)]
        .map((match) => match[1]!)
        .filter((specifier) => specifier.startsWith("@/"))
        .map((specifier) => `${file}: ${specifier}`),
    );
    expect(aliased).toEqual([]);
  });
});
