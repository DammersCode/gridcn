#!/usr/bin/env node
// Static install proof for every registry:example item in registry.json:
// (a) registryDependencies resolve — namespaced entries (DammersCode/gridcn/<name>) must exist
//     as items in this registry, bare shadcn/ui entries (button, switch, ...) must exist as
//     components/ui/<name> in this repo (the shadcn registry serves the same component the CLI
//     would install), and npm dependencies must be declared in package.json (deps or devDeps);
// (b) every import in the installed payload (public/r/<item>.json) resolves to a payload file of
//     the item or its transitive registry closure, to a repo file under the @/ alias (tsconfig
//     paths + components.json aliases), or to an npm package declared in package.json.
// Unresolvable = FAIL with item + import string, exit 1. Warnings (non-fatal) flag npm imports a
// fresh consumer might not have: resolvable here, but not declared in any closure item's
// registry.json dependencies.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const registry = JSON.parse(readFileSync(join(root, "registry.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tsconfig = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"));

const npmPackages = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
const itemsByName = new Map(registry.items.map((item) => [item.name, item]));
// Every React consumer already has these; warning on them buries the warnings that matter.
const CONSUMER_BASELINE = new Set(["react", "react-dom"]);
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".css"];

// tsconfig paths: longest prefix wins ("@/*" -> "./*" in this repo).
const pathEntries = Object.entries(tsconfig.compilerOptions?.paths ?? {}).sort(
  (a, b) => b[0].length - a[0].length,
);

function repoFileExists(repoRel) {
  const normalized = repoRel.split("/").join(sep);
  if (EXTENSIONS.some((ext) => existsSync(join(root, normalized + ext)))) return true;
  if (["index.ts", "index.tsx", "index.js", "index.jsx"].some((ext) => existsSync(join(root, normalized, ext)))) return true;
  return existsSync(join(root, normalized));
}

function resolveAlias(specifier) {
  for (const [pattern, targets] of pathEntries) {
    if (!pattern.endsWith("*")) continue;
    const prefix = pattern.slice(0, -1);
    if (!specifier.startsWith(prefix)) continue;
    const rest = specifier.slice(prefix.length);
    const candidates = targets.map((t) => t.replace(/\*\*?$/, "") + rest);
    for (const candidate of candidates) {
      const repoRel = candidate.replace(/^\.\//, "").replace(/^\.\*\//, "");
      if (repoFileExists(repoRel)) return repoRel;
    }
    return null;
  }
  return null;
}

function npmPackageName(specifier) {
  return specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
}

function npmSubpathResolves(specifier) {
  try {
    const resolved = new URL(import.meta.resolve(specifier, pathToFileURL(join(root, "registry.json"))));
    return !resolved.href.startsWith("node:");
  } catch {
    return false;
  }
}

// A registryDependencies entry either names an item of this registry (namespaced, the shadcn CLI
// resolves the namespace via the registry URL) or a bare shadcn/ui item (button, switch, ...).
function resolveRegistryDependency(dep, errors, item) {
  const slash = dep.lastIndexOf("/");
  if (slash >= 0) {
    const localName = dep.slice(slash + 1);
    if (!itemsByName.has(localName)) {
      errors.push(`${item.name}: registryDependency "${dep}" does not exist as an item in registry.json`);
      return null;
    }
    return itemsByName.get(localName);
  }
  if (EXTENSIONS.some((ext) => existsSync(join(root, "components", "ui", dep + ext)))) return null; // shadcn/ui item, present in this repo
  errors.push(`${item.name}: registryDependency "${dep}" not found in components/ui (shadcn/ui item missing from this repo)`);
  return null;
}

// Transitive local closure of an example item (namespaced deps only).
function closureOf(item) {
  const seen = new Map([[item.name, item]]);
  const queue = [item];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const dep of current.registryDependencies ?? []) {
      const slash = dep.lastIndexOf("/");
      if (slash < 0) continue;
      const localName = dep.slice(slash + 1);
      const depItem = itemsByName.get(localName);
      if (!depItem || seen.has(localName)) continue;
      seen.set(localName, depItem);
      queue.push(depItem);
    }
  }
  return seen;
}

// Import-specifier extraction. A plain regex false-positives on comment/string text that merely
// looks like an import (e.g. `from "won't"` inside JSDoc), so scan with string + comment state.
function skipInert(src, j) {
  const n = src.length;
  for (;;) {
    while (j < n && /\s/.test(src[j])) j++;
    const two = src.slice(j, j + 2);
    if (two === "//") {
      const nl = src.indexOf("\n", j);
      j = nl === -1 ? n : nl + 1;
      continue;
    }
    if (two === "/*") {
      const end = src.indexOf("*/", j + 2);
      j = end === -1 ? n : end + 2;
      continue;
    }
    return j;
  }
}

function readString(src, j) {
  const quote = src[j];
  if (quote !== '"' && quote !== "'") return null;
  let m = j + 1;
  while (m < src.length && src[m] !== quote && src[m] !== "\n") {
    if (src[m] === "\\") m++;
    m++;
  }
  return src[m] === quote ? src.slice(j + 1, m) : null;
}

function skipString(src, start) {
  const quote = src[start];
  let j = start + 1;
  while (j < src.length && src[j] !== quote) {
    if (src[j] === "\\") j++;
    if (src[j] === "\n") break;
    j++;
  }
  return j + 1;
}

// `import`/`export`/`require` found at code position kwEnd (after the keyword); returns the
// module specifier or null.
function findSpecifier(src, kwEnd, _keyword) {
  const n = src.length;
  let j = skipInert(src, kwEnd);
  if (src[j] === "(") {
    j = skipInert(src, j + 1);
    return readString(src, j);
  }
  if (src[j] === '"' || src[j] === "'") return readString(src, j); // side-effect import
  // named/default import: walk to the `from` keyword (strings/comments skipped, not parsed)
  let k = j;
  while (k < n) {
    const ch = src[k];
    if (ch === '"' || ch === "'") {
      k = skipString(src, k);
      continue;
    }
    const word = src.slice(k).match(/^[A-Za-z_$][\w$]*/)?.[0];
    if (word === "from") return readString(src, skipInert(src, k + 4));
    k++;
  }
  return null;
}

function importsOf(content) {
  const out = [];
  const n = content.length;
  let i = 0;
  while (i < n) {
    const two = content.slice(i, i + 2);
    if (two === "//" || two === "/*") {
      i = two === "//" ? (content.indexOf("\n", i) === -1 ? n : content.indexOf("\n", i) + 1) : (content.indexOf("*/", i + 2) === -1 ? n : content.indexOf("*/", i + 2) + 2);
      continue;
    }
    const ch = content[i];
    if (ch === '"' || ch === "'") {
      i = skipString(content, i);
      continue;
    }
    const word = /^[A-Za-z_$]/.test(ch) ? content.slice(i).match(/^[A-Za-z_$][\w$]*/) : null;
    if (word) {
      if (word[0] === "import" || word[0] === "export" || word[0] === "require") {
        const spec = findSpecifier(content, i + word[0].length);
        if (spec) out.push(spec);
      }
      i += word[0].length;
      continue;
    }
    i++;
  }
  return out;
}

function deriveTarget(payloadPath) {
  // Same rule as scripts/add-registry-targets.mjs: registry/default/<kind>/<rest> ->
  // components/<item-or-flat>/<rest>; examples ship flat (components/<file>), blocks nest per item.
  const parts = payloadPath.split("/");
  const kindIndex = parts.indexOf("examples") >= 0 ? parts.indexOf("examples") : parts.indexOf("blocks");
  if (kindIndex === -1) return null;
  const kind = parts[kindIndex];
  if (kind === "examples") return `components/${parts[parts.length - 1]}`;
  const item = parts[kindIndex + 1];
  return `components/${item}/${parts.slice(kindIndex + 2).join("/")}`;
}

const examples = registry.items.filter((item) => item.type === "registry:example");
const failures = [];
const warnings = [];

for (const item of examples) {
  const errors = [];

  // (a) dependency references — the example itself plus its whole install chain (the consumer
  // gets every closure item, so a broken bare/namespaced dep on any of them breaks the install).
  const closure = closureOf(item);
  for (const depItem of closure.values()) {
    for (const dep of depItem.registryDependencies ?? []) {
      resolveRegistryDependency(dep, errors, depItem);
    }
    if (depItem.name === item.name) {
      for (const dep of [...(depItem.dependencies ?? []), ...(depItem.devDependencies ?? [])]) {
        if (!npmPackages.has(dep)) errors.push(`${depItem.name}: npm dependency "${dep}" not declared in package.json (deps/devDeps)`);
      }
    }
  }
  const declaredNpm = new Set();
  for (const depItem of closure.values()) {
    for (const dep of [...(depItem.dependencies ?? []), ...(depItem.devDependencies ?? [])]) declaredNpm.add(dep);
  }

  // (b) payload imports
  const payloadPath = join(root, "public", "r", `${item.name}.json`);
  if (!existsSync(payloadPath)) {
    errors.push(`${item.name}: payload public/r/${item.name}.json missing (run pnpm registry:build)`);
    failures.push(...errors);
    continue;
  }
  const payload = JSON.parse(readFileSync(payloadPath, "utf8"));
  const payloadTargets = new Set(
    (payload.files ?? [])
      .map((file) => (file.target ?? deriveTarget(file.path)) ?? null)
      .filter((t) => t !== null),
  );
  const closureTargets = new Set(payloadTargets);
  for (const [name] of closure) {
    if (name === item.name) continue;
    const depPayloadPath = join(root, "public", "r", `${name}.json`);
    if (!existsSync(depPayloadPath)) {
      errors.push(`${item.name}: dependency payload public/r/${name}.json missing (run pnpm registry:build)`);
      continue;
    }
    for (const file of JSON.parse(readFileSync(depPayloadPath, "utf8")).files ?? []) {
      closureTargets.add(file.target ?? deriveTarget(file.path));
    }
  }

  for (const file of payload.files ?? []) {
    if (typeof file.content !== "string") continue;
    const selfTarget = file.target ?? deriveTarget(file.path);
    const selfDir = selfTarget?.replace(/[^/]*$/, "") ?? "";
    for (const spec of importsOf(file.content)) {
      if (spec.startsWith("node:")) continue;

      const registryComponentMatch = spec.match(/^@\/registry\/default\/components\/([^/]+)\/(.+)$/);
      if (registryComponentMatch) {
        const [, compItem, rest] = registryComponentMatch;
        const inClosure = closure.has(compItem);
        const target = `components/${compItem}/${rest}`;
        const resolves = inClosure && (EXTENSIONS.some((ext) => closureTargets.has(target + ext)) || [...closureTargets].some((t) => t === target + "/index.ts" || t === target + "/index.tsx"));
        if (!resolves) {
          errors.push(
            inClosure
              ? `${item.name}: import "${spec}" (${file.path}) is not a payload file of ${compItem}`
              : `${item.name}: import "${spec}" (${file.path}) references item '${compItem}' which is not a declared registryDependency`,
          );
        }
        continue;
      }

      if (spec.startsWith("@/")) {
        const repoRel = resolveAlias(spec);
        if (!repoRel) errors.push(`${item.name}: import "${spec}" (${file.path}) does not resolve to a repo file via tsconfig paths / components.json aliases`);
        continue;
      }

      if (spec.startsWith("./") || spec.startsWith("../")) {
        const resolved = normalizeRelative(selfDir, spec);
        const resolves = EXTENSIONS.some((ext) => closureTargets.has(resolved + ext)) || closureTargets.has(resolved) || closureTargets.has(resolved + "/index.ts") || closureTargets.has(resolved + "/index.tsx");
        if (!resolves) errors.push(`${item.name}: import "${spec}" (${file.path}) does not resolve to a payload file in the item or its closure`);
        continue;
      }

      const name = npmPackageName(spec);
      if (!npmPackages.has(name) || !npmSubpathResolves(spec)) {
        errors.push(`${item.name}: import "${spec}" (${file.path}) is not an npm package declared in package.json`);
        continue;
      }
      if (!declaredNpm.has(name) && !CONSUMER_BASELINE.has(name)) {
        warnings.push(`${item.name}: import "${spec}" is not declared in any closure item's registry.json dependencies (a fresh consumer relies on its own boilerplate for it)`);
      }
    }
  }

  failures.push(...errors);
}

function normalizeRelative(baseDir, spec) {
  const stack = [...baseDir.split("/").filter(Boolean), ...spec.split("/").filter(Boolean)];
  const out = [];
  for (const part of stack) {
    if (part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

const uniqueWarnings = [...new Set(warnings)];
const uniqueFailures = [...new Set(failures)];
console.log(`Checked ${examples.length} registry:example items.`);
if (uniqueWarnings.length > 0) {
  console.log(`\nWarnings (${uniqueWarnings.length}):`);
  for (const w of uniqueWarnings) console.log(`  ! ${w}`);
}
if (uniqueFailures.length > 0) {
  console.error(`\nFAIL (${uniqueFailures.length}):`);
  for (const f of uniqueFailures) console.error(`  x ${f}`);
  process.exit(1);
}
console.log("All registry:example items resolve: dependencies exist and every payload import resolves.");
