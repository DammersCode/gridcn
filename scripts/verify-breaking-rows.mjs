// Fails when a **Breaking:** entry of release 2.0 names no row of the 2.0 breaking changes page, or a row names no entry.
// An entry carries its row id as `<!-- row: id -->`; the page row carries `<span id="id" />`. CHANGELOG-2.0.md holds no Breaking entry.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const PAGE = "content/docs/(evaluate)/support-upgrades/breaking-changes-2-0.mdx";
const RELEASE_SECTION = /^## (?:Unreleased|2\.0\.\d+)\b/;

/** The `**Breaking` entries of the 2.0 section of `changelog`: `{ line, id }`, `id` null without a row comment. */
function breakingEntries(changelog) {
  const entries = [];
  let inRelease = false;
  let entry = null;
  changelog.split(/\r?\n/).forEach((text, i) => {
    if (text.startsWith("## ")) {
      inRelease = RELEASE_SECTION.test(text);
      entry = null;
      return;
    }
    if (!inRelease) return;
    if (/^\S/.test(text)) entry = null;
    if (/^- \*\*breaking\b/i.test(text)) entries.push((entry = { line: i + 1, id: null }));
    else if (/\*\*breaking\b/i.test(text)) entries.push({ line: i + 1, id: null, inline: true });
    const id = /<!-- row: ([a-z0-9-]+) -->/.exec(text)?.[1];
    if (entry && id) entry.id ??= id;
  });
  return entries;
}

/** Problems for the two changelogs against the breaking changes page. */
export function breakingRowProblems({ changelog, changelog20, page }) {
  const problems = [];
  const rows = new Set([...page.matchAll(/^\|\s*<span id="([^"]+)" \/>/gm)].map((m) => m[1]));
  const named = new Map();
  for (const { line, id, inline } of breakingEntries(changelog)) {
    if (inline) problems.push(`CHANGELOG.md line ${line}: a **Breaking** marker inside an entry; give it its own top-level entry`);
    else if (!id) problems.push(`CHANGELOG.md line ${line}: a Breaking entry with no <!-- row: id --> comment; add one and a row on ${PAGE}`);
    else if (named.has(id)) problems.push(`CHANGELOG.md line ${line}: row id "${id}" is used twice (line ${named.get(id)})`);
    else {
      named.set(id, line);
      if (!rows.has(id)) problems.push(`CHANGELOG.md line ${line}: row id "${id}" has no <span id="${id}" /> row on ${PAGE}`);
    }
  }
  for (const id of rows) if (!named.has(id)) problems.push(`${PAGE}: row "${id}" names no Breaking entry of CHANGELOG.md; delete the row or add the entry`);
  changelog20.split(/\r?\n/).forEach((text, i) => {
    if (/\*\*breaking\b/i.test(text)) problems.push(`CHANGELOG-2.0.md line ${i + 1}: a Breaking change; move it to CHANGELOG.md under ## Unreleased with a row`);
  });
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const read = (path) => readFileSync(join(root, path), "utf8");
  const problems = breakingRowProblems({ changelog: read("CHANGELOG.md"), changelog20: read("CHANGELOG-2.0.md"), page: read(PAGE) });
  if (problems.length) {
    console.error(`breaking rows: ${problems.length} problems\n${problems.map((p) => `  ${p}`).join("\n")}`);
    process.exit(1);
  }
  console.log("breaking rows: every 2.0 Breaking entry has a row");
}
