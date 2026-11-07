import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as libMod from "../scripts/docs-verify-lib.mjs";
import * as codeMod from "../scripts/verify-docs-code.mjs";
import * as demosMod from "../scripts/verify-docs-demos.mjs";
import * as linksMod from "../scripts/verify-docs-links.mjs";
import * as propsMod from "../scripts/verify-docs-props.mjs";
import * as structureMod from "../scripts/verify-docs-structure.mjs";
import { buildWorklist } from "../scripts/docs-rewrite-worklist.mjs";

type Opts = Record<string, unknown>;
type Run = { failures: string[]; warnings: string[]; fragments?: number };
const normalizeFile = libMod.normalizeFile as (file: string, base: string) => string;
const runLinks = linksMod.run as (o: Opts) => Promise<Run>;
const runDemos = demosMod.run as (o: Opts) => Run;
const runProps = propsMod.run as (o: Opts) => Run;
const runStructure = structureMod.run as (o: Opts) => Run;
const runCode = codeMod.run as (o: Opts) => Run;

const roots: string[] = [];
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "docs-verify-more-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}
const page = (title: string, body: string, extra = "") => `---\ntitle: ${title}\ndescription: A page.\n${extra}---\n\n${body}\n`;
const scriptsDir = resolve(__dirname, "../scripts");

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("normalizeFile", () => {
  it("accepts docs pages in any path spelling and rejects other files", () => {
    expect(normalizeFile("./content/docs/a.mdx", "/r")).toBe("content/docs/a.mdx");
    expect(normalizeFile("content\\docs\\x\\b.mdx", "/r")).toBe("content/docs/x/b.mdx");
    expect(() => normalizeFile("README.md", "/r")).toThrow(/not a docs page/);
  });

  it("makes the docs-verify command stop on a file that is not a docs page", () => {
    const root = fixture({ "content/docs/a.mdx": page("A", "Text.") });
    const result = spawnSync(process.execPath, [join(scriptsDir, "docs-verify.mjs"), "--root", root, "--only", "prose", "--files", "README.md"], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("not a docs page");
  });

  it("reports the failures of a page given as ./content/docs/x.mdx", () => {
    const root = fixture({ "content/docs/a.mdx": page("A", "You should read this.") });
    const result = spawnSync(process.execPath, [join(scriptsDir, "docs-verify.mjs"), "--root", root, "--only", "prose", "--files", "./content/docs/a.mdx"], { encoding: "utf8" });
    expect(result.status).toBe(1);
  });
});

describe("verify-docs-links, more cases", () => {
  it("checks absolute site links in skill files and a redirect destination", async () => {
    const root = fixture({
      "content/docs/a.mdx": page("A", "## Intro"),
      "skills/x/SKILL.md": "[ok](https://gridcn.vercel.app/docs/a#intro) [dead](https://gridcn.vercel.app/docs/gone) [other](https://example.com/docs/gone)",
      "next.config.mjs": 'export default { redirects: async () => [{ source: "/docs/old", destination: "/docs/missing" }] };',
    });
    const result = await runLinks({ root });
    expect(result.failures.map((f) => f.replace(/^.*?: /, ""))).toEqual(["https://gridcn.vercel.app/docs/gone -> no page /docs/gone", "redirect destination /docs/missing does not resolve"]);
  });

  it("flags an anchor that the baseline page had and the current page lost", async () => {
    const root = fixture({ "content/docs/a.mdx": page("A", "## Old heading\n\n## Kept"), "next.config.mjs": "export default {};" });
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: root, stdio: "pipe" });
    git("init", "-q");
    git("add", ".");
    git("commit", "-qm", "base");
    writeFileSync(join(root, "content/docs/a.mdx"), page("A", "## New heading\n\n## Kept"));
    const result = await runLinks({ root, baseline: "HEAD" });
    expect(result.failures).toEqual(["baseline: /docs/a#old-heading is gone; keep the id with [#old-heading] or add it to the anchor map"]);
  }, 60_000);
});

describe("final-mode rules", () => {
  it("fails several demos and a demo on a concept page in strict mode only", () => {
    const files = {
      "components/registry-examples.tsx": 'const E = {\n  "d": dynamic(() => import("x")),\n};',
      "registry/default/examples/d.tsx": "",
      "registry.json": JSON.stringify({ items: [{ name: "d", type: "registry:example" }] }),
      "content/docs/c.mdx": page("C", '<ComponentPreview name="d" />\n<ComponentPreview name="d" />', "type: concept\n"),
    };
    const root = fixture(files);
    expect(runDemos({ root }).failures).toEqual([]);
    expect(runDemos({ root, strictRules: true }).failures.length).toBe(2);
  });

  it("requires Related and a type in final mode", () => {
    const root = fixture({ "content/docs/a.mdx": page("A", "Text.") });
    expect(runStructure({ root, base: "HEAD" }).failures).toEqual([]);
    const strict = runStructure({ root, base: "HEAD", requireType: true, requireRelated: true });
    expect(strict.failures.some((f) => f.includes("no Related"))).toBe(true);
    expect(strict.failures.some((f) => f.includes("no type"))).toBe(true);
  });

  it("fails a props table without a marker in strict mode", () => {
    const root = fixture({
      "registry/default/blocks/x/types.ts": "export interface Opts { a?: number; b?: string; c?: boolean }",
      "content/docs/p.mdx": page("P", "| Prop | Type |\n|---|---|\n| `a` | x |\n| `b` | x |\n| `c` | x |\n"),
    });
    expect(runProps({ root }).failures).toEqual([]);
    expect(runProps({ root, strict: true }).failures.join()).toContain("pin it with");
  });
});

describe("verify-docs-code, page rules", () => {
  it("fails undefined names in the first sample only, and a page with too many fragments", () => {
    const rel = "tests/fixtures/docs-verify/first-sample.mdx";
    const result = runCode({ files: [rel] });
    expect(result.failures.filter((f) => f.includes("TS2304"))).toHaveLength(1);
    expect(result.failures.join("\n")).toContain("are fragments; the limit is 20%");
  }, 60_000);
});

describe("work list", () => {
  it("splits writer batches by wave, hands generated pages to generators, and reads a mapped URL", () => {
    const root = fixture({
      "cand.txt": "@ Build\n## Group one\n- g1 | Group one | landing | 100\n- a | Alpha page | feature | 400\n- b | Beta page | feature | 400\n- cheat-x | Cheat X | cheatsheet | 300\n",
      "map.md": "| Slug | Source | Kind |\n|---|---|---|\n| a | `old-a` | move |\n| b | `old-b` | new text |\n| cheat-x | none | new, generated |\n",
      "url-map.json": JSON.stringify([{ old: "/docs/old-a", slugs: ["a"], target: "/docs/mapped/alpha" }]),
    });
    const list = buildWorklist({ candidate: join(root, "cand.txt"), contentMap: join(root, "map.md"), urlMap: join(root, "url-map.json"), root });
    type Row = { slug: string; wave: number; batch: string; url: string };
    const bySlug = Object.fromEntries((list.rows as Row[]).map((r) => [r.slug, r])) as Record<string, Row>;
    expect(bySlug["a"]?.wave).toBe(1);
    expect(bySlug["b"]?.wave).toBe(2);
    expect(bySlug["g1"]?.wave).toBe(3);
    expect(bySlug["cheat-x"]?.batch).toBe("G");
    expect(bySlug["a"]?.url).toBe("/docs/mapped/alpha");
    expect(new Set([bySlug["a"]?.batch, bySlug["b"]?.batch, bySlug["g1"]?.batch]).size).toBe(3);
  });
});
