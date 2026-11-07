import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000 });
import * as skeleton from "../scripts/docs-skeleton.mjs";
import * as codeMod from "../scripts/verify-docs-code.mjs";
import * as linksMod from "../scripts/verify-docs-links.mjs";

type Opts = Record<string, unknown>;
type Run = { failures: string[]; warnings: string[] };
const runCode = codeMod.run as (o: Opts) => Run;
const runLinks = linksMod.run as (o: Opts) => Promise<Run>;
const fileOf = skeleton.fileOf as (row: Record<string, unknown>) => string;
const rewriteTarget = skeleton.rewriteTarget as (t: string, byOld: Map<string, unknown>, anchors: Record<string, Record<string, string>>) => string;
const rewriteLinks = skeleton.rewriteLinks as (t: string, byOld: Map<string, unknown>, anchors: Record<string, Record<string, string>>) => string;
const redirectList = skeleton.redirectList as (entries: unknown[]) => { source: string; destination: string }[];
const metaFiles = skeleton.metaFiles as (list: { rows: Record<string, unknown>[] }) => Map<string, { pages: string[] }>;

const roots: string[] = [];
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "docs-verify-fixes-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}
const page = (title: string, body: string) => `---\ntitle: ${title}\ndescription: A page.\n---\n\n${body}\n`;
const scriptsDir = resolve(__dirname, "../scripts");

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("skeleton helpers", () => {
  const entries = [
    { old: "/docs/addons/fill", target: "/docs/clipboard-undo/fill-handle", split: false },
    { old: "/docs/columns", target: "/docs/columns", split: true },
  ];
  const byOld = new Map(entries.map((e) => [e.old, e]));
  const anchors = { "/docs/columns": { resize: "/docs/columns/column-sizing#resize" } };

  it("names the file of a page from its URL, the landing as index, the home at the root", () => {
    expect(fileOf({ url: "/docs", area: "Learn", landing: true })).toBe("content/docs/index.mdx");
    expect(fileOf({ url: "/docs/columns", area: "Build", landing: true })).toBe("content/docs/(build)/columns/index.mdx");
    expect(fileOf({ url: "/docs/clipboard-undo/fill-handle", area: "Build", landing: false })).toBe("content/docs/(build)/clipboard-undo/fill-handle.mdx");
  });

  it("keeps the anchor of a moved page, maps the anchor of a split page, and falls back to the landing", () => {
    expect(rewriteTarget("/docs/addons/fill#touch", byOld, anchors)).toBe("/docs/clipboard-undo/fill-handle#touch");
    expect(rewriteTarget("/docs/columns#resize", byOld, anchors)).toBe("/docs/columns/column-sizing#resize");
    expect(rewriteTarget("/docs/columns#unknown", byOld, anchors)).toBe("/docs/columns");
    expect(rewriteTarget("/docs/addons/fill.md", byOld, anchors)).toBe("/docs/clipboard-undo/fill-handle.md");
    expect(rewriteTarget("/docs/other", byOld, anchors)).toBe("/docs/other");
  });

  it("rewrites links in Markdown, JSX, inline code, absolute URLs, and before trailing punctuation", () => {
    const text = "[a](/docs/addons/fill#x) <a href=\"/docs/addons/fill\"> `/docs/addons/fill.md` https://gridcn.vercel.app/docs/addons/fill.md. [b](/docs/other)";
    expect(rewriteLinks(text, byOld, anchors)).toBe(
      "[a](/docs/clipboard-undo/fill-handle#x) <a href=\"/docs/clipboard-undo/fill-handle\"> `/docs/clipboard-undo/fill-handle.md` https://gridcn.vercel.app/docs/clipboard-undo/fill-handle.md. [b](/docs/other)",
    );
  });

  it("lists a redirect and its .md twin per moved page and skips unmoved pages", () => {
    const list = redirectList([...entries, { old: "/docs/same", target: "/docs/same", split: false }]);
    expect(list.map((r) => `${r.source}>${r.destination}`)).toEqual([
      "/docs/addons/fill>/docs/clipboard-undo/fill-handle",
      "/docs/addons/fill.md>/docs/clipboard-undo/fill-handle.md",
    ]);
  });

  it("builds area, group, and subgroup meta files in page order", () => {
    const rows = [
      { area: "Build", group: "Group one", subgroup: "", url: "/docs/group-one", landing: true },
      { area: "Build", group: "Group one", subgroup: "", url: "/docs/group-one/alpha", landing: false },
      { area: "Build", group: "Group one", subgroup: "Deep", url: "/docs/group-one/deep", landing: true },
      { area: "Build", group: "Group one", subgroup: "Deep", url: "/docs/group-one/deep/beta", landing: false },
    ];
    const metas = metaFiles({ rows });
    expect(metas.get("content/docs/(build)/meta.json")?.pages).toEqual(["group-one"]);
    expect(metas.get("content/docs/(build)/group-one/meta.json")?.pages).toEqual(["index", "alpha", "deep"]);
    expect(metas.get("content/docs/(build)/group-one/deep/meta.json")?.pages).toEqual(["index", "beta"]);
  });
});

describe("links in Markdown files", () => {
  it("checks inline-code site paths in skills and plain http site URLs", async () => {
    const root = fixture({
      "content/docs/a.mdx": page("A", "Text."),
      "skills/x/SKILL.md": "See `/docs/a` and `/docs/nope` and http://gridcn.vercel.app/docs/gone, and `/docs/<page>.md`.",
      "next.config.mjs": "export default {};",
    });
    const result = await runLinks({ root });
    expect(result.failures.map((f) => f.replace(/^.*?: /, ""))).toEqual(["/docs/nope -> no page /docs/nope", "http://gridcn.vercel.app/docs/gone -> no page /docs/gone"]);
  });

  it("reads redirects from content/docs-redirects.json and checks their destinations", async () => {
    const root = fixture({
      "content/docs/new.mdx": page("New", "## Part"),
      "content/docs-redirects.json": JSON.stringify([{ source: "/docs/old", destination: "/docs/new" }, { source: "/docs/bad", destination: "/docs/nowhere" }]),
      "README.md": "[old](/docs/old)",
      "next.config.mjs": "export default {};",
    });
    const result = await runLinks({ root });
    expect(result.failures.some((f) => f.includes("/docs/old only works through a redirect"))).toBe(true);
    expect(result.failures.some((f) => f.includes("redirect destination /docs/nowhere does not resolve"))).toBe(true);
  });
});

describe("docs-verify command", () => {
  it("keeps a missing work list under --files and fails a page with no counterpart row", () => {
    const root = fixture({ "content/docs/a.mdx": page("A", "Text.") });
    const result = spawnSync(process.execPath, [join(scriptsDir, "docs-verify.mjs"), "--root", root, "--only", "structure", "--final", "--worklist", "missing.json", "--files", "content/docs/a.mdx"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("work list missing.json not found");
  });
});

describe("verify-docs-code, fragments", () => {
  it("accepts a needs marker only for a package the block imports and the repo lacks, and still compiles @/ imports", () => {
    const result = runCode({ files: ["tests/fixtures/docs-verify/needs.mdx"] });
    const text = result.failures.join("\n");
    expect(text).toContain("the block does not import left-pad-missing");
    expect(text).toContain("react is installed; remove the needs marker");
    expect(text).toContain("TS2307");
    expect(text).not.toContain("not-installed-pkg is");
  }, 60_000);
});
