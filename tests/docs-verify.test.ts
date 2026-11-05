import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { anchorsOf, codeBlocks, urlOfPage } from "../scripts/docs-verify-lib.mjs";
import * as codeMod from "../scripts/verify-docs-code.mjs";
import * as demosMod from "../scripts/verify-docs-demos.mjs";
import * as linksMod from "../scripts/verify-docs-links.mjs";
import * as propsMod from "../scripts/verify-docs-props.mjs";
import * as proseMod from "../scripts/verify-docs-prose.mjs";
import * as structureMod from "../scripts/verify-docs-structure.mjs";
import * as symbolsMod from "../scripts/verify-docs-symbols.mjs";

type Run = { failures: string[]; warnings: string[]; checked?: number; fragments?: number };
type Opts = Record<string, unknown>;
const runCode = codeMod.run as (o: Opts) => Run;
const fragmentReason = codeMod.fragmentReason as (meta: string) => string | undefined;
const runDemos = demosMod.run as (o: Opts) => Run;
const runLinks = linksMod.run as (o: Opts) => Promise<Run>;
const runProps = propsMod.run as (o: Opts) => Run;
type Def = { name: string; members: Map<string, { optional: boolean }>; extends: string[] };
const parseTypes = propsMod.parseTypes as (src: string) => Def[];
const propsTables = propsMod.propsTables as (body: string) => { marker?: string[]; rows: { name: string }[] }[];
const sourceDefaults = propsMod.sourceDefaults as (name: string, texts: string[]) => Set<string>;
const lintPage = proseMod.lintPage as (body: string) => { rule: string }[];
const runStructure = structureMod.run as (o: Opts) => Run;
const aliasesOf = structureMod.aliasesOf as (front: string) => string[];
const runSymbols = symbolsMod.run as (o: Opts) => Run;
const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "docs-verify-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const page = (title: string, body: string, extra = "") => `---\ntitle: ${title}\ndescription: A page.\n${extra}---\n\n${body}\n`;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("docs-verify-lib", () => {
  it("slugs headings like the site, with code, explicit ids, and repeats", () => {
    const anchors = anchorsOf("## `CellType<TData, TValue>`\n\n## Usage\n\n## Usage\n\n## Plain [#custom-id]\n\n```md\n## not a heading\n```\n");
    expect([...anchors]).toEqual(["celltypetdata-tvalue", "usage", "usage-1", "custom-id", "plain"]);
  });

  it("maps a file to its URL and drops route groups and index", () => {
    expect(urlOfPage("/c", "/c/(learn)/guide/index.mdx")).toBe("/docs/guide");
    expect(urlOfPage("/c", "/c/index.mdx")).toBe("/docs");
  });

  it("reads fence blocks with their info string and start line", () => {
    const [block] = codeBlocks("text\n\n```tsx title=\"a.tsx\"\nconst a = 1;\n```\n");
    expect(block).toMatchObject({ lang: "tsx", meta: 'title="a.tsx"', code: "const a = 1;", line: 4 });
  });
});

describe("verify-docs-links", () => {
  it("reports a dead page, a dead anchor, and a link that only works through a redirect", async () => {
    const root = fixture({
      "content/docs/index.mdx": page("Home", "[ok](/docs/a#intro) [bad anchor](/docs/a#nope) [gone](/docs/gone) [old](/docs/old) [self](#missing)\n\n## Top"),
      "content/docs/a.mdx": page("A", "## Intro"),
      "next.config.mjs": 'export default { redirects: async () => [{ source: "/docs/old", destination: "/docs/a" }] };',
      "README.md": "See [docs](/docs/a#intro) and [x](/docs/zzz).",
    });
    const result: Run = await runLinks({ root });
    expect(result.failures.map((f) => f.replace(/^.*?: /, ""))).toEqual([
      "/docs/a#nope -> no anchor #nope on /docs/a",
      "/docs/gone -> no page /docs/gone",
      "#missing -> anchor #missing missing on this page",
      "/docs/zzz -> no page /docs/zzz",
    ]);
    expect(result.warnings).toHaveLength(1);
  });

  it("checks a migration map: targets exist and old URLs redirect", async () => {
    const root = fixture({
      "content/docs/new.mdx": page("New", "## Part"),
      "next.config.mjs": "export default {};",
      "map/url-map.json": JSON.stringify([{ old: "/docs/old", target: "/docs/new" }]),
      "map/anchor-map.json": JSON.stringify({ "/docs/old": { part: "/docs/new#part", gone: "/docs/new#gone" } }),
    });
    const result: Run = await runLinks({ root, migration: "map" });
    expect(result.failures).toEqual(["migration: /docs/old has no redirect", "migration: /docs/old#gone -> /docs/new#gone does not resolve"]);
  });
});

describe("verify-docs-props", () => {
  const source = `
export interface BaseOptions { /** doc */ pageSize?: number; mode: "a" | "b" }
export interface ToolbarOptions extends BaseOptions {
  density?: "compact" | "roomy";
  onChange?: (value: string, extra: { a: number; b: number }) => void;
}
export type Pager = { size: number } & ToolbarOptions;
`;

  it("parses interface members, optionality, and inheritance", () => {
    const byName = Object.fromEntries(parseTypes(source).map((d) => [d.name, d]));
    expect([...(byName["ToolbarOptions"]?.members.keys() ?? [])]).toEqual(["density", "onChange"]);
    expect(byName["ToolbarOptions"]?.extends).toEqual(["BaseOptions"]);
    expect(byName["BaseOptions"]?.members.get("mode")?.optional).toBe(false);
    expect(byName["Pager"]?.extends).toEqual(["ToolbarOptions"]);
  });

  it("finds source defaults in destructuring and nullish fallbacks", () => {
    expect([...sourceDefaults("pageSize", ["const { pageSize = 50 } = options;", "const n = opts.pageSize ?? 25;"])].sort()).toEqual(["25", "50"]);
  });

  it("reads a props table and its marker", () => {
    const [table] = propsTables("{/* props: ToolbarOptions */}\n\n| Prop | Type | Default |\n|---|---|---|\n| `a` | x | `1` |\n| `b` <NewBadge /> | x | none |\n| `c()` | x | none |\n");
    expect(table?.marker).toEqual(["ToolbarOptions"]);
    expect(table?.rows.map((r: { name: string }) => r.name)).toEqual(["a", "b", "c"]);
  });

  it("fails a pinned table for an unknown prop, a wrong default, and a required prop with a default", () => {
    const root = fixture({
      "registry/default/blocks/x/types.ts": source,
      "registry/default/blocks/x/use-x.ts": "export function useX({ pageSize = 50, density }: ToolbarOptions) {}",
      "content/docs/p.mdx": page(
        "P",
        "{/* props: ToolbarOptions */}\n\n| Prop | Type | Default |\n|---|---|---|\n| `pageSize` | `number` | `20` |\n| `density` | x | none |\n| `ghost` | x | none |\n| `mode` | x | `\"a\"` |\n",
      ),
    });
    const result: Run = runProps({ root });
    expect(result.failures.map((f) => f.replace(/^.*?: /, ""))).toEqual([
      "`pageSize` default `20` differs from source (50)",
      "`ghost` is not a member of ToolbarOptions",
      '`mode` has default `"a"` but the source member is required',
    ]);
  });

  it("keeps mismatches of a guessed table as warnings", () => {
    const root = fixture({
      "registry/default/blocks/x/types.ts": source,
      "content/docs/p.mdx": page("P", "| Prop | Type | Default |\n|---|---|---|\n| `density` | x | none |\n| `onChange` | x | none |\n| `mode` | x | none |\n| `pageSize` | x | `5` |\n"),
    });
    const result: Run = runProps({ root });
    expect(result.failures).toEqual([]);
    expect(result.warnings.some((w) => w.includes("pin it with"))).toBe(true);
  });
});

describe("verify-docs-symbols", () => {
  it("fails a gridcn symbol that the source no longer has, and a broken AutoTypeTable", () => {
    const root = fixture({
      "registry/default/blocks/x/a.ts": "export function useDataGridThing() {}\nexport interface ThingOptions { x: number }\n",
      "content/docs/p.mdx": page("P", 'Call `useDataGridThing()` with `ThingOptions`, never `useDataGridOldThing`. Use `onMutate` freely.\n\n<AutoTypeTable path="registry/default/blocks/x/a.ts" name="ThingOptions" />\n<AutoTypeTable path="registry/default/blocks/x/a.ts" name="Nope" />\n'),
      "scripts/docs-symbols-allow.txt": "onMutate # other library\n",
    });
    const result: Run = runSymbols({ root });
    expect(result.failures.map((f) => f.replace(/^.*?: /, ""))).toEqual(["AutoTypeTable name Nope is not defined in registry/default/blocks/x/a.ts", "`useDataGridOldThing` is not in the registry source"]);
  });
});

describe("verify-docs-demos", () => {
  it("cross-checks embeds, registry, and install items, and warns on several demos", () => {
    const root = fixture({
      "components/registry-examples.tsx": 'const E = {\n  "demo-a": dynamic(() => import("x")),\n  "demo-b": dynamic(() => import("y")),\n  "demo-c": dynamic(() => import("z")),\n};',
      "registry/default/examples/demo-a.tsx": "",
      "registry/default/examples/demo-b.tsx": "",
      "registry.json": JSON.stringify({ items: [{ name: "demo-a", type: "registry:example" }, { name: "kit" }, { name: "demo-d", type: "registry:example" }] }),
      "scripts/docs-demos-internal.txt": "demo-c # kept for the playground\n",
      "content/docs/p.mdx": page("P", '<ComponentPreview name="demo-a" />\n<ComponentPreview name="missing" />\n<ComponentPreview name="demo-a" />\n<InstallCommand item="kit" />\n<InstallCommand item="nokit" />'),
    });
    const result: Run = runDemos({ root });
    expect(result.failures.map((f) => f.replace(/^.*?: /, ""))).toEqual([
      "demo missing is not in components/registry-examples.tsx",
      "install item nokit is not in registry.json",
      "registry.json example demo-d is not in components/registry-examples.tsx",
      "demo demo-b is registered but no page embeds it (use it or list it in scripts/docs-demos-internal.txt)",
      "demo-c has no file in registry/default/examples",
    ]);
    expect(result.warnings.some((w) => w.includes("3 demos"))).toBe(true);
  });
});

describe("verify-docs-prose", () => {
  const rules = (body: string): string[] => lintPage(body).map((h: { rule: string }) => h.rule);

  it("flags banned modals, filler, contractions, semicolons, and timeless words", () => {
    expect(rules("You should simply use it; it's fine and now works.")).toEqual(expect.arrayContaining(["banned-modal", "slop", "semicolon", "contraction", "timeless"]));
  });

  it("flags a sentence over 25 words and a paragraph over 110 words", () => {
    const long = `${Array.from({ length: 30 }, () => "word").join(" ")}.`;
    expect(rules(long)).toContain("long-sentence");
    expect(rules(`${Array.from({ length: 14 }, () => "One two three four five six seven eight.").join(" ")}`)).toContain("long-paragraph");
  });

  it("accepts short active sentences and skips code, tables, and lint-ok paragraphs", () => {
    expect(rules("Set `rowHeight` to a number:\n\n```ts\nconst should = 1;\n```\n\n| a | b |\n|---|---|\n| should | may |\n")).toEqual([]);
    expect(rules("{/* lint-ok: quoted API text */}\nIt may fail.\n")).toEqual([]);
  });

  it("requires a colon before a code sample, an ellipsis comment instead of dots, and prose for a one-item list", () => {
    expect(rules("Install it.\n\n```bash\nnpm i x\n```\n")).toContain("intro-colon");
    expect(rules("Install it:\n\n```ts\nconst a = { ... };\n```\n")).toContain("omission-dots");
    expect(rules("Install it:\n\n```ts\nf(...args);\n```\n")).not.toContain("omission-dots");
    expect(rules("Steps:\n\n1. Only one.\n")).toContain("one-item-list");
    expect(rules("Steps:\n\n1. One.\n2. Two.\n")).not.toContain("one-item-list");
  });
});

describe("verify-docs-structure", () => {
  it("fails a status line, a badge in a heading, a duplicate title, an unknown type, and a Related with too many links", () => {
    const related = "## Related\n\n" + Array.from({ length: 6 }, (_, i) => `- [p${i}](/docs/a)`).join("\n");
    const root = fixture({
      "content/docs/a.mdx": page("Same", `## Heading <NewBadge />\n\n${related}`, "status: new\ntype: weird\n"),
      "content/docs/b.mdx": page("Same", "## Related\n\n- [a](/docs/a)"),
    });
    const result: Run = runStructure({ root, base: "HEAD" });
    expect(result.failures.map((f) => f.replace(/^.*?: /, ""))).toEqual(
      expect.arrayContaining(['unknown type "weird"', "remove the status: line (content/docs-changes.json holds page status)", expect.stringContaining("<NewBadge /> sits in a heading"), "Related has 6 docs links, expected 1 to 5", expect.stringContaining('title "Same" is also')]),
    );
  });

  it("requires a Server mode H2 for pages the work list ties to the parity matrix", () => {
    const root = fixture({
      "content/docs/sorting.mdx": page("Sorting", "## Related\n\n- [x](/docs/sorting)"),
      "list.json": JSON.stringify({ pages: [{ url: "/docs/sorting", parity: ["sort"] }] }),
    });
    expect(runStructure({ root, worklist: "list.json", base: "HEAD" }).failures.join("\n")).toContain('need a "Server mode" H2');
  });

  it("reads aliases from both YAML forms", () => {
    expect(aliasesOf("aliases: [frozen, sticky]")).toEqual(["frozen", "sticky"]);
    expect(aliasesOf('aliases:\n  - "frozen"\n  - sticky\n')).toEqual(["frozen", "sticky"]);
  });
});

describe("verify-docs-code", () => {
  const files = ["tests/fixtures/docs-verify/code.mdx"];

  it("understands fragment markers", () => {
    expect(fragmentReason('fragment="JSX only"')).toBe("JSX only");
    expect(fragmentReason("fragment")).toBe("");
    expect(fragmentReason('title="x"')).toBeUndefined();
  });

  it("compiles good blocks, reports bad ones, and checks the imports of fragments", () => {
    const result = runCode({ files });
    expect(result.checked).toBe(5);
    expect(result.fragments).toBe(2);
    expect(result.failures.map((f: string) => f.replace(/^.*?: /, ""))).toEqual(
      expect.arrayContaining([expect.stringContaining("TS2322"), expect.stringContaining("fragment needs a reason"), expect.stringContaining("useDataGridNoSuchHook is not exported"), expect.stringContaining("TS1108")]),
    );
    expect(result.failures.join("\n")).not.toContain("code.mdx:8");
  }, 60_000);
});
