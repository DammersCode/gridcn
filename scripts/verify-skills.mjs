#!/usr/bin/env node
// Fails when skills, README, or docs use a removed API name, or a skill code block no longer compiles against the registry source.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const skillsRoot = join(root, "skills");
const outDir = join(root, ".next", "skill-snippets");

const REMOVED_NAMES = [
  "onRowClick",
  "RowClickCtx",
  "overlayPlugins",
  "onSelectionCleared",
  "renderCellMenuItems",
  "renderHeaderMenuItems",
  "useDataGridHighlights",
  "useDataGridRowBands",
  "pinnedBottomRows",
  "pinnedTopRows",
  "CellCoord",
];
const REMOVED_RE = new RegExp(String.raw`\b(${REMOVED_NAMES.join("|")})\b`);

function* walk(dir, extensions) {
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) yield join(entry.parentPath, entry.name);
  }
}

const failures = [];

const scanned = [...walk(skillsRoot, [".md"]), ...walk(join(root, "content", "docs"), [".mdx"]), join(root, "README.md")];
for (const file of scanned) {
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((line, index) => {
      const match = REMOVED_RE.exec(line);
      if (match) failures.push(`${relative(root, file)}:${index + 1}: removed API name \`${match[1]}\``);
    });
}

const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
for (const file of walk(skillsRoot, ["SKILL.md"])) {
  if (!readFileSync(file, "utf8").includes(`gridcn-version: "${version}"`)) failures.push(`${relative(root, file)}: frontmatter metadata gridcn-version must be "${version}"`);
}

const snippets = [];
for (const file of walk(skillsRoot, [".md"])) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/^```(tsx?)\r?\n([\s\S]*?)^```/gm)) {
    const line = text.slice(0, match.index).split("\n").length + 1;
    snippets.push({ file, line, ext: match[1], code: match[2] });
  }
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const sourceOf = new Map();
snippets.forEach((snippet, index) => {
  const name = `snippet-${index}.${snippet.ext}`;
  writeFileSync(join(outDir, name), `export {};\n${snippet.code}`);
  sourceOf.set(name, snippet);
});
writeFileSync(
  join(outDir, "ambient.d.ts"),
  `type Order = { id: string; symbol: string; qty: number };
declare const api: { orders(args: Record<string, unknown>): Promise<any> };
declare const columns: import("@/components/data-grid/data-grid").ColumnDef<Order, any>[];
declare const grid: Record<string, any>;
declare const currencyCellType: any;
declare const PopoverContent: typeof import("@/components/ui/popover").PopoverContent;
declare const DataGridRoot: typeof import("@/components/data-grid/data-grid").DataGridRoot;
declare const DataGridHeader: typeof import("@/components/data-grid/data-grid").DataGridHeader;
declare const DataGridBody: typeof import("@/components/data-grid/data-grid").DataGridBody;
declare const DataGridProvider: typeof import("@/components/data-grid/data-grid").DataGridProvider;
declare function cycleSort(prev: import("@/components/data-grid/data-grid").SortSpec[], next: import("@/components/data-grid/data-grid").SortSpec[]): import("@/components/data-grid/data-grid").SortSpec[];
`,
);
writeFileSync(
  join(outDir, "tsconfig.json"),
  JSON.stringify({
    extends: "../../tsconfig.json",
    compilerOptions: {
      incremental: false,
      noEmit: true,
      plugins: [],
      paths: { "@/components/ui/*": ["../../components/ui/*"], "@/components/*": ["../../registry/default/blocks/*"], "@/*": ["../../*"] },
    },
    include: ["*.ts", "*.tsx"],
    exclude: [],
  }),
);

try {
  execFileSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", join(outDir, "tsconfig.json"), "--pretty", "false"], {
    encoding: "utf8",
    stdio: "pipe",
  });
} catch (error) {
  for (const line of String(error.stdout).split("\n")) {
    const match = /(snippet-\d+\.tsx?)\((\d+),\d+\): (.*)$/.exec(line);
    if (!match) continue;
    const snippet = sourceOf.get(match[1]);
    failures.push(`${relative(root, snippet.file)}:${snippet.line + Number(match[2]) - 2}: ${match[3]}`);
  }
}

if (failures.length > 0) {
  console.error(`Skill check failed:\n${failures.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
console.log(`skills: ${snippets.length} code blocks compile, no removed API names`);
