// Checks research/parity-matrix.json and keeps content/docs/data-modes.mdx in sync with it.
// `--write` regenerates the docs page; the default run fails when the page is stale.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const MATRIX_FILE = "research/parity-matrix.json";
const PAGE_FILE = "content/docs/data-modes.mdx";
const BLOCKS = "registry/default/blocks";
const OPTION_SOURCES = [
  { file: `${BLOCKS}/data-grid/store/types.ts`, type: "DataGridSyncProps" },
  { file: `${BLOCKS}/data-grid-lazy/use-data-grid-lazy-rows.ts`, type: "UseDataGridLazyRowsOptions" },
  { file: `${BLOCKS}/data-grid-pagination/use-data-grid-pagination.ts`, type: "UseDataGridPaginationClientOptions" },
  { file: `${BLOCKS}/data-grid-pagination/use-data-grid-pagination.ts`, type: "UseDataGridPaginationServerOptions" },
];
const STATUSES = ["supported", "gap", "n/a", "unverified"];
const UNVERIFIED = "Not verified.";
const LABELS = { supported: "Supported", gap: "Gap", "n/a": "n/a", unverified: "Not verified" };

/** Top-level field names of the exported object type `name` declared in `source`. */
export function extractOptionNames(source, name) {
  const start = source.search(new RegExp(String.raw`export type ${name}(?:<[^>]*>)?\s*=\s*\{`));
  if (start === -1) throw new Error(`type ${name} not found`);
  const code = source.slice(start).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  let depth = 0;
  let body = "";
  for (let i = code.indexOf("{"); i < code.length; i++) {
    const ch = code[i];
    if (ch === "{") depth++;
    if (ch === "}" && --depth === 0) break;
    if (depth === 1) body += ch;
  }
  return [...body.matchAll(/^ {2}(\w+)\??\s*:/gm)].map((m) => m[1]);
}

/** Every problem in the matrix; an empty list means the guard passes. */
export function checkParity(matrix, { optionNames, root: base }) {
  const problems = [];
  const modeIds = new Set(matrix.modes.map((m) => m.id));
  const optionSet = new Set(optionNames);
  const covered = new Set();
  const seen = new Set();
  for (const mode of matrix.modes) {
    if (!mode.description) problems.push(`mode ${mode.id} has no description`);
  }
  for (const row of matrix.features) {
    const at = row.id;
    if (seen.has(at)) problems.push(`${at}: duplicate feature id`);
    seen.add(at);
    for (const option of row.options ?? []) {
      covered.add(option);
      if (!optionSet.has(option)) problems.push(`${at}: option ${option} is not a public option`);
    }
    for (const id of Object.keys(row.cells ?? {})) {
      if (!modeIds.has(id)) problems.push(`${at}: cell ${id} names no mode`);
    }
    for (const id of modeIds) {
      const cell = row.cells?.[id];
      if (!cell) {
        problems.push(`${at}: cell ${id} is empty`);
        continue;
      }
      if (!STATUSES.includes(cell.status)) {
        problems.push(`${at}: cell ${id} has unknown status ${cell.status}`);
      } else if (cell.status === "supported") {
        if (!cell.evidence?.length) problems.push(`${at}: supported cell ${id} has no evidence`);
        const pattern = matrix.modes.find((m) => m.id === id)?.evidencePattern;
        let mentioned = false;
        let missing = false;
        for (const path of cell.evidence ?? []) {
          const file = join(base, path.split("#")[0]);
          if (!existsSync(file)) {
            problems.push(`${at}: cell ${id} evidence path does not exist: ${path}`);
            missing = true;
            continue;
          }
          if (!pattern || row.modeNeutral || new RegExp(pattern, "i").test(readFileSync(file, "utf8"))) mentioned = true;
        }
        if (cell.evidence?.length && !mentioned && !missing) problems.push(`${at}: cell ${id} evidence ${cell.evidence[0]} does not mention the mode (${pattern})`);
      } else if (cell.status === "gap") {
        if (!cell.track) problems.push(`${at}: gap cell ${id} has no tracking id`);
        if (!cell.note) problems.push(`${at}: gap cell ${id} has no note`);
      } else if (cell.status === "n/a") {
        if (!cell.reason) problems.push(`${at}: n/a cell ${id} has no reason`);
      } else if (!cell.note) {
        problems.push(`${at}: unverified cell ${id} has no note`);
      }
    }
  }
  for (const option of optionNames) {
    if (!covered.has(option)) problems.push(`public option ${option} appears in no matrix row`);
  }
  return problems;
}

const cellLabel = (cell) => LABELS[cell.status];
const escapeCell = (text) => text.replaceAll("|", "\\|");

/** The docs page generated from the matrix. */
export function renderParityPage(matrix) {
  const header = ["Feature", ...matrix.modes.map((m) => m.id)];
  const lines = [
    "---",
    "title: Features and data modes",
    "description: Which grid features work with which data source, and where a known gap remains.",
    "icon: Table",
    "---",
    "",
    "{/* Generated from research/parity-matrix.json by scripts/verify-parity.mjs. Do not edit. */}",
    "",
    "A grid feature can behave differently on a local array, on server pages and on lazy rows. The table below sets every feature against every data mode. A `Gap` cell is a known gap, and the notes below the table describe it. A `Not verified` cell has no test or docs file that covers the mode.",
    "",
    "## Data modes",
    "",
    ...matrix.modes.map((m) => `- **${m.id}**: ${m.label}. ${m.description}`),
    "",
    "## Matrix",
    "",
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...matrix.features.map((row) => `| ${[escapeCell(row.feature), ...matrix.modes.map((m) => cellLabel(row.cells[m.id]))].join(" | ")} |`),
    "",
    "## Notes",
    "",
  ];
  for (const row of matrix.features) {
    const notes = matrix.modes.flatMap((m) => {
      const cell = row.cells[m.id];
      const text = cell.status === "gap" ? `Gap: ${cell.note}` : cell.status === "n/a" ? `n/a: ${cell.reason}` : cell.status === "unverified" && cell.note !== UNVERIFIED ? `Not verified: ${cell.note}` : null;
      return text ? [`- **${m.id}**: ${text}`] : [];
    });
    if (row.note) notes.unshift(`- ${row.note}`);
    if (notes.length === 0) continue;
    lines.push(`### ${row.feature}`, "", ...notes, "");
  }
  lines.push("## Related", "", "- [Server-side data](/docs/recipes/data-fetching/server-side)", "- [Lazy loading](/docs/lazy-loading)", "- [Pagination](/docs/pagination)", "");
  return lines.join("\n");
}

function main() {
  const matrix = JSON.parse(readFileSync(join(root, MATRIX_FILE), "utf8"));
  const optionNames = OPTION_SOURCES.flatMap(({ file, type }) => extractOptionNames(readFileSync(join(root, file), "utf8"), type));
  const problems = checkParity(matrix, { optionNames, root });
  const pagePath = join(root, PAGE_FILE);
  const page = problems.length === 0 ? renderParityPage(matrix) : "";
  if (problems.length === 0 && process.argv.includes("--write")) {
    writeFileSync(pagePath, page);
  } else if (problems.length === 0 && (!existsSync(pagePath) || readFileSync(pagePath, "utf8").replace(/\r\n/g, "\n") !== page)) {
    problems.push(`${PAGE_FILE} is stale; run node scripts/verify-parity.mjs --write`);
  }
  if (problems.length > 0) {
    console.error(`Parity matrix problems:\n${problems.map((p) => `  ${p}`).join("\n")}`);
    process.exit(1);
  }
  const counts = matrix.features.flatMap((r) => Object.values(r.cells)).reduce((acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }), {});
  console.log(`parity matrix ok: ${JSON.stringify(counts)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
