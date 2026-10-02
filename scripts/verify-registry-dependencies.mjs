#!/usr/bin/env node
// Fails when a registry item imports another item, a shadcn component, or an npm package it does not declare.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const registry = JSON.parse(readFileSync(join(root, "registry.json"), "utf8"));
const NAMESPACE = "DammersCode/gridcn/";
const PROVIDED = new Set(["react", "react-dom", "next"]);
const IMPORT_RE = /^\s*(?:(?:import|export)\b[^;'"]*?\bfrom\s+|import\s+)["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/gm;
const isShipped = (p) => !/\.(test|browser\.test|type-test|test-helper)\.[^./]+$/.test(p) && !p.includes("__screenshots__");
const norm = (p) => p.split("\\").join("/");

const ownersOfFile = new Map();
for (const item of registry.items) {
  for (const f of item.files) ownersOfFile.set(norm(f.path), [...(ownersOfFile.get(norm(f.path)) ?? []), item.name]);
}

function packageName(spec) {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function resolveFile(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(candidate) && /\.(ts|tsx)$/.test(candidate)) return norm(relative(root, candidate));
  }
  return null;
}

const problems = [];
for (const item of registry.items) {
  const registryDeps = new Set(item.registryDependencies ?? []);
  const npmDeps = new Set([...(item.dependencies ?? []), ...(item.devDependencies ?? [])].map((d) => d.replace(/(?<=.)@[^@/]*$/, "")));
  const need = (kind, name, declared, from) => {
    if (!declared) problems.push(`${item.name}: ${from} needs ${kind} "${name}" but registry.json does not declare it`);
  };

  for (const file of item.files) {
    if (!isShipped(file.path) || !/\.(ts|tsx)$/.test(file.path)) continue;
    const abs = join(root, file.path);
    const source = readFileSync(abs, "utf8");
    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2];
      let target = null;
      if (spec.startsWith("@/")) target = resolveFile(join(root, spec.slice(2)));
      else if (spec.startsWith(".")) target = resolveFile(resolve(dirname(abs), spec));
      else {
        const pkg = packageName(spec);
        if (PROVIDED.has(pkg) || pkg.startsWith("node:") || builtinModules.includes(pkg)) continue;
        need("package", pkg, npmDeps.has(pkg), file.path);
        continue;
      }
      if (!target) continue;
      const owners = ownersOfFile.get(target);
      if (owners?.includes(item.name)) continue;
      const owner = owners?.[0];
      if (owner) need("registry item", `${NAMESPACE}${owner}`, registryDeps.has(`${NAMESPACE}${owner}`), file.path);
      else if (target.startsWith("components/ui/")) {
        const component = target.slice("components/ui/".length).replace(/\.tsx?$/, "");
        need("shadcn component", component, registryDeps.has(component), file.path);
      } else if (target.startsWith("registry/")) {
        problems.push(`${item.name}: ${file.path} imports ${target}, which no registry item ships`);
      }
    }
  }
}

if (problems.length) {
  console.error([...new Set(problems)].join("\n"));
  process.exit(1);
}
console.log(`registry dependencies verified for ${registry.items.length} items`);
