// Client-side sort benchmark: times `computeViewIndex` (the grid's sort step) on seeded data.
//
// Usage (stop background CPU consumers first, e.g. `ccc daemon stop`):
//   node --expose-gc scripts/bench-sort.mjs [options]
// Options:
//   --rows <n[,n]>   row counts (default 100000,1000000)
//   --runs <n>       timed runs per case after 2 warm-ups (default 5; 1M text cases are slow)
//   --case <substr>  only cases whose name contains the substring
//   --baseline-root <dir>  checkout of the baseline commit. Each case then runs baseline and current
//                    alternately in this process on the same rows (so machine load hits both equally),
//                    compares their results element by element, and reports the paired speedup.
//   --live           measure live updates into a sorted view through the store (see liveScenarios) instead of
//                    the one-shot sort
//   --out <file>     write all results as JSON
//   --profile        write a V8 CPU profile (.cpuprofile) of the first selected case to --profile-out
// Columns: "text" and "num" declare the built-in cell types (the grid's default sort path); "free" declares
// none (default collator path). Data is seeded, so every run and every checkout sees the same rows.
import { build } from "esbuild";
import { writeFile, mkdir } from "node:fs/promises";
import { performance, PerformanceObserver } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import path from "node:path";
import { pathToFileURL } from "node:url";
import inspector from "node:inspector/promises";

const opts = { rows: [100_000, 1_000_000], runs: 5, filter: "", root: process.cwd(), baselineRoot: undefined, live: false, profile: false, profileOut: "sort.cpuprofile" };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--rows") opts.rows = argv[++i].split(",").map(Number);
  else if (arg === "--runs") opts.runs = Number(argv[++i]);
  else if (arg === "--case") opts.filter = argv[++i];
  else if (arg === "--baseline-root") opts.baselineRoot = path.resolve(argv[++i]);
  else if (arg === "--live") opts.live = true;
  else if (arg === "--out") opts.out = argv[++i];
  else if (arg === "--profile") opts.profile = true;
  else if (arg === "--profile-out") opts.profileOut = argv[++i];
  else throw new Error(`unknown option: ${arg}`);
}
if (typeof globalThis.gc !== "function") throw new Error("run with node --expose-gc");

const cacheDir = path.join(process.cwd(), "node_modules/.cache/bench-sort");
await mkdir(cacheDir, { recursive: true });

async function loadImpl(root, name) {
  const blocks = path.join(root, "registry/default/blocks/data-grid").replaceAll(path.sep, "/");
  const outfile = path.join(cacheDir, `${name}.mjs`);
  await build({
    stdin: {
      contents: `export { computeViewIndex } from "${blocks}/store/compute.ts";
export { cellTypes } from "${blocks}/cell-types/cell-types.ts";
export { createDataGridStore } from "${blocks}/store/create-store.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    packages: "external",
    jsx: "automatic",
    tsconfig: path.join(root, "tsconfig.json"),
    outfile,
    logLevel: "error",
  });
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}

const current = await loadImpl(opts.root, "current");
const baseline = opts.baselineRoot ? await loadImpl(opts.baselineRoot, "baseline") : undefined;
const { computeViewIndex, cellTypes } = current;

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Anna", "ben", "CARLA", "dave", "Émile", "émile", "Zoë", "zoe", "Ångström", "naïve", "Oscar", "oscar", "Maria", "maría", "Lukas", "Ünal", "ünal", "Sofia", "Jörg", "jorg"];
const LAST = ["Smith", "smith", "Müller", "muller", "O'Brien", "Núñez", "nunez", "Lee", "Kowalski", "Černý", "cerny", "Brown", "de la Cruz", "Van Dyk", "Åberg", "Zhang"];

function makeColumns(count, seed) {
  const rand = mulberry32(seed);
  const name = new Array(count);
  const free = new Array(count);
  const digits = new Array(count);
  const int = new Array(count);
  const float = new Array(count);
  const dirty = new Array(count);
  for (let i = 0; i < count; i++) {
    const r = rand();
    const full = r < 0.03 ? "" : `${FIRST[(rand() * FIRST.length) | 0]} ${LAST[(rand() * LAST.length) | 0]}`;
    // roughly a third of the rows carry a numeric suffix so names are neither all unique nor all equal
    name[i] = r < 0.02 ? null : full !== "" && rand() < 0.35 ? `${full} ${(rand() * 5000) | 0}` : full;
    free[i] = name[i];
    digits[i] = rand() < 0.02 ? "" : `item-${(rand() * 1_000_000) | 0}`;
    const n = rand();
    int[i] = n < 0.03 ? null : (rand() * 1000) | 0;
    float[i] = n < 0.03 ? null : (rand() - 0.5) * 2e6;
    dirty[i] = n < 0.02 ? NaN : n < 0.05 ? null : (rand() * 1000) | 0;
  }
  return { name, free, digits, int, float, dirty };
}

/** Rows shaped like app/dev/benchmark's dataset: 25 distinct names, ages 18-67, scores 0-99. */
function makeDatasetColumns(count) {
  const ADJECTIVES = ["Eager", "Quick", "Silent", "Bold", "Swift"];
  const NOUNS = ["Eagle", "Lion", "Tiger", "Bear", "Wolf"];
  let state = 42;
  const next = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  const dname = new Array(count);
  const dage = new Array(count);
  const dscore = new Array(count);
  for (let i = 0; i < count; i++) {
    dname[i] = `${ADJECTIVES[Math.floor(next() * 5)]} ${NOUNS[Math.floor(next() * 5)]}`;
    dage[i] = Math.floor(next() * 50) + 18;
    next();
    dscore[i] = Math.floor(next() * 100);
  }
  return { dname, dage, dscore };
}

const columnDefs = [
  { id: "dname", accessorKey: "dname", type: "text" },
  { id: "dage", accessorKey: "dage", type: "number" },
  { id: "dscore", accessorKey: "dscore", type: "number" },
  { id: "name", accessorKey: "name", type: "text" },
  { id: "free", accessorKey: "free" },
  { id: "digits", accessorKey: "digits", type: "text" },
  { id: "int", accessorKey: "int", type: "number" },
  { id: "float", accessorKey: "float", type: "number" },
  { id: "dirty", accessorKey: "dirty", type: "number" },
];

const asc = (columnId) => ({ columnId, direction: "asc" });
const desc = (columnId) => ({ columnId, direction: "desc" });

const CASES = [
  { name: "dataset: number (score) asc", sorts: [asc("dscore")] },
  { name: "dataset: number (age) desc", sorts: [desc("dage")] },
  { name: "dataset: text (name) asc", sorts: [asc("dname")] },
  { name: "dataset: filter age >= 30, no sort", sorts: [], filters: [{ columnId: "dage", operator: "gte", value: "30" }] },
  { name: "dataset: filter name contains, no sort", sorts: [], filters: [{ columnId: "dname", operator: "contains", value: "Eagle" }] },
  { name: "text asc", sorts: [asc("name")] },
  { name: "text desc", sorts: [desc("name")] },
  { name: "text asc, input sorted", sorts: [asc("name")], order: "sorted", column: "name", direction: "asc" },
  { name: "text asc, input reversed", sorts: [asc("name")], order: "reversed", column: "name", direction: "asc" },
  { name: "text (no cell type) asc", sorts: [asc("free")] },
  { name: "digits asc", sorts: [asc("digits")] },
  { name: "number int asc", sorts: [asc("int")] },
  { name: "number int desc", sorts: [desc("int")] },
  { name: "number float asc", sorts: [asc("float")] },
  { name: "number float desc", sorts: [desc("float")] },
  { name: "number float asc, input sorted", sorts: [asc("float")], order: "sorted", column: "float", direction: "asc" },
  { name: "number float asc, input reversed", sorts: [asc("float")], order: "reversed", column: "float", direction: "asc" },
  { name: "number with NaN asc", sorts: [asc("dirty")] },
  { name: "2 keys: text asc, int desc", sorts: [asc("name"), desc("int")] },
  { name: "2 keys: int asc, text asc", sorts: [asc("int"), asc("name")] },
];

/** Reorders the rows so the case's column is already sorted (or reversed) in the input. */
function orderRows(rows, orderKind, column, direction) {
  if (!orderKind) return rows;
  const sorted = computeViewIndex(rows, columnDefs, [{ columnId: column, direction }], [], undefined, cellTypes).map((i) => rows[i]);
  return orderKind === "sorted" ? sorted : sorted.reverse();
}

const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const mad = (xs) => {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
};

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

async function measureOnce(impl, rows, sorts, filters) {
  gc();
  const gcEntries = [];
  const observer = new PerformanceObserver((list) => gcEntries.push(...list.getEntries()));
  observer.observe({ entryTypes: ["gc"] });
  const sampler = startRssSampler();
  await new Promise((r) => setTimeout(r, 50));
  const rssBefore = process.memoryUsage().rss;
  const heapBefore = process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers;
  const start = performance.now();
  const view = impl.computeViewIndex(rows, columnDefs, sorts, filters, undefined, impl.cellTypes);
  const ms = performance.now() - start;
  const heapAfter = process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers;
  const peakRss = await sampler.stop();
  await new Promise((r) => setTimeout(r, 10));
  observer.disconnect();
  const gcPause = gcEntries.reduce((sum, e) => sum + e.duration, 0);
  return { ms, view, gcPause, gcCount: gcEntries.length, peakMb: Math.max(0, peakRss - rssBefore) / 1048576, retainedMb: Math.max(0, heapAfter - heapBefore) / 1048576 };
}

function summarize(runs) {
  const times = runs.map((r) => r.ms);
  return {
    medianMs: median(times),
    madMs: mad(times),
    minMs: Math.min(...times),
    maxMs: Math.max(...times),
    peakMb: median(runs.map((r) => r.peakMb)),
    retainedMb: median(runs.map((r) => r.retainedMb)),
    gcPauseMs: median(runs.map((r) => r.gcPause)),
    gcCount: median(runs.map((r) => r.gcCount)),
  };
}

function sameOrder(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const fmt = (x) => x.toFixed(1).padStart(8);
const results = [];
let profiled = false;
for (const rowCount of opts.live ? [] : opts.rows) {
  const columns = { ...makeColumns(rowCount, 42), ...makeDatasetColumns(rowCount) };
  const base = Array.from({ length: rowCount }, (_, i) => ({ dname: columns.dname[i], dage: columns.dage[i], dscore: columns.dscore[i], name: columns.name[i], free: columns.free[i], digits: columns.digits[i], int: columns.int[i], float: columns.float[i], dirty: columns.dirty[i] }));
  for (const testCase of CASES) {
    if (opts.filter && !testCase.name.includes(opts.filter)) continue;
    const rows = orderRows(base, testCase.order, testCase.column, testCase.direction);
    const impls = baseline ? [baseline, current] : [current];
    for (let i = 0; i < 2; i++) for (const impl of impls) impl.computeViewIndex(rows, columnDefs, testCase.sorts, testCase.filters ?? [], undefined, impl.cellTypes);
    let session;
    if (opts.profile && !profiled) {
      session = new inspector.Session();
      session.connect();
      await session.post("Profiler.enable");
      await session.post("Profiler.start");
    }
    const runs = impls.map(() => []);
    let identical = true;
    for (let i = 0; i < opts.runs; i++) {
      // alternate the order so neither implementation always runs first after a gc
      const order = i % 2 === 0 ? impls.keys() : [...impls.keys()].reverse();
      const views = [];
      for (const k of order) {
        const run = await measureOnce(impls[k], rows, testCase.sorts, testCase.filters ?? []);
        views[k] = run.view;
        runs[k].push({ ...run, view: undefined });
      }
      if (baseline && !sameOrder(views[0], views[1])) identical = false;
    }
    if (session) {
      const { profile } = await session.post("Profiler.stop");
      await writeFile(opts.profileOut, JSON.stringify(profile));
      profiled = true;
    }
    const current_ = summarize(runs[impls.length - 1]);
    const row = { rows: rowCount, case: testCase.name, ...current_ };
    let line = `${String(rowCount).padStart(8)}  ${testCase.name.padEnd(34)} median ${fmt(current_.medianMs)} ms ±${current_.madMs.toFixed(1).padStart(6)} [${current_.minMs.toFixed(0)}-${current_.maxMs.toFixed(0)}]  peak +${current_.peakMb.toFixed(0)} MB  gc ${current_.gcPauseMs.toFixed(0)}ms/${current_.gcCount}`;
    if (baseline) {
      const before = summarize(runs[0]);
      row.baseline = before;
      row.speedup = before.medianMs / current_.medianMs;
      row.identical = identical;
      line += `   | baseline ${fmt(before.medianMs)} ±${before.madMs.toFixed(1)} peak +${before.peakMb.toFixed(0)} MB  =>  ${row.speedup.toFixed(2)}x${identical ? "" : "  ORDER DIFFERS"}`;
    }
    results.push(row);
    console.log(line);
  }
}

// Live updates: UPDATES_PER_SECOND single-cell patches (random row, random new value) reach a sorted view of
// `rowCount` rows through `updateCells`. Reported as main-thread ms spent per second of updates. The same seeded
// stream drives both implementations, so their stores must end on the same view index.
const UPDATES_PER_SECOND = 1000;
const liveColumns = [
  { id: "dname", header: "Name", accessorKey: "dname", type: "text" },
  { id: "dage", header: "Age", accessorKey: "dage", type: "number" },
  { id: "dscore", header: "Score", accessorKey: "dscore", type: "number" },
];
const liveScenarios = [
  { name: "live, deferred (default), 10 batches x 100, sort column", batch: 100, options: {}, column: "dscore" },
  { name: "live, immediate, 10 batches x 100, sort column", batch: 100, options: { reorder: "immediate" }, column: "dscore" },
  { name: "live, immediate, 1000 x 1, sort column", batch: 1, options: { reorder: "immediate" }, column: "dscore" },
  { name: "live, immediate, 1000 x 1, filtered view, sort column", batch: 1, options: { reorder: "immediate" }, column: "dscore", filter: true },
  { name: "live, immediate, 1000 x 1, non-sort column", batch: 1, options: { reorder: "immediate" }, column: "dname" },
];

function liveStore(impl, rowCount, scenario) {
  const columns = makeDatasetColumns(rowCount);
  const data = Array.from({ length: rowCount }, (_, i) => ({ id: `r${i}`, dname: columns.dname[i], dage: columns.dage[i], dscore: columns.dscore[i] }));
  const store = impl.createDataGridStore({ data, columns: liveColumns, getRowId: (row) => row.id, cellTypes: impl.cellTypes });
  store.getState().actions.setSorts([{ columnId: "dscore", direction: "asc" }]);
  if (scenario.filter) store.getState().actions.setFilters([{ columnId: "dage", operator: "gte", value: "30" }]);
  return store;
}

function liveRound(store, scenario, rowCount, seed) {
  const rand = mulberry32(seed);
  const names = ["Eager Eagle", "Quick Lion", "Silent Tiger", "Bold Bear", "Swift Wolf"];
  const batches = [];
  for (let b = 0; b < UPDATES_PER_SECOND / scenario.batch; b++) {
    const patches = [];
    for (let k = 0; k < scenario.batch; k++) {
      const rowId = `r${(rand() * rowCount) | 0}`;
      patches.push({ rowId, columnId: scenario.column, value: scenario.column === "dname" ? names[(rand() * 5) | 0] : (rand() * 100) | 0 });
    }
    batches.push(patches);
  }
  const { actions } = store.getState();
  gc();
  const start = performance.now();
  for (const patches of batches) actions.updateCells(patches, { source: "stream", ...scenario.options });
  return performance.now() - start;
}

if (opts.live) {
  const rowCount = opts.rows[opts.rows.length - 1];
  for (const scenario of liveScenarios) {
    if (opts.filter && !scenario.name.includes(opts.filter)) continue;
    const impls = baseline ? [baseline, current] : [current];
    const stores = impls.map((impl) => liveStore(impl, rowCount, scenario));
    for (const store of stores) liveRound(store, scenario, rowCount, 1);
    const times = impls.map(() => []);
    for (let round = 0; round < opts.runs; round++) {
      const order = round % 2 === 0 ? [...impls.keys()] : [...impls.keys()].reverse();
      for (const k of order) times[k].push(liveRound(stores[k], scenario, rowCount, 100 + round));
    }
    let identical = true;
    if (baseline) {
      const a = stores[0].getState().viewIndex;
      const b = stores[1].getState().viewIndex;
      identical = a.length === b.length && a.every((v, i) => v === b[i]);
    }
    const now = times[impls.length - 1];
    let line = `${String(rowCount).padStart(8)}  ${scenario.name.padEnd(58)} ${fmt(median(now))} ms/s ±${mad(now).toFixed(1)} [${Math.min(...now).toFixed(0)}-${Math.max(...now).toFixed(0)}]`;
    const row = { rows: rowCount, case: scenario.name, medianMs: median(now), madMs: mad(now), minMs: Math.min(...now), maxMs: Math.max(...now), identical };
    if (baseline) {
      row.baseline = { medianMs: median(times[0]), madMs: mad(times[0]) };
      row.speedup = median(times[0]) / median(now);
      line += `   | baseline ${fmt(median(times[0]))} ±${mad(times[0]).toFixed(1)} => ${row.speedup.toFixed(2)}x${identical ? "" : "  VIEW DIFFERS"}`;
    }
    results.push(row);
    console.log(line);
  }
}

if (opts.out) await writeFile(opts.out, JSON.stringify({ node: process.version, platform: process.platform, runs: opts.runs, results }, null, 2));
if (results.some((r) => r.identical === false)) process.exitCode = 1;
