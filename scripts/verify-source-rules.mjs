#!/usr/bin/env node
// Fails on source patterns that shipped bugs before. Fix: follow the message.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const problems = [];

function* walk(dir, pattern) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, pattern);
    else if (pattern.test(entry.name) && !/\.(?:test|type-test)\.tsx?$/.test(entry.name)) yield full;
  }
}

function scan(dirs, filePattern, linePattern, message, skip = () => false) {
  for (const dir of dirs) {
    for (const file of walk(join(root, dir), filePattern)) {
      if (skip(file)) continue;
      readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
        if (linePattern.test(line)) problems.push(`${relative(root, file)}:${i + 1} — ${message}`);
      });
    }
  }
}

scan(["registry/default/blocks"], /\.tsx?$/, /process\.env\.NODE_ENV/, "read the environment through isDev", (file) => basename(file) === "is-dev.ts");
scan(["registry/default/blocks"], /\.tsx?$/, /\.isComposing\b/, "read IME state through isComposingKey, which also covers the Safari keyCode 229 confirm key", (file) => basename(file) === "is-composing-key.ts");
scan(["registry/default/blocks"], /\.tsx?$/, /Math\.(?:min|max)\(\.\.\./, "reduce or loop instead of spreading into Math.min or Math.max; a large array throws RangeError");
scan(["content/docs"], /\.mdx$/, /^#+ .*<NewBadge/, "put <NewBadge /> on its own line under the heading");
scan(["registry/default/examples", "components", "app"], /\.tsx?$/, /toLocale(?:Date|Time)?String\(\)|Intl\.(?:NumberFormat|DateTimeFormat)\((?:undefined)?\)/, "pin the locale so server and client render the same text");

const examplesMap = readFileSync(join(root, "components", "registry-examples.tsx"), "utf8");
for (const file of walk(join(root, "registry", "default", "examples"), /-demo\.tsx$/)) {
  const name = basename(file, ".tsx");
  if (!examplesMap.includes(`"${name}":`)) problems.push(`components/registry-examples.tsx — register ${name} in the examples map`);
}

if (problems.length > 0) {
  console.error(`verify-source-rules: ${problems.length} problem(s)\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("verify-source-rules: ok");
