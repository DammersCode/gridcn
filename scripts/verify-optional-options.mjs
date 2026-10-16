#!/usr/bin/env node
// Fails when an exported function takes a required `options`/`opts` parameter whose type, declared in the same file, has only optional fields.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isTestFile } from "./_lib.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const BLOCKS_ROOT = join(root, "registry", "default", "blocks");
const EXPORTED_FN = /export (?:async )?function \w+(?:<[^(]*?>)?\(([^)]*)\)/g;
const OPTIONS_PARAM = /(?:^|,)\s*(?:options|opts)\s*:\s*(\w+)(?:<[^>]*>)?\s*(?=,|$)/;

/** True when the object type `name` is declared in `source` and none of its top-level fields is required. */
function hasOnlyOptionalFields(source, name) {
  const start = source.search(new RegExp(String.raw`export type ${name}(?:<[^=]*>)?\s*=\s*\{`));
  if (start === -1) return false;
  let depth = 0;
  let body = "";
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    if (ch === "}" && --depth === 0) break;
    if (depth === 1) body += ch;
  }
  const fields = body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .split(/[;\n]/)
    .map((line) => line.trim())
    .filter(Boolean);
  return fields.length > 0 && !fields.some((line) => /^\w+\s*:/.test(line));
}

const violations = [];
for (const entry of readdirSync(BLOCKS_ROOT, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name) || isTestFile(entry.name)) continue;
  const file = join(entry.parentPath, entry.name);
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(EXPORTED_FN)) {
    const param = OPTIONS_PARAM.exec(match[1]);
    if (param && hasOnlyOptionalFields(source, param[1])) {
      violations.push(`${relative(root, file).split("\\").join("/")}: ${param[0].replace(/^,/, "").trim()} has only optional fields; default it with \`= {}\``);
    }
  }
}

if (violations.length > 0) {
  console.error(`All-optional options parameters must default to {}:\n${violations.map((v) => `  ${v}`).join("\n")}`);
  process.exit(1);
}
console.log("verify-optional-options: ok");
