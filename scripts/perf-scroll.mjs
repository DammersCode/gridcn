// Scroll-perf evidence harness: drives an rAF-paced fling against a running grid page and prints
// frame + long-task metrics as one JSON line per run. Before/after measurements of scroll-related
// changes need a stable harness, not throwaway scripts.
//
// Usage:
//   node scripts/perf-scroll.mjs [options]
// Options:
//   --url <url>        page with a [role="grid"] (default: local dev benchmark, 100k rows)
//   --width <px>       viewport width (default 1440)
//   --peak <px>        peak px/frame during the fling burst (default 240)
//   --frames <n>       measured frames after warm-up (default 240)
//   --scroll-right     scroll to the last columns first (rich-columns scenario)
//   --css <rule>       extra CSS rule injected before measuring; repeatable (A/B what-if testing)
//   --runs <n>         measure n times, each on a fresh page load; prints a median line (default 1)
//   --out <file>       write the median metrics to a JSON file
//   --baseline <file>  print a delta line: median minus the metrics in this file
// Examples:
//   node scripts/perf-scroll.mjs
//   node scripts/perf-scroll.mjs --width 520 --scroll-right
//   node scripts/perf-scroll.mjs --css '[role="gridcell"]{contain:layout style}'
//   node scripts/perf-scroll.mjs --runs 5 --out before.json
//   node scripts/perf-scroll.mjs --runs 5 --baseline before.json
// Never contain or content-visibility [role="row"]: rows are subgrids and containment breaks column alignment.
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const DEFAULTS = {
  url: "http://localhost:3000/dev/benchmark/gridcn?rows=100000",
  width: 1440,
  height: 900,
  peak: 240,
  frames: 240,
  warmup: 60,
  scrollRight: false,
  css: [],
  runs: 1,
};

// Burst-then-settle fling (12 frames decaying from the peak, 12 idle frames), repeated: a steady
// max-speed drag is a different cost profile than a real fling, and the settle frames let the
// virtualization estimator recover between bursts.
function parseArgs(argv) {
  const opts = { ...DEFAULTS, css: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--url": opts.url = next(); break;
      case "--width": opts.width = Number(next()); break;
      case "--peak": opts.peak = Number(next()); break;
      case "--frames": opts.frames = Number(next()); break;
      case "--scroll-right": opts.scrollRight = true; break;
      case "--css": opts.css.push(next()); break;
      case "--runs": opts.runs = Number(next()); break;
      case "--out": opts.out = next(); break;
      case "--baseline": opts.baseline = next(); break;
      default: throw new Error(`unknown option: ${arg}`);
    }
  }
  if (!Number.isInteger(opts.runs) || opts.runs < 1) throw new Error("--runs must be a positive integer");
  return opts;
}

// Runs in the page: rAF-paced, warm-up frames excluded from the sample, long tasks observed via
// PerformanceObserver (headless Chromium).
function driveScript(o) {
  const burst = 12;
  const settle = 12;
  return new Promise((resolve) => {
    const el = document.querySelector('[role="grid"]');
    const maxScroll = el.scrollHeight - el.clientHeight;
    const total = o.warmup + o.frames;
    let pos = 0, frame = 0, last = performance.now();
    const frameTimes = [];
    const longTasks = [];
    const po = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) longTasks.push(e.duration);
    });
    po.observe({ entryTypes: ["longtask"] });
    const step = () => {
      const phase = frame % (burst + settle);
      const delta = phase < burst ? Math.max(1, Math.round(o.peak * (1 - phase / burst))) : 0;
      if (delta > 0) {
        pos = (pos + delta) % maxScroll;
        el.scrollTop = pos;
      }
      const now = performance.now();
      frameTimes.push(now - last);
      last = now;
      frame += 1;
      if (frame < total) requestAnimationFrame(step);
      else {
        po.disconnect();
        resolve({ frameTimes: frameTimes.slice(o.warmup), longTasks });
      }
    };
    requestAnimationFrame(step);
  });
}

function stats(frameTimes, longTasks) {
  const total = frameTimes.reduce((a, b) => a + b, 0);
  const sorted = [...frameTimes].sort((a, b) => a - b);
  const below30 = frameTimes.filter((ms) => ms > 1000 / 30).length;
  return {
    avgFps: total > 0 ? +((frameTimes.length / total) * 1000).toFixed(1) : 0,
    p95: +(sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1),
    maxMs: +(Math.max(...frameTimes)).toFixed(1),
    pctBelow30Fps: +((below30 / frameTimes.length) * 100).toFixed(1),
    longTasks: longTasks.length,
    longTaskMs: Math.round(longTasks.reduce((a, b) => a + b, 0)),
  };
}

function medianOf(runStats) {
  const medians = {};
  for (const key of Object.keys(runStats[0])) {
    const sorted = runStats.map((s) => s[key]).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const value = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    medians[key] = +value.toFixed(1);
  }
  return medians;
}

function deltaOf(medians, baseline) {
  const delta = {};
  for (const key of Object.keys(medians)) delta[key] = +(medians[key] - baseline[key]).toFixed(1);
  return delta;
}

async function measure(browser, opts) {
  const context = await browser.newContext({ viewport: { width: opts.width, height: opts.height } });
  try {
    const page = await context.newPage();
    await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector('[role="grid"]', { timeout: 60_000 });
    await page.waitForTimeout(2500); // settle: page scripts, hydration, initial render
    if (opts.scrollRight) {
      await page.evaluate(() => {
        const el = document.querySelector('[role="grid"]');
        el.scrollLeft = el.scrollWidth - el.clientWidth;
      });
      await page.waitForTimeout(700);
    }
    if (opts.css.length > 0) {
      await page.addStyleTag({ content: opts.css.join("\n") });
      await page.waitForTimeout(700);
    }
    const result = await page.evaluate(driveScript, { ...opts });
    return stats(result.frameTimes, result.longTasks);
  } finally {
    await context.close();
  }
}

const opts = parseArgs(process.argv.slice(2));
const baseline = opts.baseline ? JSON.parse(await readFile(opts.baseline, "utf8")) : null;

const browser = await chromium.launch();
const runStats = [];
try {
  for (let i = 0; i < opts.runs; i++) {
    const metrics = await measure(browser, opts);
    runStats.push(metrics);
    console.log(JSON.stringify({ url: opts.url, width: opts.width, scrollRight: opts.scrollRight, css: opts.css, ...metrics }));
  }
} finally {
  await browser.close();
}

const medians = medianOf(runStats);
if (opts.runs > 1) console.log(JSON.stringify({ median: medians }));
if (opts.out) await writeFile(opts.out, `${JSON.stringify(medians, null, 2)}\n`);
if (baseline) console.log(JSON.stringify({ delta: deltaOf(medians, baseline) }));
