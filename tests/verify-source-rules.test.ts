import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkChannelMaterialization, checkViewIndexReads, sourceRuleProblems } from "../scripts/verify-source-rules.mjs";

const allowlist = new Map([["a/listed.ts", { count: 1, reason: "returns the list" }]]);
const check = (files: { path: string; text: string }[]) => checkChannelMaterialization(files, allowlist);
const listed = { path: "a/listed.ts", text: "return rows.toArray();" };

describe("checkChannelMaterialization", () => {
  it("accepts runs() walks and the allowlisted toArray() calls", () => {
    expect(check([listed, { path: "a/b.ts", text: "for (const [start, end] of selection.rows.runs()) visit(start, end);" }])).toEqual([]);
  });

  it("fails on toArray() outside the allowlist", () => {
    expect(check([listed, { path: "a/b.ts", text: "const x = 1;\nconst rows = selection.rows.toArray();" }])).toEqual([
      "a/b.ts:2 — walk the channel's runs() instead of toArray(); a list of every checked row costs O(rows)",
    ]);
  });

  it("fails when an allowlisted file gains a toArray() call", () => {
    expect(check([{ path: "a/listed.ts", text: "rows.toArray();\ncolumns.toArray();" }])).toEqual([
      "a/listed.ts — has 2 toArray() call(s) but the allowlist expects 1; walk runs() or update CHANNEL_LIST_ALLOWLIST with a reason",
    ]);
  });

  it("fails on a stale allowlist entry", () => {
    expect(check([])).toEqual(["a/listed.ts — listed in CHANNEL_LIST_ALLOWLIST but not found; remove the entry"]);
  });

  it("fails on an iterator spread or Array.from of a channel", () => {
    expect(check([listed, { path: "a/b.ts", text: "const a = [...s.selection.rows];\nconst b = Array.from(selection.columns);" }])).toEqual([
      "a/b.ts:1 — walk the channel's runs() instead of spreading it into a list",
      "a/b.ts:2 — walk the channel's runs() instead of spreading it into a list",
    ]);
  });
});

describe("sourceRuleProblems", () => {
  const withBlocks = (files: Record<string, string>) => {
    const base = mkdtempSync(join(tmpdir(), "source-rules-"));
    mkdirSync(join(base, "components"), { recursive: true });
    writeFileSync(join(base, "components/registry-examples.tsx"), "");
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(base, path)), { recursive: true });
      writeFileSync(join(base, path), text);
    }
    return base;
  };

  it("flags a fixed px size in a .ts block file as well as a .tsx one", () => {
    const base = withBlocks({ "registry/default/blocks/x/size.ts": 'export const cls = "text-[10px]";', "registry/default/blocks/x/view.tsx": 'export const v = <p className="w-[3px]" />;' });
    expect(sourceRuleProblems(base).filter((p: string) => p.includes("px size")).map((p: string) => p.replaceAll("\\", "/"))).toEqual([
      expect.stringContaining("registry/default/blocks/x/size.ts:1"),
      expect.stringContaining("registry/default/blocks/x/view.tsx:1"),
    ]);
    rmSync(base, { recursive: true, force: true });
  });
});

describe("checkViewIndexReads", () => {
  const baseline = new Set(["a/listed.ts"]);
  const read = { path: "a/listed.ts", text: "const i = s.viewIndex[row];" };
  const check = (files: { path: string; text: string }[]) => checkViewIndexReads(files, baseline);

  it("accepts the reader module, the sort-filter builders, length reads, and the baseline", () => {
    expect(
      check([
        read,
        { path: "registry/default/blocks/data-grid/store/view-rows.ts", text: "const i = view[row]; s.viewIndex[row];" },
        { path: "registry/default/blocks/data-grid/sort-filter/x.ts", text: "return viewIndex[0];" },
        { path: "a/b.ts", text: "const n = s.viewIndex.length;" },
      ]),
    ).toEqual([]);
  });

  it("fails on an element read outside the allowed files, also under a prev or next name", () => {
    expect(check([read, { path: "a/b.ts", text: "x;\nconst i = s.viewIndex[row];\nnextViewIndex[row];" }])).toEqual([
      expect.stringMatching(/^a\/b\.ts:2 /),
      expect.stringMatching(/^a\/b\.ts:3 /),
    ]);
  });

  it("fails on a baseline entry that no longer reads the view", () => {
    expect(check([{ path: "a/listed.ts", text: "dataIndexAt(s, row);" }])).toEqual([expect.stringContaining("remove the entry")]);
  });

  it("holds for the shipped blocks", () => {
    expect(sourceRuleProblems(process.cwd()).filter((p: string) => p.includes("dataIndexAt"))).toEqual([]);
  });
});
