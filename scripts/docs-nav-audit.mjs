#!/usr/bin/env node
// Audits content/docs and navigation candidates against research/docs-navigation-ruleset.md.
// Usage (from the repo root): node scripts/docs-nav-audit.mjs [--json | --sitemap | --check | --candidate <file> | --queries <queries> <candidate>] [dir]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const candidateIdx = process.argv.indexOf("--candidate");
const candidateFile = candidateIdx > 0 ? process.argv[candidateIdx + 1] : null;
const queriesAt = process.argv.indexOf("--queries");
const isQueryArg = (i) => queriesAt > 0 && (i === queriesAt + 1 || i === queriesAt + 2);
const root = process.argv.find((a, i) => i > 1 && !a.startsWith("--") && a !== candidateFile && !isQueryArg(i)) ?? "content/docs";
const asJson = process.argv.includes("--json");
const asSitemap = process.argv.includes("--sitemap");
const asCheck = process.argv.includes("--check");

const SCREEN_WORDS = 250;
const SCREEN_CODE_LINES = 35;
const SCREEN_PREVIEW = 0.6;
const EXCEPTIONS_FILE = "research/docs-navigation/exceptions.txt";

const BUDGETS = {
  landing: { target: [80, 350], hard: 400, screens: 3, h2: [0, 6] },
  feature: { target: [400, 1200], hard: 1500, screens: 8, h2: [2, 8] },
  concept: { target: [300, 1000], hard: 1200, screens: 6, h2: [2, 5] },
  task: { target: [200, 800], hard: 1000, screens: 6, h2: [2, 8] },
  step: { target: [200, 600], hard: 800, screens: 5, h2: [2, 6] },
  reference: { target: [300, 1500], hard: 2000, screens: 14, h2: [3, 10] },
  example: { target: [100, 500], hard: 800, screens: 6, h2: [0, 5] },
  cheatsheet: { target: [0, 1200], hard: 1200, screens: 12, h2: [2, 10] },
};

const STOP = new Set(["a", "an", "the", "to", "in", "of", "by", "from", "with", "and", "for", "on", "at"]);
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const readLf = (file) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function measure(src) {
  const body = src.replace(/^---[\s\S]*?\n---\n/, "");
  let codeLines = 0;
  let previews = 0;
  let inFence = false;
  const prose = [];
  let longestRun = 0;
  let run = 0;
  let h2 = 0;
  let h3 = 0;
  let steps = 0;
  let wideLines = 0;
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      codeLines++;
      if (line.length > 80) wideLines++;
      continue;
    }
    if (/^\s*\d+\.\s/.test(line)) steps++;
    if (/<ComponentPreview/.test(line)) previews++;
    if (/^\s*## /.test(line)) h2++;
    if (/^\s*### /.test(line)) h3++;
    if (/^#{1,6}\s/.test(line) || line.trim() === "" || /^\s*([-*]|\d+\.)\s/.test(line)) {
      longestRun = Math.max(longestRun, run);
      run = 0;
    }
    if (!/^\s*[<|]/.test(line) && !/^#{1,6}\s/.test(line)) run += line.split(/\s+/).filter(Boolean).length;
    prose.push(line);
  }
  longestRun = Math.max(longestRun, run);
  const text = prose.join("\n").replace(/<[^>]+>/g, " ").replace(/[`*_|#>\-[\]()]/g, " ");
  const words = text.split(/\s+/).filter(Boolean).length;
  const longSentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.split(/\s+/).filter(Boolean).length > 25).length;
  const tableRows = (body.match(/^\|.*\|\s*$/gm) ?? []).length;
  const screens = words / SCREEN_WORDS + codeLines / SCREEN_CODE_LINES + previews * SCREEN_PREVIEW;
  return { words, h2, h3, codeLines, previews, tableRows, longestRun, steps, wideLines, longSentences, screens: +screens.toFixed(1) };
}

const pages = existsSync(root)
  ? walk(root)
      .filter((f) => f.endsWith(".mdx"))
      .map((f) => ({ path: relative(root, f).replaceAll("\\", "/"), ...measure(readLf(f)) }))
      .sort((a, b) => b.screens - a.screens)
  : [];

function frontField(src, name) {
  const front = /^---\n([\s\S]*?)\n---/.exec(src)?.[1] ?? "";
  return new RegExp(`^${name}:\\s*(.+)$`, "m").exec(front)?.[1].replace(/^["']|["']$/g, "");
}

function sitemap(dir, depth, byPath) {
  const metaPath = join(dir, "meta.json");
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : { pages: [] };
  const lines = [];
  const pad = "  ".repeat(depth);
  for (const entry of meta.pages ?? []) {
    const sep = /^---(?:\[\w+\])?(.+)---$/.exec(entry);
    if (sep) {
      lines.push(`${pad}## ${sep[1]}`);
      continue;
    }
    const rel = relative(root, join(dir, entry)).replaceAll("\\", "/");
    const file = join(dir, `${entry}.mdx`);
    const folder = join(dir, entry);
    if (existsSync(file)) {
      const m = byPath.get(rel + ".mdx");
      const src = readLf(file);
      const h2s = [...src.matchAll(/^## (.+)$/gm)].map((x) => x[1].replace(/<[^>]+>/g, "").trim());
      lines.push(`${pad}- ${frontField(src, "title") ?? "?"}  [${rel}] ${m.words}w ${m.screens}scr h2=${m.h2}${h2s.length ? ": " + h2s.join(" | ") : ""}`);
    } else if (existsSync(folder) && statSync(folder).isDirectory()) {
      const fm = JSON.parse(readFileSync(join(folder, "meta.json"), "utf8"));
      lines.push(`${pad}- [folder] ${fm.title} (${rel}/)`);
      lines.push(...sitemap(folder, depth + 1, byPath));
    }
  }
  return lines;
}

function pageType(path, src) {
  const declared = frontField(src, "type");
  if (declared) return declared;
  if (path.endsWith("index.mdx")) return "landing";
  return "feature";
}

function readExceptions() {
  if (!existsSync(EXCEPTIONS_FILE)) return new Set();
  return new Set(
    readLf(EXCEPTIONS_FILE)
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"))
      .map((l) => l.trim().split(/\s+/).slice(0, 2).join(" ")),
  );
}

function check() {
  const titles = new Map();
  const exceptions = readExceptions();
  const rows = pages.map((p) => {
    const src = readLf(join(root, p.path));
    const type = pageType(p.path, src);
    const title = frontField(src, "title") ?? "?";
    titles.set(title, [...(titles.get(title) ?? []), p.path]);
    const fails = [];
    const warns = [];
    const b = BUDGETS[type];
    if (!b) {
      fails.push(`N6 unknown type "${type}"`);
      return { path: p.path, type, title, words: p.words, screens: p.screens, h2: p.h2, fails, warns };
    }
    const generated = /^generated:\s*true/m.test(src);
    const skip = (rule) => generated && (rule === "P1" || rule === "P2");
    const add = (list, rule, msg) => {
      if (!skip(rule) && !exceptions.has(`${rule} ${p.path}`)) list.push(`${rule} ${msg}`);
    };
    if (p.words > b.hard) add(fails, "P1", `words ${p.words}>${b.hard}`);
    else if (p.words > b.target[1]) add(warns, "P1", `words ${p.words}>${b.target[1]}`);
    if (p.screens > b.screens) add(fails, "P1", `screens ${p.screens}>${b.screens}`);
    if (p.h2 > b.h2[1]) add(fails, "P2", `h2 ${p.h2}>${b.h2[1]}`);
    if (p.h2 < b.h2[0]) add(warns, "P2", `h2 ${p.h2}<${b.h2[0]}`);
    if (p.longestRun > 110) add(warns, "P4", `paragraph ${p.longestRun}w`);
    if (p.longSentences > 0) add(warns, "P4", `${p.longSentences} sentences over 25 words`);
    if (type === "task" && p.steps > 12) add(fails, "P15", `${p.steps} numbered steps`);
    else if (type === "task" && p.steps > 7) add(warns, "P15", `${p.steps} numbered steps`);
    if (p.wideLines > 0) add(warns, "P16", `${p.wideLines} code lines over 80 characters`);
    if (p.words < 80 && type !== "landing") add(fails, "P11", `words ${p.words}<80`);
    const description = frontField(src, "description");
    if (!description) add(fails, "P8", "no description");
    else if (description.length > 160) add(fails, "P8", `description ${description.length} chars`);
    if (title.length > 60) add(fails, "N1", `title ${title.length} chars`);
    return { path: p.path, type, title, words: p.words, screens: p.screens, h2: p.h2, fails, warns };
  });
  for (const [title, paths] of titles) {
    if (paths.length > 1) for (const r of rows.filter((x) => paths.includes(x.path))) r.fails.push(`N2 duplicate title "${title}"`);
  }
  return rows;
}

function candidateLines(file) {
  const dir = dirname(file);
  return readLf(file)
    .split("\n")
    .flatMap((l) => (l.startsWith("<< ") ? candidateLines(join(dir, l.slice(3).trim())) : [l]));
}

function parseCandidate(file) {
  const areas = [];
  let area = null;
  let group = null;
  let sub = null;
  for (const raw of candidateLines(file)) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    if (line.startsWith("@ ")) {
      area = { name: line.slice(2).trim(), groups: [] };
      areas.push(area);
      group = sub = null;
    } else if (line.startsWith("### ")) {
      sub = { name: line.slice(4).replace(/\{.*\}/, "").trim(), open: /\{open\}/.test(line), pages: [] };
      group.subs.push(sub);
    } else if (line.startsWith("## ")) {
      group = { name: line.slice(3).replace(/\{.*\}/, "").trim(), az: /\{az\}/.test(line), pages: [], subs: [] };
      area.groups.push(group);
      sub = null;
    } else if (line.startsWith("- ")) {
      const [slug, title, type, words, aliases = ""] = line.slice(2).split("|").map((x) => x.trim());
      (sub ?? group).pages.push({ slug, title, type, words: Number(words) || 0, aliases: aliases.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) });
    }
  }
  return areas;
}

function checkCandidate(file) {
  const out = [];
  const areas = parseCandidate(file);
  const titles = new Map();
  const allUrls = new Set();
  const fail = (rule, msg) => out.push(`FAIL ${rule} ${msg}`);
  const warn = (rule, msg) => out.push(`warn ${rule} ${msg}`);
  const checkGroupSize = (label, list, isSub) => {
    if (list.length > 12) fail("S3", `${isSub ? "subgroup" : "group"} "${label}" has ${list.length} pages (cap 12)`);
    else if (list.length > 7) warn("S3", `${isSub ? "subgroup" : "group"} "${label}" has ${list.length} pages (target 7)`);
  };
  if (areas.length < 4 || areas.length > 7) fail("S1", `areas ${areas.length} (want 4..7)`);
  else if (areas.length > 6) warn("S1", `areas ${areas.length} (target 4..6)`);
  let total = 0;
  const perArea = [];
  for (const a of areas) {
    const entryArea = /learn|start/i.test(a.name);
    const [lo, hi] = entryArea ? [3, 7] : [4, 10];
    if (a.groups.length < lo || a.groups.length > hi) fail("S2", `area "${a.name}" has ${a.groups.length} groups (want ${lo}..${hi})`);
    let worstOpen = 0;
    for (const g of a.groups) {
      const all = [...g.pages, ...g.subs.flatMap((x) => x.pages)];
      total += all.length;
      const subRows = g.subs.reduce((n, x) => n + 1 + (x.open ? x.pages.length : 0), 0);
      const biggestClosedSub = Math.max(0, ...g.subs.filter((x) => !x.open).map((x) => x.pages.length));
      worstOpen = Math.max(worstOpen, g.pages.length + subRows + biggestClosedSub);
      if (!g.az && !g.pages.some((p) => p.type === "step")) checkGroupSize(g.name, g.pages, false);
      for (const x of g.subs) checkGroupSize(x.name, x.pages, true);
      if (g.pages[0]?.type !== "landing") fail("S7", `group "${g.name}" in "${a.name}" has no landing first`);
      for (const x of g.subs) if (x.pages[0]?.type !== "landing") warn("S7", `subgroup "${x.name}" has no landing first`);
      if (g.subs.length && !/reference|recipes|examples/i.test(g.name)) fail("S4", `group "${g.name}" in "${a.name}" has a third level`);
      if (/^(architecture|advanced|misc|other|utilities)$/i.test(g.name)) fail("S13", `group "${g.name}"`);
      if (g.name.split(/\s+/).length > 4) warn("N1", `group label "${g.name}" has more than 4 words`);
      if (all.length < 2) fail("S15", `group "${g.name}" has fewer than 2 pages`);
      const urlSlugs = new Map();
      const groupUrl = kebab(g.name).split("-").filter((w) => !STOP.has(w)).slice(0, 4).join("-");
      for (const x of g.subs) {
        const subUrl = `${groupUrl}/${kebab(x.name).split("-").filter((w) => !STOP.has(w)).slice(0, 4).join("-")}`;
        if (allUrls.has(subUrl)) fail("N5", `subgroup "${x.name}" shares the URL ${subUrl}`);
        allUrls.add(subUrl);
      }
      for (const p of all) {
        titles.set(p.title, (titles.get(p.title) ?? 0) + 1);
        const b = BUDGETS[p.type];
        if (!b) fail("N6", `${p.slug} has unknown type "${p.type}"`);
        else if (p.words > b.hard) fail("P1", `${p.slug} planned ${p.words}w > ${b.hard}`);
        else if (p.words > b.target[1]) warn("P1", `${p.slug} planned ${p.words}w above target ${b.target[1]}`);
        if (p.title.length > 60) fail("N1", `${p.slug} title too long`);
        if (p.title.split(/\s+/).length > 4 && p.type !== "example") warn("N1", `${p.slug} title "${p.title}" has more than 4 words`);
        const urlSlug = kebab(p.title).split("-").filter((w) => !STOP.has(w)).slice(0, 4).join("-");
        if (urlSlugs.has(urlSlug)) fail("N5", `${p.slug} and ${urlSlugs.get(urlSlug)} share the slug "${urlSlug}" in "${g.name}"`);
        urlSlugs.set(urlSlug, p.slug);
      }
    }
    if (entryArea) {
      const pathGroups = a.groups.filter((g) => g.pages.some((p) => p.type === "step"));
      if (!pathGroups.length) fail("S12", `"${a.name}" has no path group of step pages`);
      for (const g of pathGroups) {
        const steps = g.pages.filter((p) => p.type === "step").length;
        if (steps < 3 || steps > 10) fail("S12", `path group "${g.name}" has ${steps} step pages (want 3..10)`);
      }
      if (pathGroups[0] && pathGroups[0].pages.filter((p) => p.type === "step").length < 6) fail("S12", "the first path group has fewer than 6 steps");
    }
    const visible = a.groups.length + worstOpen;
    perArea.push(`${a.name}: ${a.groups.length}g ${a.groups.reduce((n, g) => n + g.pages.length + g.subs.reduce((m, x) => m + x.pages.length, 0), 0)}p rows<=${visible}`);
    if (visible > 25) fail("S5", `area "${a.name}" shows up to ${visible} rows (cap 25)`);
  }
  for (const [t, n] of titles) if (n > 1) fail("N2", `title "${t}" used ${n} times`);
  console.log(`areas ${areas.length}, pages ${total}\n${perArea.join("\n")}`);
  console.log(out.length ? out.join("\n") : "no findings");
  process.exitCode = out.some((l) => l.startsWith("FAIL")) ? 1 : 0;
}

function checkQueries(queriesFile, file) {
  const pages = new Map(parseCandidate(file).flatMap((a) => a.groups.flatMap((g) => [...g.pages, ...g.subs.flatMap((s) => s.pages)])).map((p) => [p.slug, p]));
  const rows = readLf(queriesFile)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("|").map((x) => x.trim()));
  const bad = rows.filter(([, slug]) => !pages.has(slug));
  const vocabulary = rows.filter(([query, slug]) => {
    const page = pages.get(slug);
    if (!page) return false;
    const haystack = `${page.title} ${page.aliases.join(" ")}`.toLowerCase();
    return !query.toLowerCase().split(/\s+/).filter((w) => w.length > 3).some((w) => haystack.includes(w)) && !page.aliases.some((x) => query.toLowerCase().includes(x));
  });
  console.log(`queries ${rows.length}, unknown pages ${bad.length}, queries with no word in the title or aliases ${vocabulary.length}`);
  for (const [query, slug] of bad) console.log(`FAIL A11 "${query}" names unknown page "${slug}"`);
  for (const [query, slug] of vocabulary) console.log(`warn A11 "${query}": no word in the title or aliases of "${slug}"`);
  if (rows.length < 30) console.log("FAIL A11 the list needs at least 30 queries");
  process.exitCode = bad.length || rows.length < 30 ? 1 : 0;
}

const queriesIdx = process.argv.indexOf("--queries");
if (queriesIdx > 0) {
  checkQueries(process.argv[queriesIdx + 1], process.argv[queriesIdx + 2]);
} else if (candidateFile) {
  checkCandidate(candidateFile);
} else if (asCheck) {
  const rows = check();
  const bad = rows.filter((r) => r.fails.length).sort((a, b) => b.fails.length - a.fails.length || b.screens - a.screens);
  console.log(`pages ${rows.length}, failing ${bad.length}, warn-only ${rows.filter((r) => !r.fails.length && r.warns.length).length}`);
  for (const r of bad) console.log(`${r.path} [${r.type}] ${r.words}w ${r.screens}scr h2=${r.h2}: ${r.fails.join("; ")}${r.warns.length ? " (warn: " + r.warns.join("; ") + ")" : ""}`);
  process.exitCode = bad.length ? 1 : 0;
} else if (asSitemap) {
  console.log(sitemap(root, 0, new Map(pages.map((p) => [p.path, p]))).join("\n"));
} else if (asJson) {
  console.log(JSON.stringify(pages, null, 1));
} else {
  console.log("screens words h2 h3 code tbl longestParaRun path");
  for (const p of pages) {
    console.log(`${p.screens}\t${p.words}\t${p.h2}\t${p.h3}\t${p.codeLines}\t${p.tableRows}\t${p.longestRun}\t${p.path}`);
  }
}
