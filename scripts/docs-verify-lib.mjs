// Shared helpers for the docs validators (verify-docs-*.mjs and docs-verify.mjs).
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const FAILURE_CAP = 8;

export const readLf = (file) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

export function walk(dir, exts, skip = ["node_modules", ".next", ".git", ".source"]) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path, exts, skip));
    else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(path);
  }
  return out;
}

export const rel = (root, file) => relative(root, file).split(sep).join("/");

export function splitFrontmatter(src) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  return match ? { front: match[1], body: src.slice(match[0].length), bodyOffset: match[0].split("\n").length - 1 } : { front: "", body: src, bodyOffset: 0 };
}

export function frontField(front, name) {
  const match = new RegExp(`^${name}:\\s*(.*)$`, "m").exec(front);
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : undefined;
}

/** Fenced blocks of a body: `{ lang, meta, code, line }`, where `line` is the first code line (1-based, body-relative). */
export function codeBlocks(body) {
  const blocks = [];
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)(`{3,})([\w-]*)(.*)$/.exec(lines[i]);
    if (!open) continue;
    const fence = open[2];
    const start = i + 1;
    let end = start;
    while (end < lines.length && !new RegExp(`^\\s*${fence}\\s*$`).test(lines[end])) end++;
    blocks.push({ lang: open[3], meta: open[4].trim(), code: lines.slice(start, end).join("\n"), line: start + 1, endLine: end + 1 });
    i = end;
  }
  return blocks;
}

/** Body with fenced code replaced by blank lines (line numbers stay) and inline code by `x`. */
export function proseOnly(body) {
  const lines = body.split("\n");
  let fence = null;
  return lines
    .map((line) => {
      const open = /^\s*(`{3,})/.exec(line);
      if (fence) {
        if (open && open[1].length >= fence.length && /^\s*`+\s*$/.test(line)) fence = null;
        return "";
      }
      if (open) {
        fence = open[1];
        return "";
      }
      return line.replace(/`[^`]*`/g, "x");
    })
    .join("\n");
}

export const urlOfPage = (contentDir, file) => {
  const segments = rel(contentDir, file)
    .replace(/\.mdx?$/, "")
    .split("/")
    .filter((s) => !/^\(.*\)$/.test(s));
  if (segments.at(-1) === "index") segments.pop();
  return `/docs${segments.length ? `/${segments.join("/")}` : ""}`;
};

const slugText = (text) =>
  text
    .replace(/\[#[^\]]+\]\s*$/, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");

const ROW_NAME = /^\|\s*`([A-Za-z_$][\w$]*)`\s*\|/;

/** Anchor ids of a page body: row ids of tables, heading slugs (with the -1 suffix for repeats), explicit `[#id]`, and `id="..."` attributes. */
export function anchorsOf(body) {
  const anchors = new Set();
  const seen = new Map();
  const lines = body.split("\n");
  let fence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) fence = !fence;
    if (fence) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      const explicit = /\[#([^\]]+)\]\s*$/.exec(heading[1]);
      if (explicit) anchors.add(explicit[1]);
      else {
        const base = slugText(heading[1]);
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        anchors.add(count ? `${base}-${count}` : base);
      }
    }
    for (const id of line.matchAll(/\bid=["']([^"']+)["']/g)) anchors.add(id[1]);
    const row = ROW_NAME.exec(line);
    if (row) anchors.add(rowIdOf(row[1]));
  }
  return anchors;
}

/** Map url -> { file, anchors, front, body } for every page under `contentDir`. */
export function pageIndex(contentDir) {
  const pages = new Map();
  for (const file of walk(contentDir, [".mdx"])) {
    const { front, body } = splitFrontmatter(readLf(file));
    pages.set(urlOfPage(contentDir, file), { file, front, body, anchors: anchorsOf(body) });
  }
  return pages;
}

/** Cap a failure list for printing. */
export function capped(list, cap = FAILURE_CAP) {
  return list.length <= cap ? list : [...list.slice(0, cap), `... and ${list.length - cap} more`];
}

export const lineOf = (text, index) => text.slice(0, index).split("\n").length;

export function isDir(path) {
  return existsSync(path) && statSync(path).isDirectory();
}

/** Repo-relative forward-slash path of a --files entry; an entry that is not a docs page throws. */
export function normalizeFile(file, base) {
  const path = (isAbsolute(file) ? relative(base, file) : file).split(sep).join("/").replaceAll("\\", "/").replace(/^\.\//, "");
  if (!path.startsWith("content/docs/") || !path.endsWith(".mdx")) throw new Error(`--files entry is not a docs page: ${file}`);
  return path;
}

const TYPELESS_WARNING = "MODULE_TYPELESS_PACKAGE_JSON";

/** Imports a .ts file of the repo under Node type stripping; the repo's package.json has no "type", and Node warns about that for each such file. */
export async function importTs(path) {
  const emit = process.emitWarning;
  process.emitWarning = (warning, ...rest) => (`${warning} ${JSON.stringify(rest)}`.includes(TYPELESS_WARNING) ? undefined : emit.call(process, warning, ...rest));
  try {
    return await import(pathToFileURL(resolve(path)).href);
  } finally {
    process.emitWarning = emit;
  }
}

export const { rowIdOf } = await importTs(join(import.meta.dirname, "..", "lib", "rehype-row-ids.ts"));
