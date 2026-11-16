import { describe, expect, it } from "vitest";
import { breakingRowProblems } from "../scripts/verify-breaking-rows.mjs";

const changelog = (entries: string) => `# Changelog\n\n## Unreleased\n\n${entries}\n## 1.3.0 - 2026-10-28\n\n- **Breaking:** an old entry.\n`;
const page = (ids: string[]) => `| Area | 1.3 | 2.0 | What to change |\n|---|---|---|---|\n${ids.map((id) => `| <span id="${id}" />Name | a | b | c |`).join("\n")}\n`;

describe("breakingRowProblems", () => {
  it("accepts entries that each name a row the page holds", () => {
    const log = changelog("- **Breaking:** one. <!-- row: one -->\n- **Breaking:** two. <!-- row: two -->\n\n  | Before | After |\n  |---|---|\n- Not breaking.\n");
    expect(breakingRowProblems({ changelog: log, changelog20: "# Changelog 2.0\n", page: page(["one", "two"]) })).toEqual([]);
  });

  it("fails an entry without a row id and an id the page lacks", () => {
    const log = changelog("- **Breaking:** one.\n- **Breaking:** two. <!-- row: two -->\n");
    const problems = breakingRowProblems({ changelog: log, changelog20: "", page: page([]) });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/line 5:.*no <!-- row: id -->/);
    expect(problems[1]).toMatch(/"two"/);
  });

  it("fails a page row that no entry names and an id that two entries share", () => {
    const log = changelog("- **Breaking:** one. <!-- row: one -->\n- **Breaking:** again. <!-- row: one -->\n");
    const problems = breakingRowProblems({ changelog: log, changelog20: "", page: page(["one", "stale"]) });
    expect(problems.some((p) => /"one" .*twice/.test(p))).toBe(true);
    expect(problems.some((p) => /"stale"/.test(p))).toBe(true);
  });

  it("fails a Breaking marker in CHANGELOG-2.0.md and ignores released sections", () => {
    const problems = breakingRowProblems({ changelog: changelog(""), changelog20: "## Add-ons\n\n- Labels merge. **Breaking:** undefined keeps the default.\n", page: page([]) });
    expect(problems).toEqual([expect.stringMatching(/CHANGELOG-2\.0\.md line 3/)]);
  });

  it("reads the 2.0 release section once Unreleased became a version", () => {
    const log = "## 2.0.0 - 2026-12-01\n\n- **Breaking:** one.\n";
    expect(breakingRowProblems({ changelog: log, changelog20: "", page: page([]) })).toHaveLength(1);
  });
});
