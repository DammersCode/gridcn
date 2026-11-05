// Builds the per-page rewrite work list from a navigation candidate, the content map, and the current docs.
// Usage: node scripts/docs-rewrite-worklist.mjs --candidate <c19.txt> --content-map <content-map.md> [--out research/docs-rewrite-worklist] [--batch-words 7000] [--batch-pages 10]
// Writes <out>.json (machine) and <out>.md (the table of the plan). Run again whenever the candidate changes.
import { existsSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { readLf, walk, rel } from "./docs-verify-lib.mjs";

const STOP = new Set(["a", "an", "the", "to", "in", "of", "by", "from", "with", "and", "for", "on", "at"]);

export const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const slugOf = (title) => kebab(title).split("-").filter((w) => w && !STOP.has(w)).slice(0, 4).join("-");

/** Parse the candidate file: pages in sidebar order with area, group, subgroup. */
export function parseCandidate(file) {
  const pages = [];
  let area = "";
  let group = "";
  let subgroup = "";
  const read = (path) => {
    for (const raw of readLf(path).split("\n")) {
      const line = raw.replace(/^\s*\/\/.*$/, "").trimEnd();
      if (!line.trim()) continue;
      const include = /^<<\s*(.+)$/.exec(line);
      if (include) {
        read(join(dirname(path), include[1].trim()));
        continue;
      }
      const a = /^@\s*(.+)$/.exec(line);
      if (a) {
        area = a[1].trim();
        group = "";
        subgroup = "";
      }
      else if (/^###\s/.test(line)) subgroup = line.replace(/^###\s*/, "").replace(/\{[^}]*\}/g, "").trim();
      else if (line.startsWith("## ")) {
        group = line.replace(/^##s*/, "").replace(/{[^}]*}/g, "").trim();
        subgroup = "";
      }
      else if (/^-\s/.test(line)) {
        const cols = line.replace(/^-\s*/, "").split("|").map((c) => c.trim());
        pages.push({ slug: cols[0], title: cols[1], type: cols[2], words: Number(cols[3]) || 0, aliases: (cols[4] ?? "").split(",").map((x) => x.trim()).filter(Boolean), codeLines: Number(cols[5]) || 0, area, group, subgroup });
      }
    }
  };
  read(file);
  return pages;
}

/** Rows of the content map: slug -> [{ sources, kind }]. */
export function parseContentMap(file) {
  const rows = new Map();
  for (const line of readLf(file).split("\n")) {
    const cells = /^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/.exec(line);
    if (!cells || /^-+$/.test(cells[1]) || cells[1] === "Slug") continue;
    const sources = [...cells[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((s) => !s.includes("(") && !/^[A-Z]/.test(s));
    for (const slug of cells[1].split(",").map((s) => s.trim())) {
      const list = rows.get(slug) ?? [];
      list.push({ sources, kind: cells[3].split(/[;,]/)[0].trim(), note: cells[2] });
      rows.set(slug, list);
    }
  }
  return rows;
}

const actionOf = (kind) => (kind.startsWith("split plus new") ? "split+new" : /^(move|split|merge|rewrite|new)/.exec(kind)?.[1] ?? kind);

/** Which parity-matrix features a Feature page must cover with a Server mode section. */
const PARITY = {
  sorting: ["sort"], filtering: ["filter"], "header-filter": ["filter-values"], "quick-search": ["search"], "checked-rows": ["row-check"], clipboard: ["clipboard"], fill: ["fill"],
  import: ["import"], export: ["export", "print"], "undo-redo": ["undo-redo"], "row-operations": ["row-ops"], validation: ["validation"], streaming: ["streaming"],
  "url-state": ["url-state"], presence: ["presence"], "loading-state": ["loading"], "find-replace": ["find-replace"], "pinned-rows": ["pinned-rows"], "column-sizing": ["columns"],
  "pagination-client": ["pagination"], "a11y-conformance": ["announce"],
};

function demosIn(root, sources, slug) {
  const found = new Set();
  const files = [];
  for (const source of sources) {
    const base = source.replace(/\*+$/, "").replace(/\/$/, "");
    for (const candidate of [join(root, "content/docs", `${base}.mdx`), join(root, "content/docs", base, "index.mdx")]) if (existsSync(candidate)) files.push(candidate);
    if (source.includes("*")) {
      const all = walk(join(root, "content/docs", base), [".mdx"]);
      const own = all.filter((file) => {
        const name = basename(file, ".mdx");
        return name.startsWith(slug) || slug.startsWith(name);
      });
      files.push(...(own.length ? own : all));
    }
  }
  for (const file of files) for (const m of readLf(file).matchAll(/<ComponentPreview\s+name=["']([\w-]+)["']/g)) found.add(m[1]);
  return { files: files.map((f) => rel(root, f)), demos: [...found] };
}

const DEMO_RULE = { feature: "decide", task: "decide", example: "yes", step: "no", reference: "no", concept: "no", landing: "no", cheatsheet: "no" };
const CODE_RULE = { feature: "yes", task: "yes", step: "yes", example: "yes", reference: "table+sample", concept: "no", landing: "no", cheatsheet: "no" };

export function buildWorklist({ candidate, contentMap, root = process.cwd(), batchWords = 7000, batchPages = 10 }) {
  const pages = parseCandidate(candidate);
  const map = parseContentMap(contentMap);
  const groupSlug = new Map();
  const rows = pages.map((p, index) => {
    const key = `${p.area}/${p.group}/${p.subgroup}`;
    if (!groupSlug.has(key)) groupSlug.set(key, p.subgroup ? `${groupSlug.get(`${p.area}/${p.group}/`)}/${slugOf(p.subgroup)}` : slugOf(p.group));
    const first = pages.findIndex((q) => q.area === p.area && q.group === p.group && q.subgroup === p.subgroup) === index;
    const url = p.slug === "index" ? "/docs" : first ? `/docs/${groupSlug.get(key)}` : `/docs/${groupSlug.get(key)}/${slugOf(p.title)}`;
    const entries = map.get(p.slug) ?? (p.slug.startsWith("ex-") ? map.get("ex-*") : p.slug.startsWith("options-") ? map.get("options-context-menu") : /landing/.test(p.type) ? map.get("landings*") : undefined) ?? [];
    const sources = [...new Set(entries.flatMap((e) => e.sources))];
    const kinds = [...new Set(entries.map((e) => actionOf(e.kind)))];
    const action = p.type === "landing" ? "new" : kinds.length === 0 ? "unmapped" : kinds.length === 1 ? kinds[0] : kinds.join("+");
    const carried = demosIn(root, sources, p.slug);
    const generated = /cheat-|find-task|feature-matrix|ref-messages|^terms$/.test(p.slug) || entries.some((e) => /generated/.test(e.kind) || /generated/.test(e.note));
    return { ...p, url, action, sources, sourceFiles: carried.files, carriedDemos: carried.demos, demo: p.type === "feature" || p.type === "task" ? (carried.demos.length ? "carry (max 1 unless variants)" : DEMO_RULE[p.type]) : DEMO_RULE[p.type] ?? "no", code: CODE_RULE[p.type] ?? "no", generated, parity: PARITY[p.slug] ?? [] };
  });
  // Batches pack whole groups (folders) of one area in sidebar order, so writers never share a file; a group over the limit splits.
  let batch = 0;
  const batches = new Map();
  let current = [];
  let words = 0;
  let area = "";
  const flush = () => {
    if (!current.length) return;
    batch++;
    const id = `B${String(batch).padStart(2, "0")}`;
    current.forEach((r) => (r.batch = id));
    batches.set(id, { id, area, groups: [...new Set(current.map((r) => r.group))], pages: current.length, words });
    current = [];
    words = 0;
  };
  for (const list of Map.groupBy(rows, (r) => `${r.area}/${r.group}/${r.subgroup}`).values()) {
    const groupWords = list.reduce((sum, r) => sum + r.words, 0);
    if (list[0].area !== area || current.length + list.length > batchPages || words + groupWords > batchWords) flush();
    area = list[0].area;
    for (const r of list) {
      if (current.length >= batchPages || (words + r.words > batchWords && current.length)) flush();
      current.push(r);
      words += r.words;
    }
  }
  flush();
  return { rows, batches: [...batches.values()] };
}

function toMarkdown({ rows, batches }) {
  const lines = ["| Batch | Slug | Page | Type | Action | Words | Code | Demo | Sources |", "|---|---|---|---|---|---|---|---|---|"];
  for (const r of rows) lines.push(`| ${r.batch} | \`${r.slug}\` | ${r.title} | ${r.type} | ${r.action}${r.generated ? " (generated)" : ""} | ${r.words} | ${r.code} | ${r.demo} | ${r.sources.map((s) => `\`${s}\``).join(", ") || "none"} |`);
  lines.push("", `${rows.length} pages in ${batches.length} batches.`);
  return lines.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
  const list = buildWorklist({ candidate: arg("--candidate"), contentMap: arg("--content-map"), batchWords: Number(arg("--batch-words", 7000)), batchPages: Number(arg("--batch-pages", 10)) });
  const out = arg("--out", "research/docs-rewrite-worklist");
  writeFileSync(`${out}.json`, `${JSON.stringify({ pages: list.rows, batches: list.batches }, null, 1)}\n`);
  writeFileSync(`${out}.md`, `${toMarkdown(list)}\n`);
  const count = (key) => Object.entries(Object.groupBy(list.rows, (r) => r[key])).map(([k, v]) => `${k} ${v.length}`).join(", ");
  console.log(`worklist: ${list.rows.length} pages, ${list.batches.length} batches\n  by action: ${count("action")}\n  by type: ${count("type")}`);
}
