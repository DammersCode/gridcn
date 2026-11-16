import { describe, expect, it } from "vitest";
import type { Root } from "fumadocs-core/page-tree";
import { getStepPosition } from "@/lib/step-position";

const tree = {
  name: "Docs",
  children: [
    {
      type: "folder",
      name: "Path",
      children: [
        { type: "page", name: "One", url: "/docs/path/one" },
        { type: "page", name: "Two", url: "/docs/path/two" },
        { type: "page", name: "Three", url: "/docs/path/three" },
      ],
    },
    { type: "page", name: "Loose", url: "/docs/loose" },
  ],
} as Root;

describe("getStepPosition", () => {
  it("counts the page among its folder's pages in tree order", () => {
    expect(getStepPosition(tree, "/docs/path/two")).toEqual({ step: 2, total: 3 });
  });

  it("returns undefined for a page outside a folder", () => {
    expect(getStepPosition(tree, "/docs/loose")).toBeUndefined();
  });
});
