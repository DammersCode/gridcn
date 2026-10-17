#!/usr/bin/env node
// Fails when prose or comments use a word that GLOSSARY.md replaces. Fix: use the glossary word.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const SCAN = ["content", "skills", "registry/default", "app", "README.md", "CONTRIBUTING.md", "DEVELOPMENT.md"];
const SKIP_DIRS = new Set(["node_modules", ".next"]);
const SKIP_FILES = new Set(["LICENSE.md"]);

const BANNED = [
  [/(?<![\w\-.])[Oo]ps?\b/, "write 'operation' (use `ops` in a code span)"],
  [/[Ww]indow(?:ing|ed)\b/, "write 'virtualization' or 'virtualized'"],
  [/\b[Ii]d-keyed/, "write 'by row id' or 'row-id-based'"],
  [/\bgrips?\b/, "write 'drag handle'"],
  [/[Ee]scape hatch/, "write 'override'"],
  [/[Vv]iew[- ]space/, "write 'view index'"],
];

// Path prefix -> banned labels that stay allowed there. Keep this empty unless a file has a real reason.
const ALLOW = new Map([]);

function* walk(path) {
  const stat = readdirSync(path, { withFileTypes: true, recursive: false });
  for (const entry of stat) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(path, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(?:tsx?|mdx?)$/.test(entry.name) && !SKIP_FILES.has(entry.name)) yield full;
  }
}

function* files() {
  for (const target of SCAN) {
    const full = join(root, target);
    if (/\.mdx?$/.test(target)) yield full;
    else yield* walk(full);
  }
}

const prose = (line) => line.split(/(`[^`]*`)/).filter((_, i) => i % 2 === 0).join(" ");

function* proseLines(file, text) {
  const lines = text.split(/\r?\n/);
  if (/\.mdx?$/.test(file)) {
    let fence = false;
    for (const [i, line] of lines.entries()) {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence;
      else if (!fence) yield [i + 1, prose(line)];
    }
    return;
  }
  for (const [i, line] of lines.entries()) {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) yield [i + 1, prose(line)];
    else {
      const at = line.search(/\s\/\/\s/);
      if (at >= 0) yield [i + 1, prose(line.slice(at))];
    }
  }
}

const problems = [];
for (const file of files()) {
  const rel = relative(root, file).split(sep).join("/");
  const allowed = [...ALLOW].filter(([prefix]) => rel.startsWith(prefix)).flatMap(([, labels]) => labels);
  for (const [lineNo, line] of proseLines(file, readFileSync(file, "utf8"))) {
    for (const [pattern, advice] of BANNED) {
      if (allowed.includes(advice) || !pattern.test(line)) continue;
      problems.push(`${rel}:${lineNo} — ${advice}: ${line.trim().slice(0, 120)}`);
    }
  }
}

if (problems.length > 0) {
  console.error(`verify-vocabulary: ${problems.length} problem(s)\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("verify-vocabulary: ok");
