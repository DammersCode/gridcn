// Fails on a runtime import cycle among the registry block sources (type-only imports are ignored).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isTestFile } from "./_lib.mjs";

const RUNTIME_IMPORT = /^(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']((?:\.|@\/registry\/)[^"']+)["']/gms;

function resolveSpecifier(root, from, spec) {
  const base = spec.startsWith("@/") ? resolve(root, spec.slice(2)) : resolve(dirname(from), spec);
  return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`, base].find((f) => /\.tsx?$/.test(f) && existsSync(f));
}

// shortcut: a regex literal that holds a quote or a comment opener can still confuse it; parse with a real tokenizer if one ever does.
const STRING_OR_COMMENT = /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

/** Removes comments and keeps string and template literals, so a `/*` or `//` inside a string hides no code. */
export function stripComments(text) {
  return text.replace(STRING_OR_COMMENT, (match, literal) => literal ?? "");
}

export function runtimeImports(root, file) {
  const text = stripComments(readFileSync(file, "utf8"));
  const targets = [];
  for (const [statement, spec] of [...text.matchAll(RUNTIME_IMPORT)].map((m) => [m[0], m[1]])) {
    const names = statement.match(/\{([^}]*)\}/)?.[1];
    if (names && /^(?:import|export)\s*\{/.test(statement) && names.split(",").map((n) => n.trim()).filter(Boolean).every((n) => n.startsWith("type "))) continue;
    const target = resolveSpecifier(root, file, spec);
    if (target) targets.push(target);
  }
  return targets;
}

function* sources(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* entry.name === "node_modules" ? [] : sources(path);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") && !isTestFile(entry.name)) yield path;
  }
}

/** Returns each distinct cycle once as a list of files that ends where it starts. */
export function findCycles(root, files) {
  const done = new Set();
  const cycles = [];
  const seen = new Set();
  const visit = (file, path) => {
    if (done.has(file)) return;
    const at = path.indexOf(file);
    if (at !== -1) {
      const cycle = path.slice(at);
      const key = [...cycle].sort().join("|");
      if (!seen.has(key)) {
        seen.add(key);
        cycles.push([...cycle, file]);
      }
      return;
    }
    for (const next of runtimeImports(root, file)) visit(next, [...path, file]);
    done.add(file);
  };
  for (const file of files) visit(file, []);
  return cycles;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(".");
  const cycles = findCycles(root, [...sources(resolve(root, "registry/default/blocks"))]);
  for (const c of cycles) console.error(`runtime import cycle: ${c.map((f) => f.slice(root.length + 1)).join(" -> ")}`);
  if (cycles.length) process.exit(1);
  console.log("check-runtime-cycles: ok");
}
