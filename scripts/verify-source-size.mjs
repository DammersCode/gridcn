// Fails when a block source file passes 800 lines or a test file 1500, or when a listed oversize file grows or shrinks far under its ceiling. Fix: split the file, or run --write.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isTestFile } from "./_lib.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const baselinePath = join(root, "scripts", "source-size-baseline.json");
export const SOURCE_BUDGET = 800;
export const TEST_BUDGET = 1500;
// Room for small edits between ratchets, so a sibling branch's shrink does not turn lint red.
export const CEILING_SLACK = 50;

export function budgetFor(path) {
  return isTestFile(path) || path.includes("/test/") ? TEST_BUDGET : SOURCE_BUDGET;
}

/** Problems for `files` (`{ path, lines }`) against `baseline` (`{ path: ceiling }`). */
export function sizeProblems(files, baseline) {
  const problems = [];
  const seen = new Set();
  for (const { path, lines } of files) {
    const budget = budgetFor(path);
    const ceiling = baseline[path];
    if (ceiling !== undefined) seen.add(path);
    if (ceiling === undefined) {
      if (lines > budget) problems.push(`${path} — ${lines} lines, over the budget of ${budget}; split the file`);
    } else if (lines > ceiling) {
      problems.push(`${path} — ${lines} lines, over its ceiling of ${ceiling}; split the file instead of growing it`);
    } else if (lines <= budget) {
      problems.push(`${path} — ${lines} lines, within the budget of ${budget}; remove it from source-size-baseline.json (run --write)`);
    } else if (lines < ceiling - CEILING_SLACK) {
      problems.push(`${path} — ${lines} lines, more than ${CEILING_SLACK} under its ceiling of ${ceiling}; lower the ceiling (run --write)`);
    }
  }
  for (const path of Object.keys(baseline)) {
    if (!seen.has(path)) problems.push(`${path} — listed in source-size-baseline.json but not found; remove the entry (run --write)`);
  }
  return problems;
}

/** The baseline with every ceiling lowered to the current count and stale entries dropped; never adds or raises. */
export function lowerBaseline(files, baseline) {
  const next = {};
  for (const { path, lines } of files) {
    if (baseline[path] !== undefined && lines > budgetFor(path)) next[path] = Math.min(lines, baseline[path]);
  }
  return next;
}

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(entry.name)) yield full;
  }
}

function main() {
  const files = [...walk(join(root, "registry", "default", "blocks"))].map((file) => ({
    path: relative(root, file).replaceAll("\\", "/"),
    lines: readFileSync(file, "utf8").split(/\r?\n/).length - (readFileSync(file, "utf8").endsWith("\n") ? 1 : 0),
  }));
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  if (process.argv.includes("--write")) {
    writeFileSync(baselinePath, `${JSON.stringify(lowerBaseline(files, baseline), null, 2)}\n`);
    console.log("verify-source-size: baseline lowered");
    return;
  }
  const problems = sizeProblems(files, baseline);
  if (problems.length > 0) {
    console.error(`verify-source-size: ${problems.length} problem(s)\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log("verify-source-size: ok");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
