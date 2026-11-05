// Frontmatter and page-shape checks of the docs rules (AGENTS.md Docs, docs navigation ruleset).
// Usage: node scripts/verify-docs-structure.mjs [--root <dir>] [--require-type] [--worklist research/docs-rewrite-worklist.json] [--base origin/release/2.0]
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { capped, codeBlocks, frontField, readLf, rel, splitFrontmatter, urlOfPage, walk } from "./docs-verify-lib.mjs";

export const PAGE_TYPES = ["landing", "feature", "concept", "task", "step", "reference", "example", "cheatsheet"];
const MAX_TITLE = 60;
const MAX_DESCRIPTION = 160;

/** `aliases: [a, b]` or a YAML list under `aliases:`. */
export function aliasesOf(front) {
  const inline = /^aliases:\s*\[(.*)\]\s*$/m.exec(front);
  if (inline) return inline[1].split(",").map((a) => a.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  const block = /^aliases:\s*\n((?:\s+-\s+.*\n?)+)/m.exec(front);
  return block ? [...block[1].matchAll(/-\s+(.*)/g)].map((m) => m[1].trim().replace(/^["']|["']$/g, "")) : [];
}

export function run({ root = process.cwd(), requireType = false, worklist, base = "origin/release/2.0" } = {}) {
  const contentDir = join(root, "content/docs");
  const failures = [];
  const warnings = [];
  const titles = new Map();
  const aliasOwner = new Map();
  const serverModePages = new Map();
  if (worklist && existsSync(join(root, worklist))) {
    for (const row of JSON.parse(readLf(join(root, worklist))).pages ?? []) if (row.parity?.length) serverModePages.set(row.url, row.parity);
  }
  let pages = 0;
  let noRelated = 0;
  for (const file of walk(contentDir, [".mdx"])) {
    pages++;
    const text = readLf(file);
    const { front, body, bodyOffset } = splitFrontmatter(text);
    const here = rel(root, file);
    const type = frontField(front, "type");
    const isLanding = type === "landing" || (file.endsWith("index.mdx") && !type);
    const title = frontField(front, "title");
    const description = frontField(front, "description");
    if (!title) failures.push(`${here}: no title`);
    else {
      if (title.length > MAX_TITLE) failures.push(`${here}: title is ${title.length} characters, limit ${MAX_TITLE}`);
      if (titles.has(title)) failures.push(`${here}: title "${title}" is also the title of ${titles.get(title)}`);
      titles.set(title, here);
    }
    if (!description) failures.push(`${here}: no description`);
    else if (description.length > MAX_DESCRIPTION) failures.push(`${here}: description is ${description.length} characters, limit ${MAX_DESCRIPTION}`);
    if (type && !PAGE_TYPES.includes(type)) failures.push(`${here}: unknown type "${type}"`);
    if (requireType && !type) failures.push(`${here}: no type in the frontmatter`);
    if (/^status:/m.test(front)) failures.push(`${here}: remove the status: line (content/docs-changes.json holds page status)`);
    for (const alias of aliasesOf(front)) {
      const owner = aliasOwner.get(alias.toLowerCase());
      if (owner) failures.push(`${here}: alias "${alias}" is also owned by ${owner}`);
      else aliasOwner.set(alias.toLowerCase(), here);
    }
    const fenced = new Set();
    for (const block of codeBlocks(body)) for (let l = block.line - 1; l <= block.endLine; l++) fenced.add(l);
    const lines = body.split("\n");
    const h2 = [];
    lines.forEach((line, i) => {
      if (fenced.has(i + 1)) return;
      if (/^#{1,6}\s.*<NewBadge/.test(line)) failures.push(`${here}:${i + 1 + bodyOffset}: <NewBadge /> sits in a heading; put it on its own line under the heading`);
      const heading = /^##\s+(.*)$/.exec(line);
      if (heading) h2.push({ title: heading[1].replace(/`/g, "").trim(), line: i });
    });
    if (!isLanding) {
      const related = h2.find((h) => /^(related|next|where next)$/i.test(h.title));
      if (!related) {
        noRelated++;
        warnings.push(`${here}: no Related section`);
      } else {
        const end = h2.find((h) => h.line > related.line)?.line ?? lines.length;
        const links = lines.slice(related.line, end).join("\n").match(/\]\(\/docs[^)]*\)|href="\/docs/g)?.length ?? 0;
        if (links < 1 || links > 5) failures.push(`${here}: Related has ${links} docs links, expected 1 to 5`);
      }
    }
    const url = urlOfPage(contentDir, file);
    if (serverModePages.has(url) && !h2.some((h) => /^server mode$/i.test(h.title))) failures.push(`${here}: parity features ${serverModePages.get(url).join(", ")} need a "Server mode" H2`);
    if (type === "feature") {
      const firstH2 = h2[0]?.line ?? lines.length;
      if (!/<ComponentPreview/.test(lines.slice(0, firstH2).join("\n")) && !/^demos:\s*none/m.test(front)) warnings.push(`${here}: feature page has no demo before the first H2 (add "demos: none" when a code sample explains it)`);
    }
  }
  if (existsSync(join(root, ".git")) || existsSync(join(root, "..", ".git"))) {
    try {
      execFileSync("git", ["diff", "--quiet", base, "--", "content/docs-changes.json"], { cwd: root, stdio: "pipe" });
    } catch (error) {
      if (error.status === 1) failures.push(`content/docs-changes.json differs from ${base}; only the release command may change it`);
    }
  }
  return { name: "structure", checked: pages, failures, warnings, stats: { noRelated } };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
  const has = (name) => process.argv.includes(name);
  const result = run({ root: has("--root") ? arg("--root") : process.cwd(), requireType: has("--require-type"), worklist: has("--worklist") ? arg("--worklist") : undefined, base: has("--base") ? arg("--base") : undefined });
  for (const w of capped(result.warnings, 3)) console.warn(`warn  ${w}`);
  if (result.failures.length) {
    console.error(`docs structure: ${result.failures.length} failures in ${result.checked} pages (${result.stats.noRelated} without Related)\n${capped(result.failures).map((f) => `  ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`docs structure: ${result.checked} pages ok (${result.stats.noRelated} without Related)`);
}
