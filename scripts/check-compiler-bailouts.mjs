#!/usr/bin/env node
// Runs the React Compiler (Babel 7.29, pinned) over every source file under registry/ and
// compares the set of top-level functions it compiles against a baseline. The compiler fails
// silently — a function it cannot compile is left untransformed without an error — so a new
// bailout (or CompileError) ships untested code to the test:compiler mirror. Any drift fails:
// a function that stopped compiling is a regression; one that newly compiles changes shipped
// behavior and must be verified with `pnpm test:compiler` before `--update` refreshes the baseline.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as babel from "@babel/core";
import { reactCompilerPreset } from "@vitejs/plugin-react";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const registryDir = join(root, "registry");
const baselinePath = join(dirname(fileURLToPath(import.meta.url)), "compiler-bailouts.baseline.json");
const update = process.argv.includes("--update");
const preset = reactCompilerPreset({ target: "19" }).preset;

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listFiles(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function topLevelNodes(ast) {
  // export wrappers hold the declaration they export; a default export may wrap a function too
  const out = [];
  for (const node of ast.program.body) {
    // a re-export (`export { x } from ...`) carries no declaration
    if ((node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration") && node.declaration) {
      out.push(node.declaration);
    } else {
      out.push(node);
    }
  }
  return out;
}

function topLevelFunctionNames(code) {
  const ast = babel.parseSync(code, {
    filename: "source.tsx",
    babelrc: false,
    configFile: false,
    sourceType: "module",
    parserOpts: { plugins: ["typescript", "jsx"] },
  });
  const names = new Set();
  for (const node of topLevelNodes(ast)) {
    if (node.type === "FunctionDeclaration" && node.id) names.add(node.id.name);
    if (node.type === "VariableDeclaration") {
      for (const decl of node.declarations) {
        if (
          decl.id.type === "Identifier" &&
          (decl.init?.type === "FunctionExpression" || decl.init?.type === "ArrowFunctionExpression")
        ) {
          names.add(decl.id.name);
        }
      }
    }
  }
  return names;
}

function compiledFunctionNames(code, names) {
  const ast = babel.parseSync(code, {
    filename: "output.tsx",
    babelrc: false,
    configFile: false,
    sourceType: "module",
    parserOpts: { plugins: ["typescript", "jsx"] },
  });
  const compiled = new Set();
  const check = (name, body) => {
    if (!names.has(name)) return;
    if (code.slice(body.start, body.end).includes("_c(")) compiled.add(name);
  };
  for (const node of topLevelNodes(ast)) {
    if (node.type === "FunctionDeclaration" && node.id) check(node.id.name, node.body);
    if (node.type === "VariableDeclaration") {
      for (const decl of node.declarations) {
        if (
          decl.id.type === "Identifier" &&
          (decl.init?.type === "FunctionExpression" || decl.init?.type === "ArrowFunctionExpression")
        ) {
          check(decl.id.name, decl.init.body);
        }
      }
    }
  }
  return compiled;
}

const files = listFiles(registryDir);
const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : {};
const problems = [];
let filesChecked = 0;

for (const file of files) {
  const rel = relative(root, file).split(sep).join("/");
  const source = readFileSync(file, "utf8");
  const names = topLevelFunctionNames(source);
  if (names.size === 0) continue;
  filesChecked += 1;
  const before = new Set(baseline[rel] ?? []);
  const after = compiledFunctionNames(
    babel.transformSync(source, {
      filename: rel,
      babelrc: false,
      configFile: false,
      sourceType: "module",
      parserOpts: { plugins: ["typescript", "jsx"] },
      presets: [preset],
    }).code,
    names,
  );

  if (update) {
    const sorted = [...after].sort();
    if (sorted.length > 0) baseline[rel] = sorted;
    else delete baseline[rel];
    continue;
  }

  for (const name of before) {
    if (!after.has(name)) problems.push(`${rel}: ${name} — compiled before, bails out now (new CompileError)`);
  }
  for (const name of after) {
    if (!before.has(name)) problems.push(`${rel}: ${name} — newly compiled (verify with pnpm test:compiler, then --update)`);
  }
}

if (update) {
  const keys = Object.keys(baseline).sort();
  const normalized = {};
  for (const key of keys) normalized[key] = baseline[key];
  writeFileSync(baselinePath, JSON.stringify(normalized, null, 2) + "\n", "utf8");
  console.log(`Baseline updated: ${Object.keys(normalized).length} files.`);
  process.exit(0);
}

if (problems.length) {
  console.error(`Compiler bail-out drift (${problems.length}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("\nRun pnpm test:compiler; refresh with: node scripts/check-compiler-bailouts.mjs --update");
  process.exit(1);
}

console.log(`Compiler bail-outs match the baseline: ${filesChecked} files.`);
