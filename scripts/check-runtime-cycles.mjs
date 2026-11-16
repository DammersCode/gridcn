// Fails on a runtime import cycle among core store files (type-only imports are ignored).
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve("registry/default/blocks/data-grid");
const entries = ["store/compute.ts", "columns/column-pin.ts", "columns/legacy-filter-keys.ts", "store/async-gate.ts", "store/commit.ts", "is-dev.ts"].map((f) => resolve(root, f));

const RUNTIME_IMPORT = /^(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["'](\.[^"']+)["']/gms;

function resolveSpecifier(from, spec) {
  const base = resolve(dirname(from), spec);
  return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(existsSync);
}

function runtimeImports(file) {
  const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  const targets = [];
  for (const [statement, spec] of [...text.matchAll(RUNTIME_IMPORT)].map((m) => [m[0], m[1]])) {
    const names = statement.match(/\{([^}]*)\}/)?.[1];
    if (names && names.split(",").map((n) => n.trim()).filter(Boolean).every((n) => n.startsWith("type "))) continue;
    const target = resolveSpecifier(file, spec);
    if (target) targets.push(target);
  }
  return targets;
}

const cycles = [];
function visit(file, path) {
  const at = path.indexOf(file);
  if (at !== -1) return void cycles.push([...path.slice(at), file]);
  for (const next of runtimeImports(file)) visit(next, [...path, file]);
}
for (const entry of entries) visit(entry, []);

const seen = new Set();
const unique = cycles.filter((c) => {
  const key = [...c.slice(0, -1)].sort().join("|");
  return seen.has(key) ? false : (seen.add(key), true);
});
if (unique.length) {
  for (const c of unique) console.error(`runtime import cycle: ${c.map((f) => f.slice(root.length + 1)).join(" -> ")}`);
  process.exit(1);
}
console.log("check-runtime-cycles: ok");
