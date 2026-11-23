import { describe, expect, it } from "vitest";
import { breakingRowProblems } from "../scripts/verify-breaking-rows.mjs";

const changelog = (entries: string) => `# Changelog\n\n## Unreleased\n\n${entries}\n## 1.3.0 - 2026-10-28\n\n- **Breaking:** an old entry.\n`;
const page = (ids: string[]) => `| Area | 1.3 | 2.0 | What to change |\n|---|---|---|---|\n${ids.map((id) => `| <span id="${id}" />Name | a | b | c |`).join("\n")}\n`;

describe("breakingRowProblems", () => {
  it("accepts entries that each name a row the page holds", () => {
    const log = changelog("- **Breaking:** one. <!-- row: one -->\n- **Breaking:** two. <!-- row: two -->\n\n  | Before | After |\n  |---|---|\n- Not breaking.\n");
    expect(breakingRowProblems({ changelog: log, changelog20: "# Changelog 2.0\n", page21: page(["one", "two"]) })).toEqual([]);
  });

  it("fails an entry without a row id and an id the page lacks", () => {
    const log = changelog("- **Breaking:** one.\n- **Breaking:** two. <!-- row: two -->\n");
    const problems = breakingRowProblems({ changelog: log, changelog20: "", page21: page([]) });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/line 5:.*no <!-- row: id -->/);
    expect(problems[1]).toMatch(/"two"/);
  });

  it("fails a page row that no entry names and an id that two entries share", () => {
    const log = changelog("- **Breaking:** one. <!-- row: one -->\n- **Breaking:** again. <!-- row: one -->\n");
    const problems = breakingRowProblems({ changelog: log, changelog20: "", page21: page(["one", "stale"]) });
    expect(problems.some((p) => /"one" .*twice/.test(p))).toBe(true);
    expect(problems.some((p) => /"stale"/.test(p))).toBe(true);
  });

  it("fails a Breaking marker in CHANGELOG-2.0.md and ignores released sections", () => {
    const problems = breakingRowProblems({ changelog: changelog(""), changelog20: "## Add-ons\n\n- Labels merge. **Breaking:** undefined keeps the default.\n", page21: page([]) });
    expect(problems).toEqual([expect.stringMatching(/CHANGELOG-2\.0\.md line 3/)]);
  });

  it.each(["**breaking:**", "**BREAKING:**"])("reads a %s entry and an inline marker in any letter case", (marker) => {
    const log = changelog(`- ${marker} one.
- Two. ${marker} inline.
`);
    const problems = breakingRowProblems({ changelog: log, changelog20: `- ${marker} 2.0 entry.
`, page21: page([]) });
    expect(problems).toHaveLength(3);
  });

  it("maps a 2.0 section entry to the 2.0 page and an Unreleased entry to the 2.1 page", () => {
    const log = "## Unreleased\n\n- **Breaking:** new. <!-- row: new -->\n\n## 2.0.0 - 2026-11-17\n\n- **Breaking:** old. <!-- row: old -->\n";
    expect(breakingRowProblems({ changelog: log, changelog20: "", page20: page(["old"]), page21: page(["new"]) })).toEqual([]);
    const swapped = breakingRowProblems({ changelog: log, changelog20: "", page20: page(["new"]), page21: page(["old"]) });
    expect(swapped).toHaveLength(4);
  });

  it("reads the 2.1 release section once Unreleased became a version", () => {
    const log = "## 2.1.0 - 2026-12-01\n\n- **Breaking:** one.\n";
    expect(breakingRowProblems({ changelog: log, changelog20: "", page21: page([]) })).toHaveLength(1);
  });

  it("reads the 2.0 release section", () => {
    const log = "## 2.0.0 - 2026-11-17\n\n- **Breaking:** one.\n";
    expect(breakingRowProblems({ changelog: log, changelog20: "", page20: page([]) })).toHaveLength(1);
  });
});
