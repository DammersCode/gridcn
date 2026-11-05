// Builds the docs skeleton of the approved navigation: moves pages, writes stubs, meta.json files, and the redirect list,
// then rewrites internal links. Run once at the freeze commit.
// Usage: node scripts/docs-skeleton.mjs --candidate <c19.txt> --content-map <content-map.md> --url-map <url-map.json> --anchor-map <anchor-map.json> [--apply]
// Without --apply it prints the plan and changes nothing.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildWorklist, slugOf } from "./docs-rewrite-worklist.mjs";
import { readLf, splitFrontmatter, walk } from "./docs-verify-lib.mjs";

const AREA_ICONS = { Learn: "Sparkles", Build: "Hammer", Server: "Server", Evaluate: "Gauge", Reference: "BookOpen", Examples: "Blocks" };

const git = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });

/** File of a page: the home page stays at content/docs/index.mdx; a group landing is its folder's index. */
export function fileOf(row) {
  if (row.url === "/docs") return "content/docs/index.mdx";
  const path = row.url.replace(/^\/docs\//, "");
  return `content/docs/(${slugOf(row.area)})/${path}${row.landing ? "/index" : ""}.mdx`;
}

function frontmatter(fields) {
  const lines = Object.entries(fields).flatMap(([key, value]) => {
    if (value === undefined || (Array.isArray(value) && value.length === 0)) return [];
    if (Array.isArray(value)) return [`${key}: [${value.map((v) => JSON.stringify(v)).join(", ")}]`];
    return [`${key}: ${typeof value === "string" && /[:#]/.test(value) ? JSON.stringify(value) : value}`];
  });
  return `---\n${lines.join("\n")}\n---\n`;
}

/** Plan: for each row either a move of an old file or a stub; old files that are not moved are removed. */
export function planSkeleton({ candidate, contentMap, urlMap, root }) {
  const list = buildWorklist({ candidate, contentMap, urlMap, root });
  const entries = JSON.parse(readLf(urlMap));
  const bySlug = new Map(entries.filter((e) => !e.split && e.slugs.length === 1).map((e) => [e.slugs[0], e]));
  const files = new Map();
  const moves = [];
  const stubs = [];
  for (const row of list.rows) {
    const file = fileOf(row);
    if (files.has(file)) throw new Error(`two pages share ${file}: ${files.get(file)} and ${row.slug}`);
    files.set(file, row.slug);
    const entry = bySlug.get(row.slug);
    if (entry) moves.push({ row, from: `content/docs/${entry.file}`, to: file });
    else stubs.push({ row, to: file });
  }
  const movedFrom = new Set(moves.map((m) => m.from));
  const removals = walk(join(root, "content/docs"), [".mdx"]).map((f) => f.replaceAll("\\", "/").replace(`${root.replaceAll("\\", "/")}/`, "")).filter((f) => !movedFrom.has(f) && !files.has(f));
  return { list, moves, stubs, removals, files };
}

/** meta.json files: the top level, one per area (a sidebar tab), one per group and subgroup folder. */
export function metaFiles(list) {
  const metas = new Map();
  const areas = [...new Set(list.rows.map((r) => r.area))];
  metas.set("content/docs/meta.json", { title: "gridcn", pages: areas.map((a) => `(${slugOf(a)})`) });
  const leaf = (r) => (r.landing ? "index" : r.url.split("/").pop());
  for (const area of areas) {
    const rows = list.rows.filter((r) => r.area === area);
    const groups = [...new Set(rows.map((r) => r.group))];
    const home = rows.some((r) => r.url === "/docs");
    metas.set(`content/docs/(${slugOf(area)})/meta.json`, { title: area, icon: AREA_ICONS[area], root: true, pages: [...(home ? ["../index"] : []), ...groups.map(slugOf)] });
    for (const group of groups) {
      const groupRows = rows.filter((r) => r.group === group);
      const folder = `content/docs/(${slugOf(area)})/${slugOf(group)}`;
      const pages = [];
      for (const r of groupRows) {
        if (r.subgroup) {
          if (!pages.includes(slugOf(r.subgroup))) pages.push(slugOf(r.subgroup));
        } else if (r.url !== "/docs") pages.push(leaf(r));
      }
      metas.set(`${folder}/meta.json`, { title: group, pages });
      for (const sub of new Set(groupRows.filter((r) => r.subgroup).map((r) => r.subgroup))) {
        metas.set(`${folder}/${slugOf(sub)}/meta.json`, { title: sub, pages: groupRows.filter((r) => r.subgroup === sub).map(leaf) });
      }
    }
  }
  return metas;
}

export function redirectList(entries, extra = []) {
  const out = [];
  for (const e of entries) {
    if (e.old === e.target) continue;
    out.push({ source: e.old, destination: e.target }, { source: `${e.old}.md`, destination: `${e.target}.md` });
  }
  for (const r of extra) out.push(r);
  return out;
}

/** New URL for an old link: anchors of split pages follow the anchor map, anchors of moved pages stay. */
export function rewriteTarget(target, entriesByOld, anchorMap) {
  const [path, anchor] = target.split("#");
  const entry = entriesByOld.get(path.replace(/\.md$/, ""));
  if (!entry) return target;
  const suffix = path.endsWith(".md") ? ".md" : "";
  if (anchor) {
    const mapped = anchorMap[entry.old]?.[anchor];
    if (mapped) return `${mapped.split("#")[0]}${suffix}${mapped.includes("#") ? `#${mapped.split("#")[1]}` : ""}`;
    return entry.split ? `${entry.target}${suffix}` : `${entry.target}${suffix}#${anchor}`;
  }
  return `${entry.target}${suffix}`;
}

const LINK = /(\]\(|href=["']|["'`(\s]|^)((?:https:\/\/gridcn\.vercel\.app)?\/docs(?:\/[\w./-]*)?)(#[\w-]+)?/gm;

export function rewriteLinks(text, entriesByOld, anchorMap) {
  return text.replace(LINK, (match, lead, path, hash = "") => {
    const host = path.startsWith("https://") ? "https://gridcn.vercel.app" : "";
    const full = path.slice(host.length);
    const trail = /[.,;:]+$/.exec(full)?.[0] ?? "";
    const bare = full.slice(0, full.length - trail.length);
    const next = rewriteTarget(`${bare}${hash}`, entriesByOld, anchorMap);
    return next === `${bare}${hash}` ? match : `${lead}${host}${next}${trail}`;
  });
}

function main() {
  const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
  const root = process.cwd();
  const apply = process.argv.includes("--apply");
  const linksOnly = process.argv.includes("--links-only");
  const urlMapFile = arg("--url-map");
  const plan = linksOnly ? null : planSkeleton({ candidate: arg("--candidate"), contentMap: arg("--content-map"), urlMap: urlMapFile, root });
  const entries = JSON.parse(readLf(urlMapFile));
  const anchorMap = JSON.parse(readLf(arg("--anchor-map")));
  if (plan) {
    const metas = metaFiles(plan.list);
    console.log(`skeleton: ${plan.moves.length} moves, ${plan.stubs.length} stubs, ${plan.removals.length} removals, ${metas.size} meta files, ${redirectList(entries).length} redirects`);
  }
  if (!apply) return;
  if (plan) writeSkeleton(root, plan, entries);
  rewriteAll(root, entries, anchorMap);
}

function writeSkeleton(root, plan, entries) {
  const metas = metaFiles(plan.list);

  for (const m of plan.moves) {
    mkdirSync(join(root, dirname(m.to)), { recursive: true });
    if (m.from !== m.to) git(root, ["mv", m.from, m.to]);
    const { front, body } = splitFrontmatter(readLf(join(root, m.to)));
    const fields = Object.fromEntries([...front.matchAll(/^(\w+):\s*(.*)$/gm)].map((x) => [x[1], x[2]]));
    const next = { ...fields, title: JSON.stringify(m.row.title), type: m.row.type };
    if (m.row.aliases.length) next["aliases"] = `[${m.row.aliases.map((a) => JSON.stringify(a)).join(", ")}]`;
    writeFileSync(join(root, m.to), `---\n${Object.entries(next).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n${body}`);
  }
  for (const f of plan.removals) git(root, ["rm", "-q", "-f", f]);
  for (const s of plan.stubs) {
    mkdirSync(join(root, dirname(s.to)), { recursive: true });
    writeFileSync(join(root, s.to), `${frontmatter({ title: s.row.title, description: `${s.row.title}.`, type: s.row.type, aliases: s.row.aliases })}\n{/* docs-stub */}\n\nThis page is being written.\n`);
  }
  for (const dir of ["addons", "recipes", "examples", "hooks"]) rmSync(join(root, "content/docs", dir, "meta.json"), { force: true });
  for (const [file, meta] of metas) {
    mkdirSync(join(root, dirname(file)), { recursive: true });
    writeFileSync(join(root, file), `${JSON.stringify(meta, null, 2)}\n`);
  }
  writeFileSync(join(root, "content/docs-redirects.json"), `${JSON.stringify(redirectList(entries), null, 2)}\n`);
}

function rewriteAll(root, entries, anchorMap) {
  const byOld = new Map(entries.map((e) => [e.old, e]));
  const scan = [
    ...walk(join(root, "content/docs"), [".mdx"]),
    ...["skills", "public/skills", "app", "components", "lib", "registry/default"].flatMap((d) => walk(join(root, d), [".md", ".ts", ".tsx", ".mdx"])),
    ...["README.md", "GLOSSARY.md", "DEVELOPMENT.md", "AGENTS.md", "registry.json"].map((f) => join(root, f)).filter(existsSync),
  ];
  let changed = 0;
  for (const file of scan) {
    if (file.includes("docs-redirects")) continue;
    const text = readFileSync(file, "utf8");
    const next = rewriteLinks(text, byOld, anchorMap);
    if (next !== text) {
      writeFileSync(file, next);
      changed++;
    }
  }
  console.log(`links rewritten in ${changed} files`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
