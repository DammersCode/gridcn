#!/usr/bin/env node
// The shadcn CLI flattens every registry:component/registry:block file into the consumer's
// components/ alias dir UNLESS an explicit files[].target says otherwise (proven empirically
// against shadcn 4.16.1: Qt()/getResolvedFilePath honors `target` verbatim, joining it under
// `src/` when the consumer has a src/ dir, under cwd otherwise — no `~/` or alias placeholder
// needed). Our repo nests each item's source under registry/default/blocks/<item>/ (domain
// subfolders incl. 10 colliding index.ts names) — without a target, the CLI drops that nesting
// and the index.ts files overwrite each other. This script derives+writes the correct target
// for every files[] entry so `node scripts/verify-registry.mjs` can assert it never drifts.
//
// Derivation rule (mechanical, no hand-editing):
//   registry/default/blocks/<item>/<rest>   -> components/<item>/<rest>   (preserve nesting)
//   registry/default/examples/<rest>        -> components/<rest>          (flat, matches
//                                              shadcn's own registry:example convention;
//                                              examples have no domain subfolders and any
//                                              shared file like demo-data.ts is byte-identical
//                                              across items, so flattening is safe)
//   anything else (already consumer-relative, e.g. components/ui/kbd.tsx) -> unchanged
//
// Rewrites only the `files[]` entry lines, in place, to avoid reformatting the rest of the
// hand-maintained registry.json (JSON.stringify would blow up every compact one-line array).
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const registryPath = join(root, "registry.json");

const BLOCKS_RE = /^registry\/default\/blocks\/([^/]+)\/(.+)$/;
const EXAMPLES_RE = /^registry\/default\/examples\/(.+)$/;

export function deriveTarget(path) {
  const blocksMatch = path.match(BLOCKS_RE);
  if (blocksMatch) {
    const [, item, rest] = blocksMatch;
    return `components/${item}/${rest}`;
  }
  const examplesMatch = path.match(EXAMPLES_RE);
  if (examplesMatch) {
    const [, rest] = examplesMatch;
    return `components/${rest}`;
  }
  return path;
}

// Matches a single-line file entry like: { "path": "...", "type": "...", "target": "..." },
const FILE_ENTRY_RE = /^(\s*)\{ (.*) \}(,?)\s*$/;

export function rewriteFileEntries(raw) {
  let changed = 0;
  const lines = raw.split("\n").map((line) => {
    const m = line.match(FILE_ENTRY_RE);
    if (!m) return line;
    const [, indent, body, trailingComma] = m;
    let entry;
    try {
      entry = JSON.parse(`{ ${body} }`);
    } catch {
      return line;
    }
    if (typeof entry.path !== "string" || typeof entry.type !== "string") return line;

    const target = deriveTarget(entry.path);
    if (entry.target !== target) changed += 1;

    const ordered = { path: entry.path, type: entry.type, target };
    const serialized = Object.entries(ordered)
      .map(([key, value]) => `"${key}": ${JSON.stringify(value)}`)
      .join(", ");
    return `${indent}{ ${serialized} }${trailingComma}`;
  });
  return { text: lines.join("\n"), changed };
}

if (isMain) {
  const raw = readFileSync(registryPath, "utf8");
  const { text, changed } = rewriteFileEntries(raw);
  if (changed > 0) writeFileSync(registryPath, text, "utf8");
  console.log(
    changed > 0
      ? `Set/updated target on ${changed} file entr${changed === 1 ? "y" : "ies"} in registry.json.`
      : "All file entries already carry the correct derived target.",
  );
}
