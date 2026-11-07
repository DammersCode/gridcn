// Fails when docs prose names a gridcn symbol that the registry source no longer contains,
// names or imports a symbol that no public module exports, or when an <AutoTypeTable> points at a missing file or type.
// Usage: node scripts/verify-docs-symbols.mjs [--root <dir>]
import { existsSync, readdirSync } from "node:fs";
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

const DECLARED = /^export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;

export function exportedNames(source) {
  const names = new Set();
  for (const m of source.matchAll(DECLARED)) names.add(m[1]);
  for (const m of source.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const item = part.trim().replace(/^type\s+/, "");
      if (item) names.add(item.split(/\s+as\s+/).pop().trim());
    }
  }
  return names;
}

/** Import path -> exported names, for each module a consumer imports: a block barrel, the SDK, a single-file item. */
export function publicModules(root) {
  const modules = new Map();
  const add = (specifier, file) => {
    if (existsSync(file)) modules.set(specifier, exportedNames(readLf(file)));
  };
  const blocks = join(root, "registry/default/blocks");
  for (const dir of existsSync(blocks) ? readdirSync(blocks, { withFileTypes: true }) : []) {
    if (!dir.isDirectory()) continue;
    for (const ext of [".ts", ".tsx"]) add(`@/components/${dir.name}/${dir.name}`, join(blocks, dir.name, dir.name + ext));
  }
  add("@/components/data-grid/data-grid-sdk", join(blocks, "data-grid/data-grid-sdk.ts"));
  for (const dir of ["hooks", "lib"]) {
    for (const file of walk(join(root, "registry/default", dir), [".ts", ".tsx"])) {
      if (!isTestFile(basename(file))) add(`@/components/gridcn/${basename(file).replace(/\.tsx?$/, "")}`, file);
    }
  }
  return modules;
}

/** Names that a registry module exports but no public module does. */
export function internalNames(root, modules) {
  const exported = new Set([...modules.values()].flatMap((names) => [...names]));
  const internal = new Set();
  for (const dir of ["blocks", "hooks", "lib"]) {
    for (const file of walk(join(root, "registry/default", dir), [".ts", ".tsx"])) {
      if (isTestFile(basename(file))) continue;
      for (const name of exportedNames(readLf(file))) if (!exported.has(name)) internal.add(name);
    }
  }
  return internal;
}

export function run({ root = process.cwd() } = {}) {
  const words = knownWords(root);
  const modules = publicModules(root);
  const internal = internalNames(root, modules);
  const allowFile = join(root, "scripts/docs-symbols-allow.txt");
  const allowLines = existsSync(allowFile) ? readLf(allowFile).split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean) : [];
  const globalAllow = new Set(allowLines.filter((l) => !l.includes(":")).flatMap((l) => l.split(/\s+/)));
  const pageAllow = new Map(allowLines.filter((l) => l.includes(":")).map((l) => [l.slice(0, l.indexOf(":")).trim(), new Set(l.slice(l.indexOf(":") + 1).trim().split(/\s+/))]));
  const failures = [];
  let checked = 0;
  for (const file of walk(join(root, "content/docs"), [".mdx"])) {
    const allow = { has: (name) => globalAllow.has(name) || (pageAllow.get(basename(file))?.has(name) ?? false) };
    const { body, bodyOffset } = splitFrontmatter(readLf(file));
    const where = (index) => `${rel(root, file)}:${lineOf(body, index) + bodyOffset}`;
    for (const m of body.matchAll(/<AutoTypeTable\s+path="([^"]+)"\s+name="([^"]+)"/g)) {
      checked++;
      const path = join(root, m[1]);
      if (!existsSync(path)) failures.push(`${where(m.index)}: AutoTypeTable path ${m[1]} does not exist`);
      else if (!new RegExp(String.raw`\b(?:interface|type|class)\s+${m[2]}\b`).test(readLf(path))) failures.push(`${where(m.index)}: AutoTypeTable name ${m[2]} is not defined in ${m[1]}`);
    }
    for (const m of body.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"(@\/components\/[^"]+)"/g)) {
      if (m[2].startsWith("@/components/ui/")) continue;
      checked++;
      const names = modules.get(m[2]);
      if (!names) {
        failures.push(`${where(m.index)}: ${m[2]} is not a public module`);
        continue;
      }
      for (const part of m[1].split(",")) {
        const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
        if (name && !names.has(name)) failures.push(`${where(m.index)}: ${m[2]} does not export \`${name}\``);
      }
    }
    const prose = body.replace(/^(`{3,})[\s\S]*?^\1\s*$/gm, (block) => block.replace(/[^\n]/g, " "));
    for (const m of prose.matchAll(/`([^`\n]+)`/g)) {
      const name = m[1].trim();
      const bare = name.replace(/\(.*\)$|<.*>$/, "");
      if (internal.has(bare) && !allow.has(bare)) {
        checked++;
        failures.push(`${where(m.index)}: \`${bare}\` is not exported from a public module`);
        continue;
      }
      if (!SYMBOL.test(name)) continue;
      checked++;
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
