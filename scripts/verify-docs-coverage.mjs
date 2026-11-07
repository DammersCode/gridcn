// Lists public exports and public option or prop names that no docs page mentions.
// Usage: node scripts/verify-docs-coverage.mjs [--root <dir>] [--all]
// Exports come from the barrel of each registry block (registry/default/blocks/<dir>/<dir>.ts[x]) and from the hook and lib items.
// Members come from every exported type or interface named *Options, *Props, or *Result in those barrels' source files.
// A name mentioned in no page, and not listed with a reason in scripts/docs-undocumented.txt, is a gap.
import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { isTestFile } from "./_lib.mjs";
import { capped, readLf, walk } from "./docs-verify-lib.mjs";
import { parseTypes } from "./verify-docs-props.mjs";

const readList = (file) => (existsSync(file) ? readLf(file).split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean) : []);

function barrelFiles(root) {
  const files = [];
  const blocks = join(root, "registry/default/blocks");
  for (const dir of readdirSync(blocks, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const ext of [".ts", ".tsx"]) {
      const file = join(blocks, dir.name, `${dir.name}${ext}`);
      if (existsSync(file)) files.push(file);
    }
  }
  for (const dir of ["hooks", "lib"]) files.push(...walk(join(root, "registry/default", dir), [".ts", ".tsx"]).filter((f) => !isTestFile(basename(f)) && !f.endsWith(".type-test.ts")));
  return files;
}

/** Names a barrel exports, including `export { a, type B } from` lists and direct declarations. */
export function barrelExports(text) {
  const names = new Set();
  for (const m of text.matchAll(/^export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|function\*?|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).at(-1);
      if (name) names.add(name);
    }
  }
  return names;
}

export function run({ root = process.cwd() } = {}) {
  const docs = walk(join(root, "content/docs"), [".mdx"]).map(readLf).join("\n");
  const allowed = new Set(readList(join(root, "scripts/docs-undocumented.txt")));
  const mentions = (name) => new RegExp(`(?<![\\w$])${name.replace(/[$]/g, "\\$")}(?![\\w$])`).test(docs);
  const codeMention = (name) => new RegExp("`" + name.replace(/[$]/g, "\\$") + "[`?(<:=\\s]").test(docs) || new RegExp(`\\b${name.replace(/[$]/g, "\\$")}=\\{`).test(docs);
  const missingExports = [];
  const missingMembers = [];
  let exportsChecked = 0;
  let membersChecked = 0;
  for (const file of barrelFiles(root)) {
    const text = readLf(file);
    const exported = barrelExports(text);
    const where = file.replaceAll("\\", "/").replace(`${root.replaceAll("\\", "/")}/`, "");
    for (const name of exported) {
      if (name.length < 4) continue;
      exportsChecked++;
      if (!allowed.has(name) && !mentions(name)) missingExports.push(`${where}: export ${name} is in no docs page`);
    }
    const sources = new Set([file, ...[...text.matchAll(/from\s+["'](\.[^"']+)["']/g)].map((m) => join(dirname(file), m[1]))]);
    for (const source of sources) {
      const path = [source, `${source}.ts`, `${source}.tsx`].find((p) => existsSync(p) && !p.endsWith("/") && /\.(ts|tsx)$/.test(p));
      if (!path) continue;
      for (const def of parseTypes(readLf(path))) {
        if (!exported.has(def.name) || !/(Options|Props|Result)$/.test(def.name)) continue;
        for (const member of def.members.keys()) {
          membersChecked++;
          const key = `${def.name}.${member}`;
          if (!allowed.has(key) && !allowed.has(member) && !codeMention(member)) missingMembers.push(`${where}: ${key} is in no docs page`);
        }
      }
    }
  }
  const staleEntries = [...allowed].filter((name) => !name.includes(".") && mentions(name)).map((name) => `scripts/docs-undocumented.txt: ${name} is mentioned in the docs; remove the entry`);
  return { name: "coverage", checked: exportsChecked + membersChecked, failures: [...missingExports, ...missingMembers, ...staleEntries], warnings: [], stats: { exportsChecked, membersChecked, missingExports: missingExports.length, missingMembers: missingMembers.length } };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = run({ root: process.argv.includes("--root") ? process.argv[process.argv.indexOf("--root") + 1] : process.cwd() });
  const s = result.stats;
  const cap = process.argv.includes("--all") ? Infinity : 10;
  if (result.failures.length) {
    console.error(`docs coverage: ${s.missingExports} of ${s.exportsChecked} exports and ${s.missingMembers} of ${s.membersChecked} option names are in no page\n${capped(result.failures, cap).map((f) => `  ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`docs coverage: ${s.exportsChecked} exports and ${s.membersChecked} option names, all documented`);
}
