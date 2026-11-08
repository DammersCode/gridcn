#!/usr/bin/env node
// A barrel of the core or an add-on exports what the docs teach. A value name missing from content/docs needs an entry in
// scripts/barrel-exports-baseline.json (grandfathered names only). Run with --write to regenerate the baseline.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const blocks = join(root, "registry", "default", "blocks");
const baselinePath = join(root, "scripts", "barrel-exports-baseline.json");

function* walk(dir, pattern) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, pattern);
    else if (pattern.test(entry.name)) yield full;
  }
}

const docs = [...walk(join(root, "content", "docs"), /\.mdx$/)].map((file) => readFileSync(file, "utf8")).join("\n");

function barrelValueNames(source) {
  const names = [];
  for (const match of source.matchAll(/export\s*\{([^}]*)\}\s*from/g)) {
    for (const part of match[1].split(",")) {
      const item = part.trim();
      if (!item || item.startsWith("type ")) continue;
      names.push(item.split(/\s+as\s+/).pop().trim());
    }
  }
  return names;
}

const undocumented = {};
for (const dir of readdirSync(blocks, { withFileTypes: true })) {
  if (!dir.isDirectory() || !(dir.name === "data-grid" || dir.name.startsWith("data-grid-"))) continue;
  const barrel = [".ts", ".tsx"].map((ext) => join(blocks, dir.name, `${dir.name}${ext}`)).find(existsSync);
  if (!barrel) continue;
  const missing = barrelValueNames(readFileSync(barrel, "utf8")).filter((name) => !new RegExp(String.raw`\b${name}\b`).test(docs));
  if (missing.length > 0) undocumented[dir.name] = missing.sort();
}

if (process.argv.includes("--write")) {
  writeFileSync(baselinePath, `${JSON.stringify(undocumented, null, 2)}\n`);
  console.log("verify-barrel-exports: baseline written");
  process.exit(0);
}

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : {};
const problems = [];
for (const [block, names] of Object.entries(undocumented)) {
  for (const name of names) {
    if (!(baseline[block] ?? []).includes(name)) problems.push(`${block} exports ${name}, which content/docs never mentions. Document it or take it off the barrel.`);
  }
}
if (problems.length > 0) {
  console.error(`verify-barrel-exports: ${problems.length} problem(s)\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("verify-barrel-exports: ok");
