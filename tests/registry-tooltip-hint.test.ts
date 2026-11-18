import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Item = { name: string; docs?: string; registryDependencies?: string[] };

describe("tooltip install hint", () => {
  it("tells the reader of every item that needs the tooltip primitive to add a TooltipProvider", () => {
    const { items } = JSON.parse(readFileSync("registry.json", "utf8")) as { items: Item[] };
    const needTooltip = items.filter((item) => item.registryDependencies?.includes("tooltip"));
    expect(needTooltip.length).toBeGreaterThan(0);
    for (const item of needTooltip) expect(item.docs, item.name).toContain("TooltipProvider");
  });
});
