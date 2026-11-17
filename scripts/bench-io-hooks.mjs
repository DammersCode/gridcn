// Import and export benchmark: times the export pipeline and the Excel import reader on seeded rows.
//
// Usage (stop background CPU consumers first):
//   node --expose-gc scripts/bench-io-hooks.mjs --baseline-root <checkout> [options]
// Options:
//   --runs <n>       timed runs per case after 2 warm-ups (default 7)
//   --case <substr>  only cases whose name contains the substring
//   --baseline-root <dir>  checkout of the baseline commit; baseline and current alternate in this process
//   --out <file>     write all results as JSON
import { build } from "esbuild";
import { writeFile, mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { pathToFileURL } from "node:url";

const opts = { runs: 7, filter: "", root: process.cwd(), baselineRoot: undefined, out: undefined };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--runs") opts.runs = Number(argv[++i]);
  else if (arg === "--case") opts.filter = argv[++i];
  else if (arg === "--baseline-root") opts.baselineRoot = path.resolve(argv[++i]);
  else if (arg === "--out") opts.out = argv[++i];
  else throw new Error(`unknown option: ${arg}`);
}
if (typeof globalThis.gc !== "function") throw new Error("run with node --expose-gc");

const cacheDir = path.join(process.cwd(), "node_modules/.cache/bench-io-hooks");
await mkdir(cacheDir, { recursive: true });

async function loadImpl(root, name) {
  const io = path.join(root, "registry/default/blocks/data-grid-io").replaceAll(path.sep, "/");
  const outfile = path.join(cacheDir, `${name}.mjs`);
  await build({
    stdin: {
      contents: `export { exportGrid, buildXlsx } from "${io}/export-grid.ts";
export { parseImportFile } from "${io}/parse-import-file.ts";
export { writeXlsx } from "${io}/xlsx-writer.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    packages: "external",
    tsconfig: path.join(root, "tsconfig.json"),
    outfile,
    logLevel: "error",
  });
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}

const current = await loadImpl(opts.root, "current");
const baseline = opts.baselineRoot ? await loadImpl(opts.baselineRoot, "baseline") : undefined;

const COLS = 10;
const toText = (value) => (value === null || value === undefined ? "" : String(value));
const cellTypes = { text: { toText, fromText: (t) => t, clearValue: () => "", isEmpty: (v) => v === "" } };
const visibleColumns = Array.from({ length: COLS }, (_, c) => ({ id: `c${c}`, header: `C${c}`, accessorKey: `c${c}`, type: "text" }));

function makeRows(count) {
  return Array.from({ length: count }, (_, i) => {
    const row = {};
    for (let c = 0; c < COLS; c++) row[`c${c}`] = `value ${i}-${c}`;
    return row;
  });
}

function makeState(data) {
  return { data, visibleColumns, viewIndex: data.map((_, i) => i), cellTypes, sortState: [], filterState: [], searchText: "", labels: {} };
}

const BATCH = 2_000;
function sourceOf(rows) {
  return async function* source() {
    for (let start = 0; start < rows.length; start += BATCH) yield rows.slice(start, start + BATCH);
  };
}

const sink = { output: () => undefined };
const rows100k = makeRows(100_000);
const rows1m = makeRows(1_000_000);
const state100k = makeState(rows100k);
const emptyState = makeState([]);

const sheetRows = [Array.from({ length: COLS }, (_, c) => `C${c}`), ...rows100k.slice(0, 50_000).map((row, i) => Object.values(row).map((value, c) => (c % 2 ? i : value)))];
const xlsxFile = new File([await current.writeXlsx({ sheets: [{ name: "Sheet1", rows: sheetRows }] })], "bench.xlsx");

const cases = [
  { name: "exportGrid csv, loaded 100k x 10", run: (impl) => impl.exportGrid(state100k, { ...sink, csvBom: false }) },
  { name: "exportGrid csv, source 100k x 10", run: (impl) => impl.exportGrid(emptyState, { ...sink, csvBom: false, source: sourceOf(rows100k) }) },
  { name: "exportGrid csv, source 1M x 10", run: (impl) => impl.exportGrid(emptyState, { ...sink, csvBom: false, source: sourceOf(rows1m) }) },
  { name: "exportGrid csv, source 100k x 10, sync formatCell", run: (impl) => impl.exportGrid(emptyState, { ...sink, csvBom: false, source: sourceOf(rows100k), formatCell: ({ text }) => text }) },
  { name: "buildXlsx loaded 100k x 10", run: (impl) => impl.buildXlsx(state100k) },
  { name: "parseImportFile xlsx 50k x 10", run: (impl) => impl.parseImportFile(xlsxFile) },
];

const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const mad = (xs) => {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
};

async function timeOnce(impl, run) {
  globalThis.gc();
  const started = performance.now();
  await run(impl);
  return performance.now() - started;
}

const results = [];
for (const testCase of cases.filter((c) => c.name.includes(opts.filter))) {
  const times = { baseline: [], current: [] };
  for (let i = 0; i < 2; i++) {
    if (baseline) await timeOnce(baseline, testCase.run);
    await timeOnce(current, testCase.run);
  }
  for (let i = 0; i < opts.runs; i++) {
    // alternate the order each run so a drifting machine load does not favour one side
    const order = i % 2 === 0 ? ["baseline", "current"] : ["current", "baseline"];
    for (const side of order) {
      const impl = side === "baseline" ? baseline : current;
      if (impl) times[side].push(await timeOnce(impl, testCase.run));
    }
  }
  const row = {
    name: testCase.name,
    current: { medianMs: median(times.current), madMs: mad(times.current) },
    baseline: baseline ? { medianMs: median(times.baseline), madMs: mad(times.baseline) } : undefined,
  };
  if (row.baseline) {
    row.deltaPct = ((row.current.medianMs - row.baseline.medianMs) / row.baseline.medianMs) * 100;
    row.beyondTwoMad = row.current.medianMs - row.baseline.medianMs > 2 * Math.max(row.current.madMs, row.baseline.madMs);
  }
  results.push(row);
  const fmt = (r) => `${r.medianMs.toFixed(0)} ms (MAD ${r.madMs.toFixed(0)})`;
  console.log(`${row.name}: current ${fmt(row.current)}${row.baseline ? `, baseline ${fmt(row.baseline)}, delta ${row.deltaPct.toFixed(1)}%${row.beyondTwoMad ? " BEYOND 2 MAD" : ""}` : ""}`);
}
if (opts.out) await writeFile(opts.out, JSON.stringify(results, null, 2));
