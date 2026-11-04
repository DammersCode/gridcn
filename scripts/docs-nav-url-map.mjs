#!/usr/bin/env node
// Builds the old-to-new URL map for a navigation candidate from research/docs-navigation/content-map.md.
// Usage (from the repo root): node scripts/docs-nav-url-map.mjs <candidate.txt> [--json | --anchors]
// Env: ANCHOR_REVIEW=<file> writes the anchors of split pages that have no target; LIST_NEW=1 lists pages with no old source.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const candidateFile = process.argv[2];
const asJson = process.argv.includes("--json");
const asAnchors = process.argv.includes("--anchors");
const readLf = (file) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const kebab = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").slice(0, 4).join("-");
const siteSlug = (heading) =>
  heading.replace(/\[#[^\]]+\]\s*$/, "").replace(/`/g, "").trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");

function candidateLines(file) {
  return readLf(file)
    .split("\n")
    .flatMap((l) => (l.startsWith("<< ") ? candidateLines(join(dirname(file), l.slice(3).trim())) : [l]));
}

const bySlug = new Map();
let group = "";
for (const raw of candidateLines(candidateFile)) {
  const line = raw.trim();
  if (line.startsWith("## ")) group = line.slice(3).replace(/\{.*\}/, "").trim();
  else if (line.startsWith("- ")) {
    const [slug, title, type] = line.slice(2).split("|").map((x) => x.trim());
    const url = slug === "index" ? "/docs" : type === "landing" ? `/docs/${kebab(group)}` : `/docs/${kebab(group)}/${kebab(title)}`;
    bySlug.set(slug, { title, type, group, url });
  }
}

const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const oldPages = walk("content/docs")
  .filter((f) => f.endsWith(".mdx"))
  .map((f) => relative("content/docs", f).replaceAll("\\", "/").replace(/\.mdx$/, ""));
const oldSet = new Set(oldPages);
const oldUrl = (p) => "/docs" + (p === "index" ? "" : "/" + p.replace(/\/index$/, ""));

const map = new Map();
const unknown = new Set();
const sections = [];
const add = (old, slug) => {
  if (!bySlug.has(slug)) {
    unknown.add(slug);
    return;
  }
  const list = map.get(old) ?? [];
  if (!list.includes(slug)) list.push(slug);
  map.set(old, list);
};

for (const row of readLf("research/docs-navigation/content-map.md").split("\n")) {
  if (!row.startsWith("| ") || row.startsWith("| Slug") || row.startsWith("|---")) continue;
  const [, slugCell, sourceCell] = row.split("|").map((x) => x.trim());
  const slugs = slugCell.replace(/`/g, "").split(",").map((x) => x.trim()).filter((x) => x && !x.endsWith("*"));
  for (const t of [...sourceCell.matchAll(/`([^`]+)`/g)].map((m) => m[1])) if (oldSet.has(t)) for (const s of slugs) add(t, s);
  for (const m of sourceCell.matchAll(/`([^`]+)`\s*\(([^)]*)\)/g)) {
    sections.push({ old: m[1], slugs, titles: m[2].split(/,\s*|\s+and\s+/).map((x) => x.replace(/`/g, "").trim().toLowerCase()) });
  }
}

const SECTION_FALLBACKS = [
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
  [/^examples\/appearance\/i18n-rtl$/, "ex-rtl"], [/^examples\/index$/, "examples-index"],
  [/^examples\/columns\/index$/, "ex-columns-index"], [/^examples\/rows\/index$/, "ex-rows-index"],
  [/^examples\/validation\/index$/, "ex-validation-index"], [/^examples\/data\/(index|lazy\/index|pagination\/index|orm\/index)$/, "ex-data-index"],
  [/^examples\/appearance\/index$/, "ex-appearance-index"], [/^examples\/foundations\/index$/, "examples-index"],
  [/^recipes\/index$/, "find-task"], [/^recipes\/data-fetching\/(index|server-side|server-side-sort-filter)$/, "ref-server-rows"],
  [/^recipes\/data-fetching\/server-round-trip$/, "server-round-trip"], [/^recipes\/data-fetching\/tanstack-query$/, "scroll-fetch-libs"],
  [/^recipes\/ui-patterns\/detail-panel$/, "detail-panel"], [/^recipes\/ui-patterns\/bulk-actions$/, "bulk-actions"],
  [/^recipes\/ui-patterns\/remember-view$/, "remember-view"], [/^recipes\/ui-patterns\/multiple-grids$/, "multiple-grids"],
  [/^recipes\/editing\/edit-row-with-form$/, "edit-row-form"], [/^recipes\/editing\/auth-gated-cells$/, "auth-gated"],
  [/^recipes\/editing\/custom-cell-type$/, "custom-cell-example"], [/^recipes\/(data-fetching|editing|ui-patterns)\/index$/, "find-task"],
  [/^hooks\/use-debounce$/, "use-debounce"], [/^addons\/index$/, "feature-matrix"], [/^agent-skills$/, "agent-skills"],
  [/^playground$/, "playground"], [/^license$/, "license"], [/^terms$/, "terms"], [/^index$/, "index"],
];
for (const old of oldPages) {
  if (map.has(old)) continue;
  for (const [re, slug] of SECTION_FALLBACKS) if (re.test(old)) add(old, slug);
}

if (unknown.size) {
  console.error(`content map slugs missing from the candidate: ${[...unknown].join(", ")}`);
  process.exitCode = 1;
}

const PRIMARY = {
  "project-status": "version-policy", "quick-start": "first-grid", installation: "install", index: "index",
  "addons/sort-list": "sorting", "api-reference": "ref-index", "events-state": "events-index",
};
const rows = oldPages.map((old) => {
  const preferred = PRIMARY[old] ?? old.split("/").pop();
  const slugs = [...new Set([...(PRIMARY[old] ? [PRIMARY[old]] : []), ...(map.get(old) ?? [])])]
    .filter((s) => bySlug.has(s))
    .sort((a, b) => (b === preferred ? 1 : 0) - (a === preferred ? 1 : 0));
  const primary = slugs.length ? bySlug.get(slugs[0]) : null;
  const landing = slugs.length > 1 && slugs[0] !== preferred ? [...bySlug.values()].find((v) => v.group === primary.group && v.type === "landing") : null;
  const target = landing ?? primary;
  return { old: oldUrl(old), file: old + ".mdx", slugs, target: target?.url ?? null, split: slugs.length > 1 };
});

if (asAnchors) {
  const out = {};
  const review = [];
  let mapped = 0;
  for (const r of rows) {
    const oldPage = r.file.replace(/\.mdx$/, "");
    const entries = {};
    for (const m of readLf(join("content/docs", r.file)).matchAll(/^## (.+)$/gm)) {
      const explicit = /\[#([^\]]+)\]\s*$/.exec(m[1])?.[1];
      const anchor = explicit ?? siteSlug(m[1]);
      const title = m[1].replace(/\[#[^\]]+\]\s*$/, "").replace(/`/g, "").trim().toLowerCase();
      const hit = sections.find((x) => x.old === oldPage && x.titles.some((t) => t && (title === t || title.startsWith(t) || t.startsWith(title))));
      const slug = hit?.slugs.find((x) => bySlug.has(x));
      if (slug) mapped++;
      else if (r.split) review.push(`${r.file}#${anchor}`);
      entries[anchor] = `${slug ? bySlug.get(slug).url : r.target}#${anchor}`;
    }
    out[r.old] = entries;
  }
  console.error(`anchors: ${Object.values(out).reduce((n, e) => n + Object.keys(e).length, 0)}, mapped to a section page: ${mapped}, split-page anchors needing a manual target: ${review.length}`);
  if (process.env.ANCHOR_REVIEW) writeFileSync(process.env.ANCHOR_REVIEW, review.join("\n"));
  console.log(JSON.stringify(out, null, 1));
} else if (asJson) {
  console.log(JSON.stringify(rows, null, 1));
} else {
  console.log("| Old URL | New URL | Pages it feeds |\n|---|---|---|");
  for (const r of rows) console.log(`| \`${r.old}\` | ${r.target ? "`" + r.target + "`" : "**unmapped**"} | ${r.slugs.length} |`);
  console.log(`\nunmapped: ${rows.filter((r) => !r.target).length}, split: ${rows.filter((r) => r.split).length}, same URL: ${rows.filter((r) => r.target === r.old).length}`);
}
const used = new Set(rows.flatMap((r) => r.slugs));
const orphans = [...bySlug.keys()].filter((s) => !used.has(s));
console.error(`new pages with no old source (new text or landings): ${orphans.length}`);
if (process.env.LIST_NEW) console.error(orphans.map((o) => `${bySlug.get(o).type}:${o}`).join("\n"));
