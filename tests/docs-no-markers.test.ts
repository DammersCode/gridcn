import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const mdxFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? mdxFiles(join(dir, entry.name)) : entry.name.endsWith(".mdx") ? [join(dir, entry.name)] : [],
  );

describe("docs carry no new or updated markers", () => {
  it("has no <NewBadge in content/docs", () => {
    const offenders = mdxFiles("content/docs").filter((file) => readFileSync(file, "utf8").includes("<NewBadge"));
    expect(offenders).toEqual([]);
  });

  it("keeps docs-changes out of the lint chain and the scripts", () => {
    const { scripts } = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(scripts.lint).not.toContain("docs-changes");
    expect(scripts["docs:changes"]).toBeUndefined();
  });
});
