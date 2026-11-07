// Fills the writer or verifier brief of the docs rewrite plan for one batch and writes it to .next/briefs/.
// Usage: node scripts/docs-batch-brief.mjs --batch B05 --role writer|verifier [--freeze <sha>] [--report <file>]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fileOf } from "./docs-skeleton.mjs";
import { readLf } from "./docs-verify-lib.mjs";

const HARD = { landing: 400, feature: 1500, concept: 1200, task: 1000, step: 800, reference: 2000, example: 800, cheatsheet: 1200 };
const TEMPLATE = {
  landing: "Landing = one-paragraph purpose, then content that no child page has, such as a decision table. No card list of the children: the sidebar lists them. 80 to 350 words, 1 to 6 H2. No props table.",
  feature: "Feature = problem paragraph, then one demo (only when the behavior is visual, interactive, or timing), `<InstallCommand>` when the page owns an add-on, behavior, `## Server mode` when the row has parity ids, props tables (marker above each), `## Related`. 400 to 1,200 words, 2 to 8 H2.",
  concept: "Concept = the question the reader has, the model in short sentences, consequences, `## Related`. No props table, no demo. 300 to 1,000 words, 2 to 5 H2.",
  task: "Task = one goal sentence, prerequisites that are not obvious, numbered steps (at most 12, target 7, one action each), the visible result, `## Related`. 200 to 800 words, 2 to 8 H2.",
  step: "Step = Before you start, the outcome, steps, the visible result, then a Next link (the last step of a path ends with a Where next block of at most 3 links). 200 to 600 words, 2 to 6 H2. No demo.",
  reference: "Reference = a summary table in the first screen, one H3 or table row with an id per symbol (the id is the symbol name in lower case), caveats, `## Related`. No demo. 300 to 1,500 words, 3 to 10 H2.",
  example: "Example = the live demo (the page exists for it), what it shows, `## Related`. 100 to 500 words, 0 to 5 H2.",
  cheatsheet: "Cheatsheet = tables with a one-line purpose each; every row links to its page. Generated pages are made by a generator, not by hand.",
};

function section(plan, from, to) {
  const a = plan.indexOf(from);
  const b = to ? plan.indexOf(to, a) : plan.length;
  return plan.slice(a, b).split("\n").slice(1).join("\n").trim();
}

export function buildBrief({ root = process.cwd(), batch, role, freeze, report = "" }) {
  const list = JSON.parse(readLf(join(root, "research/docs-rewrite-worklist.json")));
  const rows = list.pages.filter((r) => r.batch === batch);
  if (rows.length === 0) throw new Error(`no rows in batch ${batch}`);
  const plan = readLf(join(root, "research/docs-rewrite-plan.md"));
  let text = role === "writer" ? section(plan, "## Appendix A: writer brief", "## Appendix B") : section(plan, "## Appendix B: verifier brief");
  const files = rows.map((r) => fileOf(r));
  const anchorMap = JSON.parse(readLf(join(root, "research/docs-navigation/anchor-map.json")));
  const anchorsFor = (url) => [...new Set(Object.values(anchorMap).flatMap((m) => Object.values(m)).filter((t) => t.split("#")[0] === url && t.includes("#")).map((t) => t.split("#")[1]))];
  const rowBlock = rows
    .map((r) => {
      const server = r.parity.length
        ? `Add an H2 "Server mode" for the parity-matrix features ${r.parity.join(", ")} (research/parity-matrix.json, cells that are not n/a; read the write path and the Server pages). State the real request and response and link the page that owns the detail.`
        : r.parityOwnerOf.length
          ? `This page owns the parity-matrix features ${r.parityOwnerOf.join(", ")}: every non-n/a cell must be true as written.`
          : "none (no Server mode section)";
      return [
        `### ${r.slug}: ${r.title}`,
        `- file: ${fileOf(r)} (url ${r.url}); type ${r.type}; action ${r.action}; wave ${r.wave}`,
        `- words: target ${r.words}, hard cap ${HARD[r.type]}; planned code lines ${r.codeLines || "n/a"}; code: ${r.code}; demo: ${r.demo}`,
        `- aliases: ${r.aliases.length ? r.aliases.join(", ") : "none"}`,
        `- old pages to read (from the freeze commit): ${r.sourceFiles.length ? r.sourceFiles.map((f) => `\`git show ${freeze}:${f}\``).join(", ") : "none: new page, write it from the code and the specs"}`,
        `- anchors that other pages link here and must exist as headings (or [#id]): ${anchorsFor(r.url).join(", ") || "none"}`,
        `- carried demos: ${r.carriedDemos.length ? r.carriedDemos.join(", ") : "none"}`,
        `- template: ${TEMPLATE[r.type]}`,
        `- server mode: ${server}`,
      ].join("\n");
    })
    .join("\n\n");
  const slots = {
    "{{ROW}}": `\n${rowBlock}\n`,
    "{{TARGET_FILES}}": files.join(", "),
    "{{FILES}}": files.join(", "),
    "{{FILES_CSV}}": files.join(","),
    "{{ROWS}}": `\n${rowBlock}\n`,
    "{{REPORT}}": report || "(none)",
    "{{BASELINE_REF}}": freeze,
    "{{TEMPLATE}}": "see each page's template line",
    "{{SERVER_RULE}}": "see each page's server mode line",
  };
  text = text.split("\n").filter((line) => !line.startsWith("Fill the slots") && !line.startsWith("Slots the orchestrator fills")).join("\n");
  for (const [slot, value] of Object.entries(slots)) text = text.split(slot).join(value);
  const header = `Batch ${batch} (${rows.length} pages, wave ${rows[0].wave}). Worktree: ${root}. The pages stay stubs ("docs-stub" marker) until you write them; remove the marker.\n\n`;
  return header + text;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
  const role = arg("--role", "writer");
  const batch = arg("--batch");
  const brief = buildBrief({ batch, role, freeze: arg("--freeze", "HEAD"), report: arg("--report") ? readLf(arg("--report")) : "" });
  mkdirSync(join(process.cwd(), ".next/briefs"), { recursive: true });
  const out = join(process.cwd(), ".next/briefs", `${batch}-${role}.md`);
  writeFileSync(out, brief);
  console.log(out);
}
