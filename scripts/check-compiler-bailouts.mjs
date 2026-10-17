#!/usr/bin/env node
// Fails on React Compiler bail-outs under registry/ whose function or category and reason the baseline does not allow, and on stale entries.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as babel from "@babel/core";
import reactCompiler from "babel-plugin-react-compiler";
import { isTestFile } from "./_lib.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const registryDir = join(root, "registry");
const baselinePath = join(root, "scripts", "compiler-bailouts.baseline.json");
const update = process.argv.includes("--update");
const parserOpts = { plugins: ["typescript", "jsx"] };

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    // .d.ts files are declarations, not source the compiler runs over.
    if (entry.isFile() && /\.tsx?$/.test(entry.name) && !isTestFile(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(join(entry.parentPath, entry.name));
    }
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
  const names = new Map();
  babel.traverse(ast, {
    Function(path) {
      const start = path.node.loc?.start;
      const key = start && `${start.line}:${start.column}`;
      if (key && locs.has(key)) names.set(key, functionName(path));
    },
  });
  return names;
}

function describe(event) {
  if (event.kind === "PipelineError") return `PipelineError: ${event.data}`;
  const detail = event.detail ?? {};
  const category = detail.category ?? detail.options?.category ?? "Unknown";
  const reason = detail.reason ?? detail.options?.reason ?? "";
  return `${category}: ${reason}`;
}

/** Bail-outs of one file as `{ functionName: [category: reason, ...] }`, reasons sorted and unique. */
function compileErrors(source, rel) {
  const byLoc = new Map();
  const fileLevel = new Set();
  const logger = {
    logEvent(_filename, event) {
      if (event.kind !== "CompileError" && event.kind !== "PipelineError") return;
      if (!event.fnLoc) {
        fileLevel.add(describe(event));
        return;
      }
      const key = `${event.fnLoc.start.line}:${event.fnLoc.start.column}`;
      if (!byLoc.has(key)) byLoc.set(key, new Set());
      byLoc.get(key).add(describe(event));
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
  } catch (error) {
    fileLevel.add(`Crash: ${error instanceof Error ? (error.message.split(/\r?\n/)[0] ?? "") : String(error)}`);
  }
  const names = namesAt(source, rel, new Set(byLoc.keys()));
  const result = {};
  for (const [key, reasons] of byLoc) {
    const name = names.get(key) ?? `<unknown:${key}>`;
    result[name] = [...new Set([...(result[name] ?? []), ...reasons])].sort();
  }
  if (fileLevel.size > 0) result["<file>"] = [...fileLevel].sort();
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : {};
const next = {};
const problems = [];
const files = listFiles(registryDir);
const relFiles = new Set(files.map((file) => relative(root, file).split(sep).join("/")));

for (const file of files) {
  const rel = relative(root, file).split(sep).join("/");
  const actual = compileErrors(readFileSync(file, "utf8"), rel);
  if (Object.keys(actual).length > 0) next[rel] = actual;
  const allowed = baseline[rel] ?? {};
  for (const [name, reasons] of Object.entries(actual)) {
    const allowedReasons = allowed[name];
    if (!allowedReasons) {
      problems.push(`${rel}: ${name} — new compiler bail-out (${reasons.join("; ")})`);
      continue;
    }
    for (const reason of reasons) if (!allowedReasons.includes(reason)) problems.push(`${rel}: ${name} — new bail-out reason (${reason})`);
    for (const reason of allowedReasons) if (!reasons.includes(reason)) problems.push(`${rel}: ${name} — reason gone; remove it from the baseline (${reason})`);
  }
  for (const name of Object.keys(allowed)) {
    if (!actual[name]) problems.push(`${rel}: ${name} — compiles now; remove it from the baseline`);
  }
}
for (const rel of Object.keys(baseline)) {
  if (!relFiles.has(rel)) problems.push(`${rel} — file is gone; remove it from the baseline`);
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
