// XLSX export benchmark: times `exportGrid` with a `source` for the buffered and the stream writer and samples peak RSS.
//
// Usage (stop background CPU consumers first):
//   node --expose-gc scripts/bench-export.mjs [options]
// Options:
//   --rows <n[,n]>   row counts (default 100000,1000000)
//   --runs <n>       timed runs per variant after 1 warm-up (default 5)
//   --baseline-root <dir>  checkout of the baseline commit; its buffered path is compared with the current buffered path
//   --out <file>     write all results as JSON
// Every measurement runs in a fresh child process, so peak RSS never carries over from an earlier run. Variants
// alternate in a rotating order each run, so a drifting machine load does not favour one of them. Rows are
// generated batch by batch inside the source, as a database cursor would hand them over. An XLSX source export
// stops at 5,000,000 cells, so 10 columns stop at 500,000 rows; the result lists the rows each run wrote.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import path from "node:path";
import { pathToFileURL } from "node:url";

const COLS = 10;
const BATCH = 2_000;
const columnTypes = ["text", "text", "text", "text", "text", "number", "number", "number", "date", "checkbox"];

const argv = process.argv.slice(2);
const opts = { rows: [100_000, 1_000_000], runs: 5, baselineRoot: undefined, out: undefined, child: undefined };
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--rows") opts.rows = argv[++i].split(",").map(Number);
  else if (arg === "--runs") opts.runs = Number(argv[++i]);
  else if (arg === "--baseline-root") opts.baselineRoot = path.resolve(argv[++i]);
  else if (arg === "--out") opts.out = argv[++i];
  else if (arg === "--child") opts.child = JSON.parse(argv[++i]);
  else throw new Error(`unknown option: ${arg}`);
}

const cacheDir = path.join(process.cwd(), "node_modules/.cache/bench-export");

function makeRow(i) {
  const row = {};
  for (let c = 0; c < COLS; c++) {
    const type = columnTypes[c];
    row[`c${c}`] = type === "number" ? i * 3 + c + 0.25 : type === "date" ? `2024-${String((i % 12) + 1).padStart(2, "0")}-15` : type === "checkbox" ? i % 2 === 0 : `value ${i}-${c}`;
  }
  return row;
}

async function runChild({ bundle, variant, rows }) {
  if (typeof globalThis.gc !== "function") throw new Error("run with node --expose-gc");
  const impl = await import(pathToFileURL(bundle).href);
  const toText = (value) => (value === null || value === undefined ? "" : String(value));
  const cellType = { toText, fromText: (t) => t, clearValue: () => "", isEmpty: (v) => v === "" };
  const state = {
    data: [],
    visibleColumns: columnTypes.map((type, c) => ({ id: `c${c}`, header: `C${c}`, accessorKey: `c${c}`, type })),
    viewIndex: [],
    cellTypes: { text: cellType, number: cellType, date: cellType, checkbox: cellType },
    sortState: [],
    filterState: [],
    searchText: "",
    labels: {},
  };
  const source = async function* () {
    for (let start = 0; start < rows; start += BATCH) yield Array.from({ length: Math.min(BATCH, rows - start) }, (_, k) => makeRow(start + k));
  };
  let size = 0;
  globalThis.gc();
  const sampler = startRssSampler();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const rssBefore = process.memoryUsage().rss;
  const started = performance.now();
  const result = await impl.exportGrid(state, {
    format: "xlsx",
    source,
    xlsxWriter: variant === "stream" ? "stream" : undefined,
    output: (blob) => {
      size = blob.size;
    },
  });
  const ms = performance.now() - started;
  const peak = await sampler.stop();
  process.stdout.write(`RESULT ${JSON.stringify({ ms, peakMb: Math.max(0, peak - rssBefore) / 1048576, rowCount: result.rowCount, truncated: result.truncated, fileMb: size / 1048576 })}\n`);
}

function startRssSampler() {
  const worker = new Worker(
    `const { parentPort } = require("node:worker_threads");
     let peak = 0;
     const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage.rss()); }, 2);
     parentPort.on("message", () => { clearInterval(timer); parentPort.postMessage(peak); });`,
    { eval: true },
  );
  return {
    stop: () =>
      new Promise((resolve) => {
        worker.once("message", (peak) => {
          worker.terminate();
          resolve(peak);
        });
        worker.postMessage("stop");
      }),
  };
}

async function bundleOf(root, name) {
  const io = path.join(root, "registry/default/blocks/data-grid-io").replaceAll(path.sep, "/");
  const outfile = path.join(cacheDir, `${name}.mjs`);
  await build({
    stdin: { contents: `export { exportGrid } from "${io}/export-grid.ts";`, resolveDir: root, loader: "ts" },
    bundle: true,
    format: "esm",
    platform: "node",
    packages: "external",
    tsconfig: path.join(root, "tsconfig.json"),
    outfile,
    logLevel: "error",
  });
  return outfile;
}

const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const mad = (xs) => {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
};

function measure(bundle, variant, rows) {
  const run = spawnSync(process.execPath, ["--expose-gc", process.argv[1], "--child", JSON.stringify({ bundle, variant, rows })], { encoding: "utf8", maxBuffer: 1 << 24 });
  const line = run.stdout.split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) throw new Error(`child failed (${variant}, ${rows}): ${run.stderr.slice(0, 500)}`);
  return JSON.parse(line.slice(7));
}

async function runParent() {
  await mkdir(cacheDir, { recursive: true });
  const bundles = { current: await bundleOf(process.cwd(), "current") };
  if (opts.baselineRoot) bundles.baseline = await bundleOf(opts.baselineRoot, "baseline");
  const variants = [
    ...(bundles.baseline ? [{ name: "baseline buffered", bundle: bundles.baseline, variant: "buffered" }] : []),
    { name: "current buffered", bundle: bundles.current, variant: "buffered" },
    { name: "current stream", bundle: bundles.current, variant: "stream" },
  ];
  const results = [];
  for (const rows of opts.rows) {
    const samples = Object.fromEntries(variants.map((v) => [v.name, []]));
    for (const v of variants) measure(v.bundle, v.variant, Math.min(rows, 5_000));
    for (let run = 0; run < opts.runs; run++) {
      const order = variants.map((_, i) => variants[(i + run) % variants.length]);
      for (const v of order) samples[v.name].push(measure(v.bundle, v.variant, rows));
    }
    for (const v of variants) {
      const list = samples[v.name];
      const row = {
        rows,
        variant: v.name,
        rowCount: list[0].rowCount,
        timeMs: { median: median(list.map((s) => s.ms)), mad: mad(list.map((s) => s.ms)) },
        peakRssMb: { median: median(list.map((s) => s.peakMb)), mad: mad(list.map((s) => s.peakMb)) },
        fileMb: list[0].fileMb,
        samples: list,
      };
      results.push(row);
      console.log(`${rows} rows requested, ${row.rowCount} written, ${v.name}: ${row.timeMs.median.toFixed(0)} ms (MAD ${row.timeMs.mad.toFixed(0)}), peak RSS +${row.peakRssMb.median.toFixed(0)} MB (MAD ${row.peakRssMb.mad.toFixed(0)}), file ${row.fileMb.toFixed(1)} MB`);
    }
  }
  if (opts.out) await writeFile(opts.out, JSON.stringify(results, null, 2));
}

if (opts.child) await runChild(opts.child);
else await runParent();
