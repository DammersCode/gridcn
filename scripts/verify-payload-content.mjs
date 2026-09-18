#!/usr/bin/env node
// Asserts every `public/r/<item>.json` file entry's `content` still equals its source file on disk,
// after applying the same alias rewrite `fix-registry-imports.mjs` performs. verify-registry.mjs
// only checks the MANIFEST (which paths are listed, and their targets) — it never opens the built
// payloads, so a source edit without a rebuild ships stale code to consumers silently.
// Fix drift with: npx shadcn build && node scripts/fix-registry-imports.mjs
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "public", "r");

// kept in sync with fix-registry-imports.mjs — the payload stores the rewritten form, not raw source
const BLOCKS_ALIAS_RE = /@\/registry\/default\/blocks\/([^/"'\s]+)\/([^"'\s]+)/g;
const toComponentsAlias = (_match, item, rest) => `@/registry/default/components/${item}/${rest}`;

const problems = [];
let filesChecked = 0;
let itemsChecked = 0;

for (const name of readdirSync(outDir)) {
  if (!name.endsWith(".json") || name === "registry.json") continue;
  const payload = JSON.parse(readFileSync(join(outDir, name), "utf8"));
  itemsChecked += 1;

  for (const file of payload.files ?? []) {
    if (typeof file.content !== "string" || typeof file.path !== "string") continue;
    const sourcePath = join(root, file.path);

    if (!existsSync(sourcePath)) {
      problems.push(`${name}: ${file.path} — listed in the payload but missing on disk`);
      continue;
    }

    const expected = readFileSync(sourcePath, "utf8").replace(BLOCKS_ALIAS_RE, toComponentsAlias);
    filesChecked += 1;
    // `shadcn build` normalizes CRLF to LF; compare on LF so a checkout setting is not a false positive.
    if (expected.replace(/\r\n/g, "\n") !== file.content.replace(/\r\n/g, "\n")) {
      problems.push(`${name}: ${file.path} — payload content differs from source`);
    }
  }
}

if (problems.length) {
  console.error(`Payload content drift (${problems.length}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("\nRebuild: npx shadcn build && node scripts/fix-registry-imports.mjs");
  process.exit(1);
}

console.log(`Payload content matches source: ${filesChecked} files across ${itemsChecked} items.`);
