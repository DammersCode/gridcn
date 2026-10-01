#!/usr/bin/env node
// Fails when registry source imports another item outside its block-root barrel, or when the core imports an add-on.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const REGISTRY_BLOCK_ITEMS = [
  "data-grid",
  "data-grid-presence",
  "data-grid-fill",
  "data-grid-pinned-rows",
  "data-grid-history",
  "data-grid-toolbar",
  "data-grid-context-menu",
  "data-grid-keybindings",
  "data-grid-url-state",
  "data-grid-io",
  "data-grid-lazy",
  "data-grid-pagination",
  "data-grid-sort-list",
  "dropzone",
];
// data-grid/data-grid-sdk is the core's add-on-facing SDK barrel (first-party add-ons import it;
// consumers use data-grid/data-grid).
const ALLOWED_BARRELS = new Set([...REGISTRY_BLOCK_ITEMS.map((item) => `${item}/${item}`), "data-grid/data-grid-sdk"]);

const BLOCKS_ROOT = join(root, "registry", "default", "blocks");
const IMPORT_RE = /(?:from\s+|import\s+)["']([^"']+)["']/g;

function isTestFile(name) {
  return /\.(test|browser\.test|type-test|test-helper)\.[^./]+$/.test(name);
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !isTestFile(entry.name)) yield full;
  }
}

const violations = [];

for (const file of walk(BLOCKS_ROOT)) {
  const rel = relative(root, file).split("\\").join("/");
  const inCore = rel.startsWith("registry/default/blocks/data-grid/");
  const content = readFileSync(file, "utf8");

  content.split("\n").forEach((line, i) => {
    for (const match of line.matchAll(IMPORT_RE)) {
      const spec = match[1];
      if (!spec.startsWith("@/registry/default/blocks/")) continue;
      const rest = spec.slice("@/registry/default/blocks/".length);

      if (rest.startsWith("data-grid-") && inCore) {
        violations.push(`${rel}:${i + 1}: core data-grid imports an add-on item (${spec}) — dependencies flow add-on -> core, never the reverse.`);
      }
      const segments = rest.split("/");
      if (segments.length >= 2 && !ALLOWED_BARRELS.has(rest)) {
        violations.push(`${rel}:${i + 1}: cross-item registry import must go through the target item's block-root barrel, e.g. @/registry/default/blocks/<item>/<item> (got ${spec}).`);
      }
    }
  });
}

if (violations.length > 0) {
  console.error(`\nIMPORT BOUNDARY VIOLATIONS (${violations.length}):\n${violations.join("\n")}\n`);
  process.exit(1);
}
console.log("Import boundaries: no cross-item import outside block-root barrels; core imports no add-ons.");
