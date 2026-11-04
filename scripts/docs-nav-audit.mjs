#!/usr/bin/env node
// Audits content/docs against research/docs-navigation-ruleset.md. Usage: node scripts/docs-nav-audit.mjs [--json | --sitemap | --check] [dir]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.argv.find((a, i) => i > 1 && !a.startsWith("--")) ?? "content/docs";
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
};

function pageType(path) {
  if (path.endsWith("index.mdx")) return "landing";
  if (/^(reference|learn|cheatsheets)\//.test(path)) return { reference: "reference", learn: "step", cheatsheets: "cheatsheet" }[path.split("/")[0]];
  if (/^(recipes|examples)\//.test(path)) return "task";
  return LEGACY_REFERENCE.has(path) ? "reference" : "feature";
}

function check() {
  const titles = new Map();
  const rows = pages.map((p) => {
    const type = pageType(p.path);
    const b = BUDGETS[type];
    const src = readFileSync(join(root, p.path), "utf8");
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

if (asCheck) {
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
