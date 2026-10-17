#!/usr/bin/env node
// Fails when shipped registry code names internal docs, plan ids, or other products. Fix: rewrite the comment as a plain why-comment.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const blocksDir = join(root, "registry", "default", "blocks");

const FORBIDDEN = [
  [/\b(?:research|docs|plans)\/[\w./-]+\.md\b/, "path to an internal document"],
  [/\b[\w-]+-(?:spec|study)\.md\b/, "internal document name"],
  [/design spec/i, "design spec reference"],
  [/§\s*\d/, "section reference"],
  [/\((?:W\d+-\d+|G\d+)\)|\b(?:R|NEW|PERF|BUG|SEC|ARCH|API)-\d+\b/, "plan or finding id"],
  [/\b(?:glide|datasheet-grid|tanstack|MUI|ag-grid|handsontable|adazzle|diceui)\b/i, "other product name"],
];

const problems = [];

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(?:tsx?|mdx?)$/.test(entry.name)) yield full;
  }
}

for (const file of walk(blocksDir)) {
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((line, i) => {
      for (const [pattern, label] of FORBIDDEN) {
        if (pattern.test(line)) problems.push(`${relative(root, file)}:${i + 1} — ${label}: ${line.trim()}`);
      }
    });
}

if (problems.length > 0) {
  console.error(`verify-no-internal-refs: ${problems.length} problem(s)\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("verify-no-internal-refs: ok");
