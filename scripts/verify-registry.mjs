#!/usr/bin/env node
// Diffs registry.json `files` arrays against the filesystem per item, and asserts every file
// entry's `target` matches the derived value (scripts/add-registry-targets.mjs) — without it
// the shadcn CLI flattens nested source into components/ and domain index.ts files collide
// (the #60 install-layout defect). Run `node scripts/add-registry-targets.mjs` to fix drift.
// Excludes test files (*.test.*, *.browser.test.*, *.type-test.*, *.test-helper.*) and __screenshots__ — those must never ship.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveTarget } from "./add-registry-targets.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const registryPath = join(root, "registry.json");
const registry = JSON.parse(readFileSync(registryPath, "utf8"));

const isTestFile = (p) => /\.(test|browser\.test|type-test|test-helper)\.[^./]+$/.test(p);
const isScreenshot = (p) => p.split(/[/\\]/).includes("__screenshots__");
const isShippable = (p) => !isTestFile(p) && !isScreenshot(p);

function walk(dir, base = dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, base, out);
    } else if (entry.isFile()) {
      const rel = relative(base, full).split("\\").join("/");
      if (isShippable(rel)) out.push(rel);
    }
  }
  return out;
}

let hasDrift = false;
const summary = [];

// The item's own block folder (source of truth for "does this item have unlisted files").
// A files array may also reach into shared folders (e.g. components/ui/kbd.tsx) —
// those are compared file-by-file, not walked, since they're shared across items.
for (const item of registry.items) {
  const listedAll = item.files.map((f) => f.path);
  const listedShippable = listedAll.filter(isShippable);
  const listedTestFiles = listedAll.filter((p) => !isShippable(p));

  const ownFolder = `registry/default/blocks/${item.name}`;
  const ownFolderAbs = join(root, ownFolder);

  let onDisk;
  try {
    statSync(ownFolderAbs);
    onDisk = walk(ownFolderAbs, ownFolderAbs).map((p) => `${ownFolder}/${p}`).sort();
  } catch {
    onDisk = [];
  }

  const listedSet = new Set(listedShippable);
  const diskSet = new Set(onDisk);

  const missingFromRegistry = onDisk.filter((p) => !listedSet.has(p));
  // Files listed outside the item's own folder (shared components) are checked for existence only.
  const missingFromDisk = listedShippable.filter((p) => {
    if (diskSet.has(p)) return false;
    if (p.startsWith(`${ownFolder}/`)) return true;
    try {
      statSync(join(root, p));
      return false;
    } catch {
      return true;
    }
  });

  const badTargets = item.files
    .filter((f) => isShippable(f.path))
    .map((f) => ({ path: f.path, target: f.target, expected: deriveTarget(f.path) }))
    .filter((f) => f.target !== f.expected);

  const ok =
    missingFromRegistry.length === 0 &&
    missingFromDisk.length === 0 &&
    listedTestFiles.length === 0 &&
    badTargets.length === 0;
  if (!ok) hasDrift = true;

  summary.push({
    name: item.name,
    folder: ownFolder,
    ok,
    testFilesListed: listedTestFiles,
    missingFromRegistry,
    missingFromDisk,
    badTargets,
  });
}

for (const s of summary) {
  const status = s.ok ? "OK" : "DRIFT";
  console.log(`\n[${status}] ${s.name} (${s.folder})`);
  if (s.testFilesListed.length) {
    console.log(`  test files listed in registry.json (must be removed):`);
    for (const p of s.testFilesListed) console.log(`    - ${p}`);
  }
  if (s.missingFromRegistry.length) {
    console.log(`  on disk but missing from registry.json:`);
    for (const p of s.missingFromRegistry) console.log(`    + ${p}`);
  }
  if (s.missingFromDisk.length) {
    console.log(`  listed in registry.json but missing on disk:`);
    for (const p of s.missingFromDisk) console.log(`    - ${p}`);
  }
  if (s.badTargets.length) {
    console.log(`  missing/incorrect target (run node scripts/add-registry-targets.mjs):`);
    for (const t of s.badTargets) console.log(`    - ${t.path} : got ${JSON.stringify(t.target)}, expected ${JSON.stringify(t.expected)}`);
  }
}

console.log(`\n${hasDrift ? "DRIFT FOUND" : "All items match the filesystem."}`);
process.exit(hasDrift ? 1 : 0);
