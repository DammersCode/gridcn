import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type * as PageTree from "fumadocs-core/page-tree";

export const CANDIDATES: Record<string, { file: string; label: string; summary: string }> = {
  a: { file: "c19-topics-v4.txt", label: "A: Topics", summary: "Build is organised by topic; add-ons live inside their topic." },
  b: { file: "c17-tasks-v3.txt", label: "B: Tasks", summary: "How-to is organised by what the reader wants to do." },
  c: { file: "c10-four-areas.txt", label: "C: Four areas", summary: "Topics, with the Evaluate pages folded into Learn." },
};

export type Page = { slug: string; title: string; type: string; words: number; url: string; area: string; group: string };
type Sub = { name: string; pages: Page[] };
type Group = { name: string; pages: Page[]; subs: Sub[] };
type Area = { name: string; groups: Group[] };

const kebab = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function lines(file: string): string[] {
  const dir = dirname(file);
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .flatMap((l) => (l.startsWith("<< ") ? lines(join(dir, l.slice(3).trim())) : [l]));
}

export function loadCandidate(id: string) {
  const entry = CANDIDATES[id];
  if (!entry) return null;
  const areas: Area[] = [];
  let area!: Area;
  let group!: Group;
  let sub: Sub | null = null;
  for (const raw of lines(join(process.cwd(), "research/docs-navigation/candidates", entry.file))) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    if (line.startsWith("@ ")) {
      area = { name: line.slice(2).trim(), groups: [] };
      areas.push(area);
      sub = null;
    } else if (line.startsWith("### ")) {
      sub = { name: line.slice(4).trim(), pages: [] };
      group.subs.push(sub);
    } else if (line.startsWith("## ")) {
      group = { name: line.slice(3).replace(/\{.*\}/, "").trim(), pages: [], subs: [] };
      area.groups.push(group);
      sub = null;
    } else if (line.startsWith("- ")) {
      const [slug, title, type, words] = line.slice(2).split("|").map((x) => x.trim());
      const url = `/dev/docs-nav/${id}/${kebab(area.name)}/${kebab(group.name)}/${kebab(title)}`;
      (sub ?? group).pages.push({ slug, title, type, words: Number(words) || 0, url, area: area.name, group: group.name });
    }
  }
  return { id, ...entry, areas };
}

export type Candidate = NonNullable<ReturnType<typeof loadCandidate>>;

const item = (p: Page): PageTree.Item => ({ type: "page", name: p.title, url: p.url });

export function buildTree(c: Candidate): PageTree.Root {
  return {
    name: c.label,
    children: c.areas.map((a): PageTree.Folder => ({
      type: "folder",
      name: a.name,
      root: true,
      children: a.groups.map((g): PageTree.Folder => {
        const [landing, ...rest] = g.pages;
        return {
          type: "folder",
          name: g.name,
          index: item(landing),
          children: [
            ...rest.map(item),
            ...g.subs.map((s): PageTree.Folder => ({ type: "folder", name: s.name, children: s.pages.map(item) })),
          ],
        };
      }),
    })),
  };
}

export function allPages(c: Candidate): Page[] {
  return c.areas.flatMap((a) => a.groups.flatMap((g) => [...g.pages, ...g.subs.flatMap((s) => s.pages)]));
}

export function childrenOf(c: Candidate, page: Page): Page[] {
  const group = c.areas.flatMap((a) => a.groups).find((g) => g.name === page.group && g.pages[0]?.url === page.url);
  if (group) return [...group.pages.slice(1), ...group.subs.flatMap((s) => s.pages)];
  return [];
}

export const SCREEN_WORDS = 250;
