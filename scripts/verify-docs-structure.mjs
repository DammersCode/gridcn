// Frontmatter and page-shape checks of the docs rules (AGENTS.md Docs, docs navigation ruleset).
// Usage: node scripts/verify-docs-structure.mjs [--root <dir>] [--require-type] [--worklist research/docs-rewrite-worklist.json] [--base origin/release/2.0]
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { capped, codeBlocks, frontField, proseOnly, readLf, rel, splitFrontmatter, urlOfPage, walk } from "./docs-verify-lib.mjs";

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

// The YAML parser of the docs build (fumadocs-core), so a page that breaks the build fails here first.
const lucideIcons = createRequire(import.meta.url)("lucide-react").icons;
const yaml = createRequire(createRequire(import.meta.url).resolve("fumadocs-core/package.json"))("yaml");

export function run({ root = process.cwd(), requireType = false, requireRelated = false, worklist, base = "origin/release/2.0" } = {}) {
  const contentDir = join(root, "content/docs");
  const failures = [];
  const warnings = [];
  const titles = new Map();
  const aliasOwner = new Map();
  const serverModePages = new Map();
  const rows = [];
  if (worklist && existsSync(join(root, worklist))) {
    for (const row of JSON.parse(readLf(join(root, worklist))).pages ?? []) {
      rows.push(row);
      if (row.parity?.length) serverModePages.set(row.url, row.parity);
    }
  } else if (worklist && requireRelated) failures.push(`work list ${worklist} not found`);
  const pageAliases = new Map();
  const typeByUrl = new Map();
  const referenceLinks = [];
  let pages = 0;
  let noRelated = 0;
  for (const file of walk(contentDir, [".json"])) {
    try {
      JSON.parse(readLf(file));
    } catch (error) {
      failures.push(`${rel(root, file)}: not valid JSON: ${error.message}`);
    }
  }
  for (const file of walk(contentDir, [".mdx"])) {
    pages++;
    const text = readLf(file);
    const { front, body, bodyOffset } = splitFrontmatter(text);
    const here = rel(root, file);
    try {
      yaml.parse(front);
    } catch (error) {
      failures.push(`${here}: the frontmatter is not valid YAML (quote a value that holds ": "): ${error.message.split("\n")[0]}`);
    }
    const type = frontField(front, "type");
    const isLanding = type === "landing" || (file.endsWith("index.mdx") && !type);
    const title = frontField(front, "title");
    const description = frontField(front, "description");
    if (body.includes("docs-stub")) failures.push(`${here}: the page is still a stub`);
    if (!title) failures.push(`${here}: no title`);
    else {
      if (title.length > MAX_TITLE) failures.push(`${here}: title is ${title.length} characters, limit ${MAX_TITLE}`);
      if (titles.has(title)) failures.push(`${here}: title "${title}" is also the title of ${titles.get(title)}`, `${titles.get(title)}: title "${title}" is also the title of ${here}`);
      titles.set(title, here);
    }
    if (!description) failures.push(`${here}: no description`);
    else if (description.length > MAX_DESCRIPTION) failures.push(`${here}: description is ${description.length} characters, limit ${MAX_DESCRIPTION}`);
    if (type && !PAGE_TYPES.includes(type)) failures.push(`${here}: unknown type "${type}"`);
    if (requireType && !type) failures.push(`${here}: no type in the frontmatter`);
    if (/^status:/m.test(front)) failures.push(`${here}: remove the status: line (content/docs-changes.json holds page status)`);
    pageAliases.set(urlOfPage(contentDir, file), { here, aliases: aliasesOf(front).map((a) => a.toLowerCase()) });
    for (const alias of aliasesOf(front)) {
      const owner = aliasOwner.get(alias.toLowerCase());
      if (owner) failures.push(`${here}: alias "${alias}" is also owned by ${owner}`, `${owner}: alias "${alias}" is also owned by ${here}`);
      else aliasOwner.set(alias.toLowerCase(), here);
    }
    const tableLines = proseOnly(body).split("\n");
    tableLines.forEach((line, i) => {
      if (!/^\s*\|/.test(line) || /^\s*\|[\s:|-]+\|\s*$/.test(line)) return;
      let head = i;
      while (head > 0 && /^\s*\|/.test(tableLines[head - 1])) head--;
      const count = (text) => text.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).length;
      if (head !== i && count(line) !== count(tableLines[head])) failures.push(`${here}:${i + 1 + bodyOffset}: table row has ${count(line)} cells, the header has ${count(tableLines[head])}; escape | inside a cell as \\|`);
    });
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
    const folderMeta = join(file, "..", "meta.json");
    if (title && existsSync(folderMeta) && JSON.parse(readLf(folderMeta)).title === title) failures.push(`${here}: title "${title}" repeats the folder title in the sidebar; name the page for what it holds`);
    if (isLanding && !h2.length) failures.push(`${here}: a landing page holds content that no child page has (at least one H2); a folder without an index lists its children`);
    if (!isLanding) {
      const related = h2.find((h) => /^(related|next|where next)$/i.test(h.title));
      if (!related) {
        noRelated++;
        (requireRelated ? failures : warnings).push(`${here}: no Related section`);
      } else {
        if (h2.at(-1) !== related) (requireRelated ? failures : warnings).push(`${here}: Related is not the last section`);
        const end = h2.find((h) => h.line > related.line)?.line ?? lines.length;
        const links = lines.slice(related.line, end).join("\n").match(/\]\(\/docs[^)]*\)|href="\/docs/g)?.length ?? 0;
        if (links < 1 || links > 5) failures.push(`${here}: Related has ${links} docs links, expected 1 to 5`);
      }
    }
    const url = urlOfPage(contentDir, file);
    typeByUrl.set(url, type);
    if (type === "feature" || type === "task") referenceLinks.push({ here, url, targets: [...body.matchAll(/\]\((\/docs[^)#\s]*)/g)].map((m) => m[1]) });
    if (serverModePages.has(url) && !h2.some((h) => /^server mode$/i.test(h.title))) failures.push(`${here}: parity features ${serverModePages.get(url).join(", ")} need a "Server mode" H2`);
    if (type === "feature") {
      const firstH2 = h2[0]?.line ?? lines.length;
      if (!/<ComponentPreview/.test(lines.slice(0, firstH2).join("\n")) && !/^demos:\s*none/m.test(front)) warnings.push(`${here}: feature page has no demo before the first H2 (add "demos: none" when a code sample explains it)`);
    }
  }
  if (requireRelated) {
    for (const page of referenceLinks) {
      if (!page.targets.some((t) => ["reference", "concept", "cheatsheet"].includes(typeByUrl.get(t) ?? ""))) failures.push(`${page.here}: a feature or task page links a reference or concept page (rule P10)`);
    }
    for (const row of rows) {
      const found = pageAliases.get(row.url);
      if (!found) failures.push(`work list: ${row.slug} has no page at ${row.url}`);
      else for (const alias of row.aliases ?? []) if (!found.aliases.includes(alias.toLowerCase())) failures.push(`${found.here}: alias "${alias}" from the work list is missing`);
    }
  }
  if (existsSync(join(root, ".git")) || existsSync(join(root, "..", ".git"))) {
    try {
      execFileSync("git", ["diff", "--quiet", base, "--", "content/docs-changes.json"], { cwd: root, stdio: "pipe" });
    } catch (error) {
      if (error.status === 1) failures.push(`content/docs-changes.json differs from ${base}; only the release command may change it`);
      else (requireRelated ? failures : warnings).push(`cannot compare content/docs-changes.json with ${base}`);
    }
  }
  failures.push(...sectionSwitcherFailures(root));
  return { name: "structure", checked: pages, failures, warnings, stats: { noRelated } };
}

export const SECTION_FOLDERS = ["(learn)", "(build)", "(server)", "(evaluate)", "(reference)", "(examples)"];

/** The section switcher needs six `root: true` folders with title and icon, and the docs layout must pass `tabs`. */
export function sectionSwitcherFailures(root) {
  const layoutFile = join(root, "app/docs/layout.tsx");
  if (!existsSync(layoutFile)) return [];
  const failures = [];
  for (const folder of SECTION_FOLDERS) {
    const metaFile = join(root, "content/docs", folder, "meta.json");
    if (!existsSync(metaFile)) {
      failures.push(`content/docs/${folder}/meta.json is missing (section switcher)`);
      continue;
    }
    let meta;
    try {
      meta = JSON.parse(readLf(metaFile));
    } catch {
      continue;
    }
    if (meta.root !== true) failures.push(`content/docs/${folder}/meta.json needs "root": true (section switcher)`);
    if (!meta.title) failures.push(`content/docs/${folder}/meta.json needs a "title" (section switcher)`);
    if (!meta.icon) failures.push(`content/docs/${folder}/meta.json needs an "icon" (section switcher)`);
  }
  if (!/<DocsLayout[^>]*\btabs=\{/.test(readLf(layoutFile))) failures.push("app/docs/layout.tsx must pass `tabs` to DocsLayout (section switcher)");
  return failures;
}

/** Every sidebar page and folder carries an icon, and siblings never share one. Hidden entries (separators, `...`, `!x`, a folder's own `index`) need none. */
export function sidebarIconFailures(root) {
  const contentDir = join(root, "content/docs");
  const rootMeta = join(contentDir, "meta.json");
  if (!existsSync(rootMeta)) return [];
  const failures = [];
  const readMeta = (dir) => {
    try {
      return JSON.parse(readLf(join(dir, "meta.json")));
    } catch {
      return {};
    }
  };
  const visit = (dir, meta) => {
    const seen = new Map();
    for (const entry of meta.pages ?? []) {
      if (/^(---|\.\.\.|!|\[)/.test(entry) || entry === "index") continue;
      const path = join(dir, entry);
      const page = `${path}.mdx`;
      let icon;
      let here;
      let childMeta;
      if (existsSync(page)) {
        icon = frontField(splitFrontmatter(readLf(page)).front, "icon");
        here = rel(root, page);
      } else if (existsSync(join(path, "meta.json"))) {
        childMeta = readMeta(path);
        icon = childMeta.icon;
        here = rel(root, join(path, "meta.json"));
      } else continue;
      if (!icon) failures.push(`${here}: no icon (every sidebar entry needs one)`);
      else if (!lucideIcons[icon]) failures.push(`${here}: icon "${icon}" is not a lucide icon name`);
      else if (seen.has(icon)) failures.push(`${here}: icon "${icon}" is also the icon of ${seen.get(icon)}`);
      else seen.set(icon, here);
      if (childMeta && !childMeta.root) visit(path, childMeta);
    }
  };
  const visitRoot = (dir, meta) => {
    for (const entry of meta.pages ?? []) {
      const path = join(dir, entry);
      if (existsSync(join(path, "meta.json"))) visit(path, readMeta(path));
    }
  };
  visitRoot(contentDir, readMeta(contentDir));
  return failures;
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
