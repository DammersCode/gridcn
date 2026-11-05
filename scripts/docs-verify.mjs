// Runs every docs validator and prints one line per check plus the first failures.
// Usage: node scripts/docs-verify.mjs [--only links,code,props,symbols,demos,prose,structure,audit]
//   [--files content/docs/a.mdx,content/docs/b.mdx]   limit the report (and the slow checks) to these pages
//   [--strict] [--require-type] [--worklist <json>] [--audit <docs-nav-audit.mjs>] [--migration <dir>] [--json]
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { capped } from "./docs-verify-lib.mjs";
import { run as runCode } from "./verify-docs-code.mjs";
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
const files = has("--files") ? arg("--files").split(",").map((f) => f.replaceAll("\\", "/")) : undefined;
const only = has("--only") ? arg("--only").split(",") : ["links", "code", "props", "symbols", "demos", "prose", "structure", "audit"];

function runAudit() {
  const script = has("--audit") ? arg("--audit") : join(root, "scripts/docs-nav-audit.mjs");
  if (!existsSync(script)) return { name: "audit", checked: 0, failures: [], warnings: ["scripts/docs-nav-audit.mjs is not in this tree; the page budgets are not checked"] };
  const out = spawnSync(process.execPath, [script, "--check", join(root, "content/docs")], { encoding: "utf8", cwd: root });
  const lines = out.stdout.split("\n").filter((l) => /h2=\d+: [PNSA]\d/.test(l));
  return { name: "audit", checked: 1, failures: out.status === 0 ? [] : lines.length ? lines : ["the audit failed; run it directly"], warnings: [] };
}

const checks = {
  links: () => runLinks({ root, migration: has("--migration") ? arg("--migration") : undefined }),
  code: () => runCode({ root, files }),
  props: () => runProps({ root, strict: has("--strict") }),
  symbols: () => runSymbols({ root }),
  demos: () => runDemos({ root }),
  prose: () => runProse({ root, files }),
  structure: () => runStructure({ root, requireType: has("--require-type"), worklist: has("--worklist") ? arg("--worklist") : undefined }),
  audit: runAudit,
};

const results = [];
for (const name of only) {
  const result = await checks[name]();
  if (files) result.failures = result.failures.filter((f) => files.some((file) => f.startsWith(file)));
  results.push(result);
}

if (has("--json")) {
  console.log(JSON.stringify(results.map((r) => ({ name: r.name, checked: r.checked, failures: r.failures.length, warnings: r.warnings.length, stats: r.stats })), null, 1));
} else {
  console.log("docs:verify");
  for (const r of results) console.log(`  ${r.name.padEnd(10)} ${r.failures.length ? "FAIL" : "ok  "}  ${String(r.failures.length).padStart(4)} failures  ${String(r.warnings.length).padStart(4)} warnings  (${r.checked} checked)`);
  for (const r of results.filter((x) => x.failures.length)) console.log(`\n${r.name}:\n${capped(r.failures, 5).map((f) => `  ${f}`).join("\n")}`);
}
process.exit(results.some((r) => r.failures.length) ? 1 : 0);
