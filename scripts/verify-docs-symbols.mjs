// Fails when docs prose names a gridcn symbol that the registry source no longer contains,
// or when an <AutoTypeTable> points at a missing file or type.
// Usage: node scripts/verify-docs-symbols.mjs [--root <dir>]
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { capped, lineOf, readLf, rel, splitFrontmatter, walk } from "./docs-verify-lib.mjs";
import { isTestFile } from "./_lib.mjs";

const SYMBOL = /^(useDataGrid\w*|useDebounce\w*|DataGrid\w*|isComposingKey|on[A-Z]\w+|\w+(?:Options|Props|Ctx|Labels))(?:\(\)|<.*>)?$/;

export function knownWords(root) {
  const words = new Set();
  for (const dir of ["registry/default", "components"]) {
    for (const file of walk(join(root, dir), [".ts", ".tsx"])) {
      if (isTestFile(basename(file))) continue;
      for (const m of readLf(file).matchAll(/[A-Za-z_$][\w$]*/g)) words.add(m[0]);
    }
  }
  return words;
}

export function run({ root = process.cwd() } = {}) {
  const words = knownWords(root);
  const allow = new Set(existsSync(join(root, "scripts/docs-symbols-allow.txt")) ? readLf(join(root, "scripts/docs-symbols-allow.txt")).split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean) : []);
  const failures = [];
  let checked = 0;
  for (const file of walk(join(root, "content/docs"), [".mdx"])) {
    const { body, bodyOffset } = splitFrontmatter(readLf(file));
    const where = (index) => `${rel(root, file)}:${lineOf(body, index) + bodyOffset}`;
    for (const m of body.matchAll(/<AutoTypeTable\s+path="([^"]+)"\s+name="([^"]+)"/g)) {
      checked++;
      const path = join(root, m[1]);
      if (!existsSync(path)) failures.push(`${where(m.index)}: AutoTypeTable path ${m[1]} does not exist`);
      else if (!new RegExp(String.raw`\b(?:interface|type|class)\s+${m[2]}\b`).test(readLf(path))) failures.push(`${where(m.index)}: AutoTypeTable name ${m[2]} is not defined in ${m[1]}`);
    }
    const prose = body.replace(/^(`{3,})[\s\S]*?^\1\s*$/gm, (block) => block.replace(/[^\n]/g, " "));
    for (const m of prose.matchAll(/`([^`\n]+)`/g)) {
      const name = m[1].trim();
      if (!SYMBOL.test(name)) continue;
      checked++;
      const bare = name.replace(/\(\)$|<.*>$/, "");
      if (!words.has(bare) && !allow.has(bare)) failures.push(`${where(m.index)}: \`${bare}\` is not in the registry source`);
    }
  }
  return { name: "symbols", checked, failures, warnings: [] };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = run({ root: process.argv.includes("--root") ? process.argv[process.argv.indexOf("--root") + 1] : process.cwd() });
  if (result.failures.length) {
    console.error(`docs symbols: ${result.failures.length} unknown of ${result.checked} checked\n${capped(result.failures).map((f) => `  ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`docs symbols: ${result.checked} checked, all known`);
}
