// Fails on a dead internal docs link or anchor in content/docs and in every other file that links the docs.
// Usage: node scripts/verify-docs-links.mjs [--migration research/docs-navigation] [--baseline <git ref>] [--root <dir>]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { anchorsOf, capped, pageIndex, readLf, rel, splitFrontmatter, urlOfPage, walk, lineOf } from "./docs-verify-lib.mjs";

const OTHER_FILES = ["README.md", "GLOSSARY.md", "DEVELOPMENT.md", "CHANGELOG.md", "AGENTS.md", "registry.json", "research/parity-matrix.json", "scripts/verify-parity.mjs"];
const OTHER_DIRS = [
  ["skills", [".md"]],
  ["public/skills", [".md"]],
  ["app", [".ts", ".tsx", ".mdx"]],
  ["components", [".ts", ".tsx"]],
  ["lib", [".ts", ".tsx"]],
  ["registry/default", [".ts", ".tsx"]],
];
const ANY_REDIRECT_OK = new Set(["CHANGELOG.md"]);

/** Exact `source:` strings of next.config.mjs redirects (patterns with `:` params are skipped). */
export function redirectSources(root, extraFile) {
  const files = [join(root, "next.config.mjs"), ...(extraFile ? [extraFile] : [])];
  const sources = new Set();
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const match of readFileSync(file, "utf8").matchAll(/source:\s*["']([^"']+)["']/g)) if (!match[1].includes(":")) sources.add(match[1]);
  }
  const moved = join(root, "content/docs-redirects.json");
  if (existsSync(moved)) for (const entry of JSON.parse(readFileSync(moved, "utf8"))) sources.add(entry.source);
  return sources;
}

const normalizePath = (path) => path.replace(/\.mdx?$/, "").replace(/\/$/, "") || "/docs";

function targetsOf(file, text) {
  const out = [];
  const seen = new Set();
  const add = (target, index) => {
    const key = `${lineOf(text, index)}:${target}`;
    if (!seen.has(key)) out.push({ target, line: lineOf(text, index) });
    seen.add(key);
  };
  if (/\.(mdx?|ts|tsx)$/.test(file) || file.endsWith("registry.json")) {
    for (const m of text.matchAll(/\]\(([^)\s]+)/g)) add(m[1], m.index);
    for (const m of text.matchAll(/\bhref=["']([^"']+)["']/g)) add(m[1], m.index);
  }
  for (const m of text.matchAll(/https:\/\/gridcn\.vercel\.app\/docs[\w./#-]*/g)) {
    if (text[m.index + m[0].length] === "<") continue;
    add(m[0].replace(/[.,;:]+$/, ""), m.index);
  }
  if (!/\.mdx?$/.test(file)) for (const m of text.matchAll(/["'`(\s]((?:https?:\/\/[^/\s"'`]+)?\/docs(?:[/#][\w./#-]*)?)/g)) add(m[1], m.index);
  return out;
}

export function run({ root = process.cwd(), migration, redirectsFile, siteHosts = ["gridcn.vercel.app"], baseline } = {}) {
  const contentDir = join(root, "content/docs");
  const pages = pageIndex(contentDir);
  const redirects = redirectSources(root, redirectsFile);
  const failures = [];
  const warnings = [];
  let checked = 0;

  const resolve = (rawTarget, here) => {
    let target = rawTarget;
    const host = /^https?:\/\/([^/]+)(\/.*)?$/.exec(target);
    if (host) {
      if (!siteHosts.includes(host[1])) return "ok";
      target = host[2] ?? "/";
    }
    if (/^(mailto:|tel:|data:)/.test(target) || /^https?:/.test(target)) return "ok";
    const [path, anchor] = target.split("#");
    if (path === "" && anchor !== undefined) {
      return here && !anchorsOf(here.body).has(anchor) && !here.anchors.has(anchor) ? `anchor #${anchor} missing on this page` : "ok";
    }
    if (!(path === "/docs" || path.startsWith("/docs/") || path.startsWith("/docs?"))) return "ok";
    const clean = normalizePath(path.split("?")[0]);
    const page = pages.get(clean);
    if (!page) return redirects.has(clean) || redirects.has(`${clean}.md`) ? "redirect" : `no page ${clean}`;
    return anchor && !page.anchors.has(anchor) ? `no anchor #${anchor} on ${clean}` : "ok";
  };

  const scan = (file, text, here, allowRedirect) => {
    for (const { target, line } of targetsOf(file, text)) {
      checked++;
      const verdict = resolve(target, here);
      if (verdict === "ok") continue;
      if (verdict === "redirect") {
        if (!allowRedirect) failures.push(`${rel(root, file)}:${line}: ${target} only works through a redirect; link the new page`);
        continue;
      }
      failures.push(`${rel(root, file)}:${line}: ${target} -> ${verdict}`);
    }
    for (const m of text.matchAll(/content\/docs\/[\w./()-]+\.mdx/g)) {
      checked++;
      if (!existsSync(join(root, m[0]))) failures.push(`${rel(root, file)}:${lineOf(text, m.index)}: file ${m[0]} does not exist`);
    }
  };

  for (const [, page] of pages) scan(page.file, readLf(page.file), page, false);
  const others = [...OTHER_FILES.map((f) => join(root, f)).filter(existsSync), ...OTHER_DIRS.flatMap(([dir, exts]) => walk(join(root, dir), exts))];
  for (const file of others) scan(file, readLf(file), undefined, ANY_REDIRECT_OK.has(rel(root, file)));

  const llmsTasks = join(root, "lib/llms-tasks.ts");
  if (existsSync(llmsTasks)) {
    return import(pathToFileURL(llmsTasks).href)
      .then(({ LLMS_TASKS }) => {
        for (const task of LLMS_TASKS) {
          checked++;
          const url = `/docs/${task.slug.join("/")}`;
          const page = pages.get(url);
          if (!page) failures.push(`lib/llms-tasks.ts: ${task.intent}: no page ${url}`);
          else if (task.anchor && !page.anchors.has(task.anchor)) failures.push(`lib/llms-tasks.ts: ${task.intent}: no anchor #${task.anchor} on ${url}`);
        }
      })
      .catch((error) => warnings.push(`lib/llms-tasks.ts not checked: ${error.message}`))
      .then(() => finish());
  }
  return finish();

  function finish() {
    if (migration) checkMigration(join(root, migration), pages, redirects, failures);
    if (baseline) checkBaseline(root, baseline, pages, redirects, migration, failures);
    checkRedirectDestinations(root, redirectsFile, pages, failures);
    return { name: "links", checked, failures, warnings };
  }
}

/** Destination of every redirect in next.config.mjs resolves to a page and heading. */
function checkRedirectDestinations(root, extraFile, pages, failures) {
  const moved = join(root, "content/docs-redirects.json");
  if (existsSync(moved)) {
    for (const entry of JSON.parse(readFileSync(moved, "utf8"))) {
      const [path, anchor] = entry.destination.replace(/\.md$/, "").split("#");
      const page = pages.get(normalizePath(path));
      if (!page || (anchor && !page.anchors.has(anchor))) failures.push(`content/docs-redirects.json: redirect destination ${entry.destination} does not resolve`);
    }
  }
  for (const file of [join(root, "next.config.mjs"), ...(extraFile ? [extraFile] : [])]) {
    if (!existsSync(file)) continue;
    for (const m of readFileSync(file, "utf8").matchAll(/destination:\s*["']([^"']+)["']/g)) {
      const [path, anchor] = m[1].split("#");
      if (!path.startsWith("/docs") || path.includes(":")) continue;
      const page = pages.get(normalizePath(path));
      if (!page || (anchor && !page.anchors.has(anchor))) failures.push(`next.config.mjs: redirect destination ${m[1]} does not resolve`);
    }
  }
}

/** Every URL and anchor of the pages at `ref` still resolves: a page, a redirect, or an entry of the anchor map. */
function checkBaseline(root, ref, pages, redirects, migration, failures) {
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
  let files;
  try {
    files = git(["ls-tree", "-r", "--name-only", ref, "content/docs"]).split("\n").filter((f) => f.endsWith(".mdx"));
  } catch {
    failures.push(`baseline: cannot read ${ref}`);
    return;
  }
  const anchorMapFile = migration ? join(root, migration, "anchor-map.json") : null;
  const anchorMap = anchorMapFile && existsSync(anchorMapFile) ? JSON.parse(readFileSync(anchorMapFile, "utf8")) : {};
  for (const file of files) {
    const url = urlOfPage(join(root, "content/docs"), join(root, file));
    const { body } = splitFrontmatter(git(["show", `${ref}:${file}`]).replaceAll("\r\n", "\n"));
    const current = pages.get(url);
    if (!current && !redirects.has(url)) {
      failures.push(`baseline: ${url} is neither a page nor a redirect`);
      continue;
    }
    for (const id of anchorsOf(body)) {
      if (current?.anchors.has(id) || anchorMap[url]?.[id]) continue;
      failures.push(`baseline: ${url}#${id} is gone; keep the id with [#${id}] or add it to the anchor map`);
    }
  }
}

/** Every old URL has a page or a redirect, and every mapped target and anchor resolves. */
function checkMigration(dir, pages, redirects, failures) {
  const urlMapFile = join(dir, "url-map.json");
  if (!existsSync(urlMapFile)) return failures.push(`migration: ${urlMapFile} missing`);
  for (const entry of JSON.parse(readFileSync(urlMapFile, "utf8"))) {
    if (!pages.has(entry.target)) failures.push(`migration: target ${entry.target} (from ${entry.old}) has no page`);
    if (entry.old !== entry.target && !redirects.has(entry.old)) failures.push(`migration: ${entry.old} has no redirect`);
  }
  const anchorMapFile = join(dir, "anchor-map.json");
  if (!existsSync(anchorMapFile)) return;
  for (const [oldUrl, anchors] of Object.entries(JSON.parse(readFileSync(anchorMapFile, "utf8")))) {
    for (const [id, target] of Object.entries(anchors)) {
      const [path, anchor] = target.split("#");
      const page = pages.get(path);
      if (!page || (anchor && !page.anchors.has(anchor))) failures.push(`migration: ${oldUrl}#${id} -> ${target} does not resolve`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
  const result = await run({ root: process.argv.includes("--root") ? arg("--root") : process.cwd(), migration: process.argv.includes("--migration") ? arg("--migration") : undefined, baseline: process.argv.includes("--baseline") ? arg("--baseline") : undefined });
  for (const w of capped(result.warnings)) console.warn(`warn  ${w}`);
  if (result.failures.length) {
    console.error(`docs links: ${result.failures.length} dead of ${result.checked} checked\n${capped(result.failures).map((f) => `  ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`docs links: ${result.checked} checked, none dead`);
}
