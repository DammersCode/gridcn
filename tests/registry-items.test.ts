import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// registry.json is the source of truth for item names; this test keeps the
// RegistryItemName literal union (lib/registry-items.ts) from drifting from it.
const registry = JSON.parse(readFileSync(resolve(__dirname, "../registry.json"), "utf8")) as {
  items: { name: string }[];
};
const source = readFileSync(resolve(__dirname, "../lib/registry-items.ts"), "utf8");
const listed = [...source.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]!);

it("RegistryItemName lists every registry.json item exactly once", () => {
  expect([...listed].sort()).toEqual(registry.items.map((item) => item.name).sort());
});

it("RegistryItemName has no duplicate literals", () => {
  expect(new Set(listed).size).toBe(listed.length);
});
