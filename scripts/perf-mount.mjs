// Mount-speed harness: mounts the grid on the /dev/mount-bench page and reports what a user sees
// (time to first painted rows, time to a settled DOM) plus commit counts, layout and style cost.
//
// Build the page for production measurement. The page stays hidden on a production build without
// GRIDCN_DEV_PAGES; `--profile` makes React's Profiler report in production; `--no-mangling` keeps
// function names for CPU profiles; GRIDCN_DIST_DIR keeps several builds side by side:
//   GRIDCN_DIST_DIR=.next-base GRIDCN_DEV_PAGES=1 pnpm exec next build --profile --no-mangling
//   GRIDCN_DIST_DIR=.next-base GRIDCN_DEV_PAGES=1 pnpm exec next start -p 3100
// Usage:
//   node scripts/perf-mount.mjs [options]
// Options:
//   --url <list>       comma list of server origins (default http://localhost:3100). With two or more,
//                      runs alternate between them (A/B) so machine load hits each equally; labels are A, B, ...
//   --rows <list>      comma list of row counts (default 100,1000,10000)
//   --runs <n>         measured runs per row count and temperature (default 7)
//   --variant <name>   plain | markers (default plain)
//   --mode <name>      mount | hydrate (default mount; hydrate loads the server-rendered page)
//   --throttle <n>     CPU slowdown factor, 1 = none (default 1)
//   --width <px>       viewport width (default 1280)
//   --out <file>       write the per-size medians and spreads to a JSON file
// Cold = first mount in a fresh browser context (empty caches, unwarmed code). Warm = the third and
// later mounts in one page; three rounds of fresh pages, the variant order alternating each round. Run `ccc daemon stop` first: a background indexer skews timings.
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const DEFAULTS = { urls: ["http://localhost:3100"], rows: [100, 1000, 10000], runs: 7, variant: "plain", mode: "mount", throttle: 1, width: 1280, height: 800 };
const WARMUP_MOUNTS = 2;
const LABELS = "ABCDEFGH";

function parseArgs(argv) {
  const opts = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case "--url": opts.urls = next().split(","); break;
      case "--rows": opts.rows = next().split(",").map(Number); break;
      case "--runs": opts.runs = Number(next()); break;
      case "--variant": opts.variant = next(); break;
      case "--mode": opts.mode = next(); break;
      case "--throttle": opts.throttle = Number(next()); break;
      case "--width": opts.width = Number(next()); break;
      case "--out": opts.out = next(); break;
      default: throw new Error(`unknown option: ${argv[i]}`);
    }
  }
  if (!Number.isInteger(opts.runs) || opts.runs < 1) throw new Error("--runs must be a positive integer");
  return opts;
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function summarize(samples) {
  const summary = { median: {}, spread: {}, min: {}, max: {} };
  for (const key of Object.keys(samples[0])) {
    const values = samples.map((s) => s[key]);
    const mid = median(values);
    summary.median[key] = +mid.toFixed(2);
    summary.spread[key] = +median(values.map((v) => Math.abs(v - mid))).toFixed(2);
    summary.min[key] = +Math.min(...values).toFixed(2);
    summary.max[key] = +Math.max(...values).toFixed(2);
  }
  return summary;
}

const CDP_KEYS = ["LayoutCount", "RecalcStyleCount", "LayoutDuration", "RecalcStyleDuration", "ScriptDuration", "TaskDuration"];

async function cdpMetrics(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.filter((m) => CDP_KEYS.includes(m.name)).map((m) => [m.name, m.value]));
}

async function newSession(browser, opts) {
  const context = await browser.newContext({ viewport: { width: opts.width, height: opts.height } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  if (opts.throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: opts.throttle });
  return { context, page, cdp };
}

async function openBench(session, url) {
  await session.page.goto(url, { waitUntil: "load", timeout: 120_000 });
  await session.page.waitForFunction(() => Boolean(window.__mountBench), null, { timeout: 60_000 });
  await session.page.waitForTimeout(500);
}

async function mountOnce({ page, cdp }, rows, variant) {
  const before = await cdpMetrics(cdp);
  const result = await page.evaluate(([r, v]) => window.__mountBench.run(r, v), [rows, variant]);
  const after = await cdpMetrics(cdp);
  const delta = (key) => (after[key] - before[key]) * (key.endsWith("Duration") ? 1000 : 1);
  return {
    rowsPaintedMs: result.rowsPaintedMs,
    settledMs: result.settledMs,
    taskMs: delta("TaskDuration"),
    commits: result.commits,
    mountCommits: result.mountCommits,
    updateCommits: result.updateCommits,
    reactMs: result.actualMs,
    layouts: delta("LayoutCount"),
    layoutMs: delta("LayoutDuration"),
    styleRecalcs: delta("RecalcStyleCount"),
    styleMs: delta("RecalcStyleDuration"),
    scriptMs: delta("ScriptDuration"),
    rowsFirstPaint: result.rowsAtFirstPaint,
    cellsFirstPaint: result.cellsAtFirstPaint,
    rowsSettled: result.rowsAtSettle,
    cellsSettled: result.cellsAtSettle,
    longTasks: result.longTasksMs.length,
    longTaskMs: result.longTasksMs.reduce((a, b) => a + b, 0),
    domNodes: result.domNodes,
  };
}

// Alternates the order of the variants on every pass (A B, B A, ...), so a variant never owns the first or the second slot.
const passOrder = (count, pass) => {
  const order = Array.from({ length: count }, (_, i) => i);
  return pass % 2 === 0 ? order : order.reverse();
};

const WARM_ROUNDS = 3;

async function measureMount(browser, opts, rows) {
  const benchUrl = (origin) => `${origin}/dev/mount-bench?mode=mount&rows=${rows}&variant=${opts.variant}`;
  const cold = opts.urls.map(() => []);
  for (let run = 0; run < opts.runs; run++) {
    for (const i of passOrder(opts.urls.length, run)) {
      const session = await newSession(browser, opts);
      try {
        await openBench(session, benchUrl(opts.urls[i]));
        cold[i].push(await mountOnce(session, rows, opts.variant));
      } finally {
        await session.context.close();
      }
    }
  }
  const warm = opts.urls.map(() => []);
  const perRound = Math.ceil(opts.runs / WARM_ROUNDS);
  for (let round = 0; round < WARM_ROUNDS; round++) {
    for (const i of passOrder(opts.urls.length, round)) {
      const session = await newSession(browser, opts);
      try {
        await openBench(session, benchUrl(opts.urls[i]));
        for (let mount = 0; mount < WARMUP_MOUNTS + perRound; mount++) {
          const sample = await mountOnce(session, rows, opts.variant);
          if (mount >= WARMUP_MOUNTS) warm[i].push(sample);
        }
      } finally {
        await session.context.close();
      }
    }
  }
  return Object.fromEntries(opts.urls.map((_, i) => [LABELS[i], { cold: summarize(cold[i]), warm: summarize(warm[i]) }]));
}

async function hydrateOnce(browser, opts, url) {
  const session = await newSession(browser, opts);
  let hydrationErrors = 0;
  const countHydration = (text) => { if (/hydrat|did not match|server rendered HTML/i.test(text)) hydrationErrors += 1; };
  session.page.on("console", (m) => { if (m.type() === "error") countHydration(m.text()); });
  session.page.on("pageerror", (e) => countHydration(String(e)));
  try {
    const response = await session.page.goto(url, { waitUntil: "load", timeout: 120_000 });
    const html = await response.text();
    await session.page.waitForFunction(() => window.__benchHydratedAt !== undefined, null, { timeout: 60_000 });
    await session.page.waitForTimeout(300);
    const timing = await session.page.evaluate(() => {
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      return {
        fcp: fcp ? fcp.startTime : -1,
        hydratedAt: window.__benchHydratedAt,
        rowsGenMs: window.__benchRowsMs ?? 0,
        cellsNow: document.querySelectorAll('[role="gridcell"]').length,
        title: document.documentElement.id,
      };
    });
    return {
      htmlKb: +(Buffer.byteLength(html) / 1024).toFixed(1),
      ssrRows: (html.match(/role="row"/g) ?? []).length,
      ssrCells: (html.match(/role="gridcell"/g) ?? []).length,
      serverRenderFailed: timing.title === "__next_error__" ? 1 : 0,
      fcpMs: timing.fcp,
      hydratedAtMs: timing.hydratedAt,
      hydrationMs: timing.hydratedAt - timing.fcp - timing.rowsGenMs,
      cellsAfterHydration: timing.cellsNow,
      hydrationErrors,
    };
  } finally {
    await session.context.close();
  }
}

async function measureHydrate(browser, opts, rows) {
  const samples = opts.urls.map(() => []);
  for (let run = 0; run < opts.runs; run++) {
    for (const i of passOrder(opts.urls.length, run)) {
      samples[i].push(await hydrateOnce(browser, opts, `${opts.urls[i]}/dev/mount-bench?mode=hydrate&rows=${rows}&variant=${opts.variant}`));
    }
  }
  return Object.fromEntries(opts.urls.map((_, i) => [LABELS[i], { hydrate: summarize(samples[i]) }]));
}

const opts = parseArgs(process.argv.slice(2));
const browser = await chromium.launch();
const report = { options: { urls: opts.urls, variant: opts.variant, mode: opts.mode, throttle: opts.throttle, runs: opts.runs, width: opts.width }, sizes: {} };
try {
  for (const rows of opts.rows) {
    report.sizes[rows] = opts.mode === "hydrate" ? await measureHydrate(browser, opts, rows) : await measureMount(browser, opts, rows);
    for (const [label, temps] of Object.entries(report.sizes[rows])) {
      for (const [temperature, summary] of Object.entries(temps)) {
        console.log(JSON.stringify({ rows, label, temperature, median: summary.median, spread: summary.spread }));
      }
    }
  }
} finally {
  await browser.close();
}
if (opts.out) await writeFile(opts.out, `${JSON.stringify(report, null, 2)}\n`);
