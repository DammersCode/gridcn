import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import * as mod from "../scripts/verify-docs-unions.mjs";

type Entry = Record<string, unknown>;
const run = mod.run as (o: { root: string; manifest?: Entry[]; baseline?: Entry[] }) => { failures: string[] };
const resolveEntry = mod.resolveEntry as (root: string, entry: Entry) => string[];

const root = mkdtempSync(join(tmpdir(), "docs-unions-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
mkdirSync(join(root, "src"));
mkdirSync(join(root, "docs"));
writeFileSync(
  join(root, "src/types.ts"),
  [
    'export type Content = "number" | "checkbox";',
    'export type Mode = "none" | Content | `reorder-${Content}`;',
    'export type Change = { source: "edit" | "paste" | "stream"; ops: string[] };',
    'const DEFAULTS = ["edit", "paste"] as const;',
    "export type Fromconst = (typeof DEFAULTS)[number] | \"extra\";",
  ].join("\n"),
);
writeFileSync(join(root, "docs/page.mdx"), "Modes: `none`, `number`, and `checkbox`.\n\nSources: `edit`, `paste`, `ghost`.\n");

const mode: Entry = { id: "mode", file: "src/types.ts", type: "Mode", page: "docs/page.mdx", marker: "Modes:" };
const source: Entry = { id: "source", file: "src/types.ts", type: "Change", member: "source", page: "docs/page.mdx", marker: "Sources:" };

describe("verify-docs-unions", () => {
  it("resolves aliases, templates, properties, and const arrays", () => {
    expect(resolveEntry(root, mode)).toEqual(["none", "number", "checkbox", "reorder-number", "reorder-checkbox"]);
    expect(resolveEntry(root, source)).toEqual(["edit", "paste", "stream"]);
    expect(resolveEntry(root, { id: "c", file: "src/types.ts", type: "Fromconst" })).toEqual(["edit", "paste", "extra"]);
  });

  it("fails a page that lacks a member and a page that lists a member the source lacks", () => {
    const failures = run({ root, manifest: [mode, source], baseline: [] }).failures;
    expect(failures).toEqual([
      expect.stringContaining("[mode] lacks reorder-number, reorder-checkbox"),
      expect.stringContaining("[source] lacks stream lists ghost"),
    ]);
  });

  it("accepts drift named in the baseline and fails a stale baseline entry", () => {
    const baseline = [
      { id: "mode", missing: ["reorder-number", "reorder-checkbox"], unknown: [] },
      { id: "source", missing: ["stream"], unknown: ["ghost"] },
    ];
    expect(run({ root, manifest: [mode, source], baseline }).failures).toEqual([]);
    expect(run({ root, manifest: [mode], baseline }).failures).toEqual([expect.stringContaining("source no longer drifts")]);
  });

  it("fails a union or a marker that cannot be found", () => {
    expect(run({ root, manifest: [{ ...mode, type: "Missing" }], baseline: [] }).failures[0]).toContain("Missing not found");
    expect(run({ root, manifest: [{ ...mode, marker: "Nope" }], baseline: [] }).failures[0]).toContain("is not on the page");
  });

  it("passes on the repo tree", () => {
    expect(run({ root: process.cwd() }).failures).toEqual([]);
  });
});
