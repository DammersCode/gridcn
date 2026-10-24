// Sort-latency harness: clicks a sortable header (headerClickBehavior="sort") and measures time
// from the click to the first frame whose first row shows the sorted order.
//
// Usage:
//   node scripts/perf-sort.mjs [options]
// Options:
//   --url <url>      page with a sortable grid (default: local sort-bench page, 100k rows)
//   --column <name>  header text of the column to sort (default Name)
//   --runs <n>       measure n times, each on a fresh page load; prints a median line plus min, max and
//                    spread (median absolute deviation, MAD) per metric when n > 1 (default 5)
//   --out <file>     write the median metrics and their "spread" to a JSON file
//   --baseline <file> print delta (median minus baseline) and significant (|delta| > larger of the
//                    two spreads, per metric; a baseline without "spread" counts as 0)
// Examples:
//   node scripts/perf-sort.mjs
//   node scripts/perf-sort.mjs --column Score --runs 3
//   node scripts/perf-sort.mjs --url "http://localhost:3000/dev/sort-bench?rows=20000"
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const opts = { url: "http://localhost:3000/dev/sort-bench?rows=100000", column: "Name", runs: 5 };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--url") opts.url = argv[++i];
  else if (argv[i] === "--column") opts.column = argv[++i];
  else if (argv[i] === "--runs") opts.runs = Number(argv[++i]);
  else if (argv[i] === "--out") opts.out = argv[++i];
  else if (argv[i] === "--baseline") opts.baseline = argv[++i];
  else throw new Error(`unknown option: ${argv[i]}`);
}
if (!Number.isInteger(opts.runs) || opts.runs < 1) throw new Error("--runs must be a positive integer");

async function runOnce(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector('[role="gridcell"]', { timeout: 60_000 });
    await page.waitForTimeout(2500);
    return await page.evaluate(
      ({ column }) =>
        new Promise((resolve, reject) => {
          const rowText = () => document.querySelector('[role="gridcell"]')?.closest('[role="row"]:not(:has([role="columnheader"]))')?.textContent ?? "";
          const head = [...document.querySelectorAll('[role="columnheader"]')].find((h) => h.textContent.includes(column));
          if (!head) {
            reject(new Error(`column not found: ${column}`));
            return;
          }
          const before = rowText();
          const longTasks = [];
          const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => longTasks.push(e.duration)));
          po.observe({ entryTypes: ["longtask"] });
          const t0 = performance.now();
          head.click();
          const poll = () => {
            const now = rowText();
            if (now !== before && head.getAttribute("aria-sort") === "ascending") {
              const ms = performance.now() - t0;
              setTimeout(() => {
                po.disconnect();
                resolve({ ms, longest: Math.max(0, ...longTasks), before, after: now });
              }, 50);
            } else if (performance.now() - t0 > 30_000) {
              po.disconnect();
              resolve({ error: "timeout", ariaSort: head.getAttribute("aria-sort") });
            } else requestAnimationFrame(poll);
          };
          poll();
        }),
      { column: opts.column },
    );
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch();
const ms = [], longest = [];
try {
  for (let i = 0; i < opts.runs; i++) {
    const r = await runOnce(browser);
    console.log(JSON.stringify({ column: opts.column, run: i + 1, ...r, before: r.before?.slice(0, 30), after: r.after?.slice(0, 30) }));
    if (typeof r.ms === "number") { ms.push(r.ms); longest.push(r.longest); }
  }
} finally {
  await browser.close();
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const round = (v) => +v?.toFixed(1);
const series = { ms, longestLongTaskMs: longest };
const pick = (fn) => Object.fromEntries(Object.entries(series).map(([k, v]) => [k, round(fn(v))]));
const mad = (v) => med(v.map((x) => Math.abs(x - med(v))));
const median = pick(med);
const spread = pick(mad);
const summary = opts.runs > 1 ? { min: pick((v) => Math.min(...v)), max: pick((v) => Math.max(...v)), spread } : {};
console.log(JSON.stringify({ median: true, column: opts.column, ...median, n: ms.length, ...summary }));
if (opts.out) await writeFile(opts.out, `${JSON.stringify({ ...median, spread }, null, 2)}\n`);
if (opts.baseline) {
  const base = JSON.parse(await readFile(opts.baseline, "utf8"));
  const delta = {}, significant = {};
  for (const k of Object.keys(series)) {
    if (typeof base[k] !== "number") continue;
    delta[k] = round(median[k] - base[k]);
    significant[k] = Math.abs(delta[k]) > Math.max(spread[k], base.spread?.[k] ?? 0);
  }
  console.log(JSON.stringify({ delta, significant }));
}
