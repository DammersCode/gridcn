#!/usr/bin/env node
// Builds the old-to-new URL map for a navigation candidate. Usage: node scripts/docs-nav-url-map.mjs <candidate.txt> [--json]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const candidateFile = process.argv[2];
const asJson = process.argv.includes("--json");
const kebab = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function candidateLines(file) {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .flatMap((l) => (l.startsWith("<< ") ? candidateLines(join(dirname(file), l.slice(3).trim())) : [l]));
}

const bySlug = new Map();
let group = "";
for (const raw of candidateLines(candidateFile)) {
  const line = raw.trim();
  if (line.startsWith("## ")) group = line.slice(3).replace(/\{.*\}/, "").trim();
  else if (line.startsWith("- ")) {
    const [slug, title, type] = line.slice(2).split("|").map((x) => x.trim());
    bySlug.set(slug, { title, type, group, url: type === "landing" ? `/docs/${kebab(group)}` : `/docs/${kebab(group)}/${kebab(title)}` });
  }
}

const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const oldPages = walk("content/docs")
  .filter((f) => f.endsWith(".mdx"))
  .map((f) => relative("content/docs", f).replaceAll("\\", "/").replace(/\.mdx$/, ""));
const oldSet = new Set(oldPages);
const oldUrl = (p) => "/docs" + (p === "index" ? "" : "/" + p.replace(/\/index$/, ""));

const map = new Map();
const add = (old, slug) => {
  if (!bySlug.has(slug)) return;
  const list = map.get(old) ?? [];
  if (!list.includes(slug)) list.push(slug);
  map.set(old, list);
};

for (const row of readFileSync("research/docs-navigation/content-map.md", "utf8").split(/\r?\n/)) {
  if (!row.startsWith("| ") || row.startsWith("| Slug") || row.startsWith("|---")) continue;
  const [, slugCell, sourceCell] = row.split("|").map((x) => x.trim());
  const slugs = slugCell.replace(/`/g, "").split(",").map((x) => x.trim()).filter((x) => x && !x.endsWith("*"));
  const tokens = [...sourceCell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  for (const t of tokens) {
    const old = oldSet.has(t) ? t : oldSet.has(t.replace(/^addons\/index$/, "addons/index")) ? t : null;
    if (old) for (const s of slugs) add(old, s);
  }
}

const sectionBySlugPrefix = [
  [/^examples\/foundations\/minimal-grid$/, "ex-minimal"], [/^examples\/foundations\/editable-grid$/, "ex-editable"],
  [/^examples\/foundations\/cell-types$/, "ex-celltypes"], [/^examples\/foundations\/custom-cells$/, "ex-custom"],
  [/^examples\/columns\/pinning$/, "ex-pinning-cols"], [/^examples\/columns\/drag-reorder$/, "ex-col-drag"],
  [/^examples\/columns\/filtering$/, "ex-col-filter"], [/^examples\/columns\/custom-headers$/, "ex-col-headers"],
  [/^examples\/columns\/column-layout$/, "ex-col-layout"], [/^examples\/columns\/column-groups$/, "ex-col-groups"],
  [/^examples\/rows\/pinning$/, "ex-pinning-rows"], [/^examples\/rows\/row-operations$/, "ex-row-ops"],
  [/^examples\/rows\/drag-reorder$/, "ex-row-drag"], [/^examples\/rows\/row-markers$/, "ex-row-markers"],
  [/^examples\/rows\/actions$/, "ex-row-actions"], [/^examples\/rows\/streaming$/, "ex-row-stream"],
  [/^examples\/validation\/validation$/, "ex-validation"], [/^examples\/validation\/async-validation$/, "ex-async-validation"],
  [/^examples\/validation\/server-errors$/, "ex-server-errors"], [/^examples\/validation\/cross-field$/, "ex-cross-field"],
  [/^examples\/validation\/async-gates$/, "ex-async-gates"], [/^examples\/data\/server-side$/, "ex-server"],
  [/^examples\/data\/large-data$/, "ex-large"], [/^examples\/data\/lazy\//, "ex-lazy"],
  [/^examples\/data\/pagination\//, "ex-pages"], [/^examples\/data\/orm\//, "ex-orm"],
  [/^examples\/appearance\/styling$/, "ex-styling"], [/^examples\/appearance\/loading-states$/, "ex-loading"],
  [/^examples\/appearance\/i18n-rtl$/, "ex-rtl"], [/^examples\/(\w+\/)?index$/, "examples-index"],
  [/^examples\/data\/(lazy|pagination|orm)\/index$/, "ex-data-index"],
  [/^recipes\/index$/, "examples-index"], [/^recipes\/data-fetching\/(index|server-side|server-side-sort-filter)$/, "ref-server-rows"],
  [/^recipes\/data-fetching\/server-round-trip$/, "server-round-trip"], [/^recipes\/data-fetching\/tanstack-query$/, "scroll-fetch-libs"],
  [/^recipes\/ui-patterns\/detail-panel$/, "detail-panel"], [/^recipes\/ui-patterns\/bulk-actions$/, "bulk-actions"],
  [/^recipes\/ui-patterns\/remember-view$/, "remember-view"], [/^recipes\/ui-patterns\/multiple-grids$/, "multiple-grids"],
  [/^recipes\/editing\/edit-row-with-form$/, "edit-row-form"], [/^recipes\/editing\/auth-gated-cells$/, "auth-gated"],
  [/^recipes\/editing\/custom-cell-type$/, "custom-cell-example"], [/^recipes\/(\w+\/)?index$/, "examples-index"],
  [/^hooks\/use-debounce$/, "use-debounce"], [/^addons\/index$/, "feature-matrix"], [/^agent-skills$/, "agent-skills"],
  [/^playground$/, "playground"], [/^license$/, "license"], [/^terms$/, "terms"], [/^index$/, "index"],
];
for (const old of oldPages) {
  if (map.has(old)) continue;
  for (const [re, slug] of sectionBySlugPrefix) if (re.test(old)) add(old, slug);
}

const PRIMARY = { "project-status": "version-policy", "quick-start": "first-grid", "installation": "install", "index": "index", "addons/sort-list": "sorting", "api-reference": "ref-index", "events-state": "events-index" };
const byName = (old) => old.split("/").pop();
const rows = oldPages.map((old) => {
  const preferred = PRIMARY[old] ?? byName(old);
  const slugs = [...(map.get(old) ?? (PRIMARY[old] ? [PRIMARY[old]] : []))].sort((a, b) => (b === preferred ? 1 : 0) - (a === preferred ? 1 : 0));
  const primary = slugs.length ? bySlug.get(slugs[0]) : null;
  const landing = slugs.length > 1 && slugs[0] !== preferred ? [...bySlug.values()].find((v) => v.group === primary.group && v.type === "landing") : null;
  const target = landing ?? primary;
  return { old: oldUrl(old), file: old + ".mdx", slugs, target: target?.url ?? null, split: slugs.length > 1 };
});

if (asJson) console.log(JSON.stringify(rows, null, 1));
else {
  console.log("| Old URL | New URL | Pages it feeds |\n|---|---|---|");
  for (const r of rows) console.log(`| \`${r.old}\` | ${r.target ? "`" + r.target + "`" : "**unmapped**"} | ${r.slugs.length} |`);
  console.log(`\nunmapped: ${rows.filter((r) => !r.target).length}, split: ${rows.filter((r) => r.split).length}, same URL: ${rows.filter((r) => r.target === r.old).length}`);
}
const used = new Set([...map.values()].flat());
const orphans = [...bySlug.keys()].filter((s) => !used.has(s));
console.error(`new pages with no old source (new text or landings): ${orphans.length}`);
