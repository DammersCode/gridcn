import { describe, expect, it } from "vitest";
import { checkChannelMaterialization } from "../scripts/verify-source-rules.mjs";

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
