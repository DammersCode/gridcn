#!/usr/bin/env node
// Fails on React Compiler CompileErrors under registry/ that the per-function baseline does not allow, and on stale entries.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as babel from "@babel/core";
import reactCompiler from "babel-plugin-react-compiler";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const registryDir = join(root, "registry");
const baselinePath = join(root, "scripts", "compiler-bailouts.baseline.json");
const update = process.argv.includes("--update");
const parserOpts = { plugins: ["typescript", "jsx"] };
const testFile = /\.(test|browser\.test|test-helper|type-test)\.tsx?$|\.d\.ts$/;

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else if (/\.tsx?$/.test(name) && !testFile.test(name)) out.push(full);
  }
  return out;
}

function functionName(path) {
  if (path.node.id) return path.node.id.name;
  let current = path.parentPath;
  while (current) {
    const { node } = current;
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier") return node.id.name;
    if ((node.type === "ObjectProperty" || node.type === "ObjectMethod") && node.key.type === "Identifier") return node.key.name;
    if (node.type === "ExportDefaultDeclaration") return "default";
    if (node.type !== "CallExpression" && node.type !== "TSAsExpression" && node.type !== "TSSatisfiesExpression") break;
    current = current.parentPath;
  }
  return `<anonymous:${path.node.loc.start.line}>`;
}

function namesAt(source, rel, locs) {
  const ast = babel.parseSync(source, { filename: rel, babelrc: false, configFile: false, sourceType: "module", parserOpts });
  const names = [];
  babel.traverse(ast, {
    Function(path) {
      const start = path.node.loc?.start;
      if (start && locs.has(`${start.line}:${start.column}`)) names.push(functionName(path));
    },
  });
  return names;
}

function compileErrors(source, rel) {
  const locs = new Set();
  let fileLevel = false;
  const logger = {
    logEvent(_filename, event) {
      if (event.kind !== "CompileError" && event.kind !== "PipelineError") return;
      if (event.fnLoc) locs.add(`${event.fnLoc.start.line}:${event.fnLoc.start.column}`);
      else fileLevel = true;
    },
  };
  try {
    babel.transformSync(source, {
      filename: rel,
      babelrc: false,
      configFile: false,
      sourceType: "module",
      parserOpts,
      plugins: [[reactCompiler, { target: "19", panicThreshold: "none", logger }]],
    });
  } catch {
    fileLevel = true;
  }
  const names = namesAt(source, rel, locs);
  if (fileLevel) names.push("<file>");
  return names.sort();
}

function diff(expected, actual) {
  const remaining = [...actual];
  const missing = [];
  for (const name of expected) {
    const index = remaining.indexOf(name);
    if (index === -1) missing.push(name);
    else remaining.splice(index, 1);
  }
  return { missing, extra: remaining };
}

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : {};
const next = {};
const problems = [];
const files = listFiles(registryDir);

for (const file of files) {
  const rel = relative(root, file).split(sep).join("/");
  const errors = compileErrors(readFileSync(file, "utf8"), rel);
  if (errors.length > 0) next[rel] = errors;
  const { missing, extra } = diff(baseline[rel] ?? [], errors);
  for (const name of extra) problems.push(`${rel}: ${name} — new compiler bail-out (CompileError)`);
  for (const name of missing) problems.push(`${rel}: ${name} — compiles now; remove it from the baseline`);
}
for (const rel of Object.keys(baseline)) {
  if (!files.some((file) => relative(root, file).split(sep).join("/") === rel)) {
    problems.push(`${rel} — file is gone; remove it from the baseline`);
  }
}

if (update) {
  writeFileSync(baselinePath, JSON.stringify(next, null, 2) + "\n", "utf8");
  console.log(`Baseline updated: ${Object.keys(next).length} files with allowed bail-outs.`);
  process.exit(0);
}

if (problems.length) {
  console.error(`Compiler bail-out drift (${problems.length}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("\nFix the new bail-out, or after pnpm test:compiler refresh with: node scripts/check-compiler-bailouts.mjs --update");
  process.exit(1);
}

console.log(`Compiler bail-outs match the baseline: ${files.length} files checked.`);
