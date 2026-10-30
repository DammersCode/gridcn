#!/usr/bin/env node
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
const LABELS = { supported: "Supported", gap: "Gap", "n/a": "n/a", unverified: "Not verified" };

/** Top-level field names of the exported object type `name` declared in `source`. */
export function extractOptionNames(source, name) {
  const start = source.search(new RegExp(String.raw`export type ${name}(?:<[^>]*>)?\s*=\s*\{`));
  if (start === -1) throw new Error(`type ${name} not found`);
  let depth = 0;
  let body = "";
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    if (ch === "}" && --depth === 0) break;
    if (depth === 1) body += ch;
  }
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  return [...stripped.matchAll(/^ {2}(\w+)\??\s*:/gm)].map((m) => m[1]);
}

/** Every problem in the matrix; an empty list means the guard passes. */
export function checkParity(matrix, { optionNames, root: base }) {
  const problems = [];
  const modeIds = new Set(matrix.modes.map((m) => m.id));
  const optionSet = new Set(optionNames);
  const covered = new Set();
  for (const row of matrix.features) {
    const at = row.id;
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
        for (const path of cell.evidence ?? []) {
          if (!existsSync(join(base, path.split("#")[0]))) problems.push(`${at}: cell ${id} evidence path does not exist: ${path}`);
        }
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

const cellLabel = (cell) => (cell.status === "gap" ? `Gap (${cell.track})` : LABELS[cell.status]);
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
    "<!-- Generated from research/parity-matrix.json by scripts/verify-parity.mjs. Do not edit. -->",
    "",
    "Each grid feature behaves differently on a local array, on server pages and on lazy rows. This page lists every feature against every data mode. A `Gap` cell names a known hole and its tracking id. A `Not verified` cell has no proof yet.",
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
      const text = cell.status === "gap" ? `Gap (${cell.track}): ${cell.note}` : cell.status === "n/a" ? `n/a: ${cell.reason}` : cell.status === "unverified" ? `Not verified: ${cell.note}` : null;
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
  const page = renderParityPage(matrix);
  const pagePath = join(root, PAGE_FILE);
  if (process.argv.includes("--write")) {
    writeFileSync(pagePath, page);
  } else if (!existsSync(pagePath) || readFileSync(pagePath, "utf8").replace(/\r\n/g, "\n") !== page) {
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
