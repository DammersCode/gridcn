#!/usr/bin/env node
// Audits content/docs against research/docs-navigation-ruleset.md. Usage: node scripts/docs-nav-audit.mjs [--json | --sitemap | --check | --candidate <file>] [dir]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const candidateIdx = process.argv.indexOf("--candidate");
const candidateFile = candidateIdx > 0 ? process.argv[candidateIdx + 1] : null;
const root = process.argv.find((a, i) => i > 1 && !a.startsWith("--") && a !== candidateFile) ?? "content/docs";
const asJson = process.argv.includes("--json");
const asSitemap = process.argv.includes("--sitemap");
const asCheck = process.argv.includes("--check");

const SCREEN_WORDS = 250;
const SCREEN_CODE_LINES = 35;
const SCREEN_PREVIEW = 0.6;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function measure(src) {
  const body = src.replace(/^---[\s\S]*?---\n/, "");
  let codeLines = 0;
  let previews = 0;
  let inFence = false;
  const prose = [];
  let longestRun = 0;
  let run = 0;
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      codeLines++;
      continue;
    }
    if (/<ComponentPreview/.test(line)) previews++;
    if (/^#{1,6}\s/.test(line) || line.trim() === "") {
      longestRun = Math.max(longestRun, run);
      run = 0;
    } else if (!/^\s*[<|]/.test(line)) {
      run += line.split(/\s+/).filter(Boolean).length;
    }
    prose.push(line);
  }
  longestRun = Math.max(longestRun, run);
  const text = prose.join("\n").replace(/<[^>]+>/g, " ").replace(/[`*_|#>\-[\]()]/g, " ");
  const words = text.split(/\s+/).filter(Boolean).length;
  const h2 = (body.match(/^## /gm) ?? []).length;
  const h3 = (body.match(/^### /gm) ?? []).length;
  const tableRows = (body.match(/^\|.*\|\s*$/gm) ?? []).length;
  const screens = words / SCREEN_WORDS + codeLines / SCREEN_CODE_LINES + previews * SCREEN_PREVIEW;
  return { words, h2, h3, codeLines, previews, tableRows, longestRun, screens: +screens.toFixed(1) };
}

const pages = walk(root)
  .filter((f) => f.endsWith(".mdx"))
  .map((f) => ({ path: relative(root, f).replaceAll("\\", "/"), ...measure(readFileSync(f, "utf8")) }))
  .sort((a, b) => b.screens - a.screens);

function frontTitle(src) {
  return /^title:\s*(.+)$/m.exec(src)?.[1].replace(/^["']|["']$/g, "") ?? "?";
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
      const h2s = [...readFileSync(file, "utf8").matchAll(/^## (.+)$/gm)].map((x) => x[1].replace(/<[^>]+>/g, "").trim());
      lines.push(`${pad}- ${frontTitle(readFileSync(file, "utf8"))}  [${rel}] ${m.words}w ${m.screens}scr h2=${m.h2}${h2s.length ? ": " + h2s.join(" | ") : ""}`);
    } else if (existsSync(folder) && statSync(folder).isDirectory()) {
      const fm = JSON.parse(readFileSync(join(folder, "meta.json"), "utf8"));
      lines.push(`${pad}- [folder] ${fm.title} (${rel}/)`);
      lines.push(...sitemap(folder, depth + 1, byPath));
    }
  }
  return lines;
}

const LEGACY_REFERENCE = new Set(["api-reference.mdx", "events-state.mdx", "project-status.mdx", "terms.mdx", "license.mdx"]);
const BUDGETS = {
  landing: { target: [80, 350], hard: 400, screens: 3, h2: [0, 6] },
  feature: { target: [400, 1200], hard: 1500, screens: 8, h2: [2, 6] },
  task: { target: [200, 800], hard: 1000, screens: 6, h2: [2, 5] },
  step: { target: [200, 600], hard: 800, screens: 5, h2: [2, 4] },
  reference: { target: [300, 1500], hard: 2000, screens: 14, h2: [3, 10] },
  cheatsheet: { target: [0, 1200], hard: 1200, screens: 12, h2: [2, 10] },
  example: { target: [100, 500], hard: 800, screens: 6, h2: [0, 5] },
};

function pageType(path, src = "") {
  const declared = /^type:\s*(\w+)/m.exec(src)?.[1];
  if (declared && BUDGETS[declared]) return declared;
  if (path.endsWith("index.mdx")) return "landing";
  if (/^(reference|learn|cheatsheets)\//.test(path)) return { reference: "reference", learn: "step", cheatsheets: "cheatsheet" }[path.split("/")[0]];
  if (/^(recipes|examples)\//.test(path)) return "task";
  return LEGACY_REFERENCE.has(path) ? "reference" : "feature";
}

function check() {
  const titles = new Map();
  const rows = pages.map((p) => {
    const src = readFileSync(join(root, p.path), "utf8");
    const type = pageType(p.path, src);
    const b = BUDGETS[type];
    const title = frontTitle(src);
    titles.set(title, [...(titles.get(title) ?? []), p.path]);
    const fails = [];
    const warns = [];
    if (p.words > b.hard) fails.push(`P1 words ${p.words}>${b.hard}`);
    else if (p.words > b.target[1]) warns.push(`P1 words ${p.words}>${b.target[1]}`);
    if (p.screens > b.screens) fails.push(`P1 screens ${p.screens}>${b.screens}`);
    if (p.h2 > b.h2[1]) fails.push(`P2 h2 ${p.h2}>${b.h2[1]}`);
    if (p.h2 < b.h2[0]) warns.push(`P2 h2 ${p.h2}<${b.h2[0]}`);
    if (p.longestRun > 110) warns.push(`P4 paragraph ${p.longestRun}w`);
    if (p.words < 80 && type !== "landing") fails.push(`P11 words ${p.words}<80`);
    if (!/^description:/m.test(src)) warns.push("P8 no description");
    if (title.length > 60) fails.push(`N1 title ${title.length} chars`);
    return { path: p.path, type, title, words: p.words, screens: p.screens, h2: p.h2, fails, warns };
  });
  for (const [title, paths] of titles) {
    if (paths.length > 1) for (const r of rows.filter((x) => paths.includes(x.path))) r.fails.push(`N2 duplicate title "${title}"`);
  }
  return rows;
}

function readCandidate(file) {
  const dir = dirname(file);
  return readFileSync(file, "utf8").split(/\r?\n/).flatMap((l) => (l.startsWith("<< ") ? readCandidate(join(dir, l.slice(3).trim())) : [l]));
}

function checkCandidate(file) {
  const out = [];
  const areas = [];
  const titles = new Map();
  let area = null;
  let group = null;
  let sub = null;
  for (const raw of readCandidate(file)) {
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
      const [slug, title, type, words] = line.slice(2).split("|").map((x) => x.trim());
      const page = { slug, title, type, words: Number(words) || 0 };
      (sub ?? group).pages.push(page);
      titles.set(title, (titles.get(title) ?? 0) + 1);
    }
  }
  const fail = (rule, msg) => out.push(`FAIL ${rule} ${msg}`);
  const warn = (rule, msg) => out.push(`warn ${rule} ${msg}`);
  if (areas.length < 4 || areas.length > 6) fail("S1", `areas ${areas.length} (want 4..6)`);
  let total = 0;
  const perArea = [];
  for (const a of areas) {
    if (!/learn|start/i.test(a.name) && (a.groups.length < 4 || a.groups.length > 10)) fail("S2", `area "${a.name}" has ${a.groups.length} groups (want 4..10)`);
    let base = 0;
    let openMax = 0;
    let maxSub = 0;
    for (const g of a.groups) {
      const all = [...g.pages, ...g.subs.flatMap((x) => x.pages)];
      total += all.length;
      base += 1;
      openMax = Math.max(openMax, g.pages.length + g.subs.length);
      for (const x of g.subs) maxSub = Math.max(maxSub, x.open ? 0 : x.pages.length);
      if (!g.az) {
        if (g.pages.length > 12) fail("S3", `group "${g.name}" has ${g.pages.length} pages (cap 12)`);
        else if (g.pages.length > 7) warn("S3", `group "${g.name}" has ${g.pages.length} pages (target 7)`);
      }
      if (g.pages[0]?.slug !== "index" && g.pages[0]?.type !== "landing") fail("S7", `group "${g.name}" in "${a.name}" has no landing first`);
      if (g.subs.length && !/reference|recipes|examples/i.test(a.name) && !/examples/i.test(g.name)) fail("S4", `group "${g.name}" in "${a.name}" has a third level`);
      for (const p of all) {
        const b = BUDGETS[p.type];
        if (!b) fail("TYPE", `${p.slug} has unknown type "${p.type}"`);
        else if (p.words > b.hard) fail("P1", `${p.slug} planned ${p.words}w > ${b.hard}`);
        if (p.title.length > 60) fail("N1", `${p.slug} title too long`);
        if (p.title.split(/\s+/).length > 5 && p.type !== "example") warn("N1", `${p.slug} title "${p.title}" is long`);
        if (/^(architecture|advanced|misc|other|utilities)$/i.test(g.name)) fail("S13", `group "${g.name}"`);
      }
      if (all.length <= 1 && g.pages[0]?.type !== "landing") fail("S9", `group "${g.name}" has one page`);
    }
    const visible = base + openMax + maxSub;
    perArea.push(`${a.name}: ${a.groups.length}g ${a.groups.reduce((n, g) => n + g.pages.length + g.subs.reduce((m, x) => m + x.pages.length, 0), 0)}p rows<=${visible}`);
    if (visible > 25) fail("S5", `area "${a.name}" shows up to ${visible} rows (cap 25)`);
  }
  for (const [t, n] of titles) if (n > 1) fail("N2", `title "${t}" used ${n} times`);
  console.log(`areas ${areas.length}, pages ${total}\n${perArea.join("\n")}`);
  console.log(out.length ? out.join("\n") : "no findings");
  process.exitCode = out.some((l) => l.startsWith("FAIL")) ? 1 : 0;
}

if (candidateFile) {
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
