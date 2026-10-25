// Writes content/docs-changes.json (new/updated docs pages of the release series) and drops stale <NewBadge /> markers.
// `--check` recomputes and fails when the committed file differs.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DOCS = "content/docs";
const OUT = "content/docs-changes.json";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28 });
const tryGit = (...args) => {
  try {
    return git(...args);
  } catch {
    return null;
  }
};

const argv = process.argv.slice(2);
const check = argv.includes("--check");
const releaseAt = argv.indexOf("--release");
const version = (releaseAt >= 0 ? argv[releaseAt + 1] : JSON.parse(fs.readFileSync("package.json", "utf8")).version)?.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("docs-changes: pass --release <major.minor.patch>");
  process.exit(1);
}
const [major, minor] = version.split(".").map(Number);

const parse = (tag) => tag.slice(1).split(".").map(Number);
const compare = (a, b) => parse(a).reduce((diff, part, i) => diff || part - parse(b)[i], 0);
const tags = (tryGit("tag", "--list", "v*.*.*") ?? "").split("\n").filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
const baselineFor = (tagList) =>
  tagList
    .filter((tag) => {
      const [m, n] = parse(tag);
      return m < major || (m === major && n < minor);
    })
    .sort(compare)
    .pop() ?? null;
const baseline = baselineFor(tags);

const targetTag = `v${version}`;
const hasTargetTag = tags.includes(targetTag);

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.posix.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
const docPages = () => walk(DOCS).filter((file) => file.endsWith(".mdx"));

if (check) {
  const frontmatter = (file) => fs.readFileSync(file, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const withStatus = docPages().filter((file) => /^status:/m.test(frontmatter(file)));
  if (withStatus.length) {
    console.error(`docs-changes: remove the retired \`status:\` line from\n${withStatus.join("\n")}`);
    process.exit(1);
  }
}

const shallow = tryGit("rev-parse", "--is-shallow-repository")?.trim() === "true";
if (check && (!hasTargetTag || (!baseline && tags.length === 0) || shallow)) {
  console.log(`docs-changes: tag ${targetTag}, its baseline, or full history not available locally, skipped.`);
  process.exit(0);
}

// Wording-only edits (punctuation, whitespace, link targets, badges) are not a content change.
const essence = (text) =>
  text
    .replace(/^status:.*$/m, "")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/<NewBadge\s*\/>/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");

const listPages = (ref) =>
  (ref ? git("-c", "core.quotePath=false", "ls-tree", "-r", "--name-only", ref, DOCS).split("\n").filter((file) => file.endsWith(".mdx")) : docPages());
const readPage = (ref, file) => (ref ? git("show", `${ref}:${file}`) : fs.readFileSync(file, "utf8"));

const targetRef = hasTargetTag ? targetTag : null;
const baselineFiles = new Set(baseline ? listPages(baseline) : []);
const pages = {};
for (const file of listPages(targetRef).sort()) {
  const key = file.slice(DOCS.length + 1);
  if (!baseline) continue;
  if (!baselineFiles.has(file)) pages[key] = "new";
  else if (essence(readPage(targetRef, file)) !== essence(readPage(baseline, file))) pages[key] = "updated";
}

const json = `${JSON.stringify({ version, baseline, pages }, null, 2)}\n`;

if (check) {
  if (!fs.existsSync(OUT)) {
    console.error(`docs-changes: ${OUT} is missing; run \`pnpm docs:changes --release ${version}\``);
    process.exit(1);
  }
  if (fs.readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") !== json) {
    console.error(`docs-changes: ${OUT} is out of date; run \`pnpm docs:changes --release ${version}\` and commit the result`);
    process.exit(1);
  }
  console.log("docs-changes: ok");
  process.exit(0);
}

const addedLines = (file) => {
  const lines = new Set();
  for (const [, start, count = "1"] of git("diff", "--no-color", "--no-ext-diff", "-U0", baseline, "--", file).matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)) {
    for (let i = 0; i < Number(count); i++) lines.add(Number(start) + i);
  }
  return lines;
};

let removedBadges = 0;
for (const file of docPages()) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes("<NewBadge")) continue;
  const added = baselineFiles.has(file) ? addedLines(file) : null;
  const lines = text.split(/(?<=\n)/);
  const kept = [];
  lines.forEach((line, i) => {
    if (!added || added.has(i + 1) || !/<NewBadge\s*\/>/.test(line)) return kept.push(line);
    removedBadges++;
    const stripped = line.replace(/\s*<NewBadge\s*\/>/g, "");
    if (stripped.trim() !== "") kept.push(stripped);
  });
  if (kept.length !== lines.length || kept.join("") !== text) fs.writeFileSync(file, kept.join(""));
}

fs.writeFileSync(OUT, json);
const counts = Object.values(pages).reduce((acc, status) => ({ ...acc, [status]: (acc[status] ?? 0) + 1 }), {});
console.log(`docs-changes: ${version} vs ${baseline}: ${counts.new ?? 0} new, ${counts.updated ?? 0} updated, ${removedBadges} badge(s) removed`);
