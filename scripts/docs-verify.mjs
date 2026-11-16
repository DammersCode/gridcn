// Runs every docs validator and prints one line per check plus the first failures.
// Usage: node scripts/docs-verify.mjs [--only links,code,props,symbols,demos,prose,structure,coverage,audit]
//   [--files content/docs/a.mdx,content/docs/b.mdx]   limit the report (and the slow checks) to these pages
//   [--final]  the definition-of-done run: strict props, a type on every page, Related on every page, the work list, demo warnings as failures
//   [--warnings] [--all] [--strict] [--require-type] [--worklist <json>] [--audit <docs-nav-audit.mjs>] [--migration <dir>] [--baseline <git ref>] [--json]
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { capped, normalizeFile, urlOfPage } from "./docs-verify-lib.mjs";
import { run as runCode } from "./verify-docs-code.mjs";
import { run as runCoverage } from "./verify-docs-coverage.mjs";
import { run as runDemos } from "./verify-docs-demos.mjs";
import { run as runLinks } from "./verify-docs-links.mjs";
import { run as runProps } from "./verify-docs-props.mjs";
import { run as runProse } from "./verify-docs-prose.mjs";
import { run as runStructure } from "./verify-docs-structure.mjs";
import { run as runSymbols } from "./verify-docs-symbols.mjs";

const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const arg = (name) => args[args.indexOf(name) + 1];
const root = has("--root") ? arg("--root") : process.cwd();
const final = has("--final");
const DEFAULT_WORKLIST = "research/docs-rewrite-worklist.json";

const files = has("--files") ? arg("--files").split(",").map((f) => normalizeFile(f, root)) : undefined;
const only = has("--only") ? arg("--only").split(",") : ["links", "code", "props", "symbols", "demos", "prose", "structure", "coverage", "audit"];

function runAudit() {
  const script = has("--audit") ? arg("--audit") : join(root, "scripts/docs-nav-audit.mjs");
  if (!existsSync(script)) return { name: "audit", checked: 0, failures: final ? ["scripts/docs-nav-audit.mjs is not in this tree"] : [], warnings: ["scripts/docs-nav-audit.mjs is not in this tree; the page budgets are not checked"] };
  const out = spawnSync(process.execPath, [script, "--check", join(root, "content/docs")], { encoding: "utf8", cwd: root });
  const lines = out.stdout.split("\n").filter((l) => /h2=\d+: [PNSA]\d/.test(l)).map((l) => `content/docs/${l}`);
  return { name: "audit", checked: 1, failures: out.status === 0 ? [] : lines.length ? lines : ["the audit failed; run it directly"], warnings: [] };
}

const worklist = has("--worklist") ? arg("--worklist") : final ? DEFAULT_WORKLIST : undefined;
const checks = {
  links: () => runLinks({ root, migration: has("--migration") ? arg("--migration") : undefined, baseline: has("--baseline") ? arg("--baseline") : undefined }),
  code: () => runCode({ root, files }),
  props: () => runProps({ root, strict: final || has("--strict") }),
  symbols: () => runSymbols({ root }),
  demos: () => runDemos({ root, strictRules: final }),
  prose: () => runProse({ root, files }),
  structure: () => runStructure({ root, requireType: final || has("--require-type"), requireRelated: final, worklist }),
  coverage: () => {
    const result = runCoverage({ root });
    if (!final) return { ...result, failures: [], warnings: result.failures };
    return result;
  },
  audit: runAudit,
};

const contentDir = join(root, "content/docs");
const pageUrl = (file) => urlOfPage(contentDir, join(root, file));
const isGlobal = (f) => /^(baseline:|migration:|work list .* not found|scripts\/docs-nav-audit|the audit failed|next\.config\.mjs:)/.test(f);
const results = [];
for (const name of only) {
  const result = await checks[name]();
  if (files) {
    result.failures = result.failures.filter((f) => files.some((file) => f.startsWith(file) || (name === "links" && new RegExp(` ${pageUrl(file).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[#\\s.]|$)`).test(f))) || isGlobal(f));
  }
  results.push(result);
}

if (has("--json")) {
  console.log(JSON.stringify(results.map((r) => ({ name: r.name, checked: r.checked, failures: r.failures.length, warnings: r.warnings.length, stats: r.stats })), null, 1));
} else {
  console.log("docs:verify");
  for (const r of results) console.log(`  ${r.name.padEnd(10)} ${r.failures.length ? "FAIL" : "ok  "}  ${String(r.failures.length).padStart(4)} failures  ${String(r.warnings.length).padStart(4)} warnings  (${r.checked} checked)`);
  for (const r of results.filter((x) => x.failures.length)) console.log(`\n${r.name}:\n${capped(r.failures, has("--all") ? Infinity : 5).map((f) => `  ${f}`).join("\n")}`);
}
if (has("--warnings")) {
  for (const r of results.filter((x) => x.warnings.length)) {
    const shown = r.warnings.filter((w) => !files || files.some((file) => w.includes(file)));
    if (shown.length) console.log(`\n${r.name} warnings:\n${capped(shown, has("--all") ? Infinity : 12).map((w) => `  ${w}`).join("\n")}`);
  }
}
process.exit(results.some((r) => r.failures.length) ? 1 : 0);
