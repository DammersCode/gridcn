#!/usr/bin/env node
// `shadcn build` inlines source verbatim, including internal dev-alias imports of the form
// `@/registry/default/blocks/<item>/<rest>` that registry items use to reach each other. That
// path resolves fine in this monorepo (tsconfig maps `@/*` -> `./*`) but the shadcn CLI's import
// rewriter has no rule for arbitrary `@/registry/<style>/blocks/...` paths, so it falls back to
// `t.aliases.components + rest-after-style`, producing `@/components/blocks/<item>/<rest>` — a
// path that doesn't exist for the consumer (every item's files are flattened straight into the
// components alias dir with no `blocks/<item>` subfolder). The CLI *does* special-case any
// `@/registry/<style>/components/...` path, rewriting it to exactly `t.aliases.components + rest`
// (see `wa()` in shadcn/dist/chunk-*.js). So post-build, rewrite every such alias to the
// equivalent `.../components/...` form — this is the exact inverse of deriveTarget() in
// scripts/add-registry-targets.mjs (`registry/default/blocks/<item>/<rest>` -> `components/<item>/<rest>`),
// so it lands on the correct flattened path for every item, not just the core.
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "public", "r");

// `shadcn build` writes only the item payloads; the catalog at /r/registry.json (used by the
// CLI's list/search and namespace discovery) must be synced by hand — do it here so it can't drift.
copyFileSync(join(root, "registry.json"), join(outDir, "registry.json"));
console.log("  synced registry.json -> public/r/registry.json");

const BLOCKS_ALIAS_RE = /@\/registry\/default\/blocks\/([^/"'\s]+)\/([^"'\s]+)/g;
const toComponentsAlias = (_match, item, rest) => `@/registry/default/components/${item}/${rest}`;

let filesChanged = 0;
let occurrences = 0;

for (const name of readdirSync(outDir)) {
  if (!name.endsWith(".json") || name === "registry.json") continue;
  const path = join(outDir, name);
  const raw = readFileSync(path, "utf8");
  if (!BLOCKS_ALIAS_RE.test(raw)) continue;

  const json = JSON.parse(raw);
  let changedInFile = 0;
  for (const file of json.files ?? []) {
    if (typeof file.content !== "string") continue;
    const matches = file.content.match(BLOCKS_ALIAS_RE);
    if (!matches) continue;
    file.content = file.content.replace(BLOCKS_ALIAS_RE, toComponentsAlias);
    changedInFile += matches.length;
  }

  if (changedInFile > 0) {
    writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`, "utf8");
    filesChanged += 1;
    occurrences += changedInFile;
    console.log(`  fixed ${changedInFile} import(s) in public/r/${name}`);
  }
}

console.log(
  filesChanged > 0
    ? `\nRewrote ${occurrences} cross-item import(s) across ${filesChanged} registry file(s).`
    : "\nNo broken cross-item imports found — nothing to rewrite.",
);

// Fail-loud payload gate: no `@/registry/default/blocks/` alias may survive the rewrite above —
// one that does is a payload the shadcn CLI cannot install (see header comment). Scan fresh from
// disk (not the in-memory `json` vars) so this also catches any payload the rewrite loop skipped.
const offenders = [];
for (const name of readdirSync(outDir)) {
  if (!name.endsWith(".json") || name === "registry.json") continue;
  const path = join(outDir, name);
  const raw = readFileSync(path, "utf8");
  if (!raw.includes("@/registry/default/blocks/")) continue;

  const json = JSON.parse(raw);
  for (const file of json.files ?? []) {
    if (typeof file.content !== "string") continue;
    const matches = file.content.match(/@\/registry\/default\/blocks\/[^"'\s]+/g);
    if (matches) for (const m of matches) offenders.push(`  public/r/${name} :: ${file.path} :: ${m}`);
  }
}

if (offenders.length > 0) {
  console.error(
    `\nPAYLOAD GATE FAILED: ${offenders.length} unresolvable @/registry/default/blocks/ alias(es) survived the rewrite:\n${offenders.join("\n")}\n\nThese payloads cannot be installed by the shadcn CLI (see header comment in this script). Fix the source import to go through the target item's barrel, or extend the rewrite regex if this is a new alias shape.`,
  );
  process.exit(1);
}

console.log("Payload gate: no unresolvable @/registry/default/blocks/ aliases remain.");
