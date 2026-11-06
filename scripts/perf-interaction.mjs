// Interaction-cost harness: script time per click and per key press on a running production build
// (`next start`), using CDP Performance.getMetrics ScriptDuration deltas around each interaction.
// Build the app with GRIDCN_DEV_ROUTES=1 (a build-time variable) so /dev routes exist in production.
// Usage: node scripts/perf-interaction.mjs [--url <base>[,<base2>]]  (several bases run interleaved, run by run, so machine load hits each equally)
//   [--rows 1000,100000] [--runs 3] [--iterations 30]
//   [--throttle 1,4] [--css <rule>] [--out file.json]   (--css injects a rule before measuring, for A/B what-ifs)
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, arg, i, all) => (arg.startsWith("--") ? [...acc, [arg.slice(2), all[i + 1]]] : acc), []),
);
const URLS = (args.url ?? "http://localhost:3000/dev/interaction-bench").split(",");
const ROW_COUNTS = (args.rows ?? "1000,100000").split(",").map(Number);
const THROTTLES = (args.throttle ?? "1,4").split(",").map(Number);
const CSS = args.css;
const RUNS = Number(args.runs ?? 3);
const ITERATIONS = Number(args.iterations ?? 30);

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const mad = (values) => {
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
};

async function scriptMs(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return metrics.find((m) => m.name === "ScriptDuration").value * 1000;
}

async function settle(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))));
}

async function cellBox(page, row, col) {
  return page.evaluate(
    ({ row, col }) => {
      const cells = [...document.querySelectorAll('[role="gridcell"]')].filter((c) => {
        const r = c.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const rows = [...new Set(cells.map((c) => Math.round(c.getBoundingClientRect().top)))].sort((a, b) => a - b);
      const top = rows[Math.min(row, rows.length - 1)];
      const inRow = cells
        .filter((c) => Math.round(c.getBoundingClientRect().top) === top)
        .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      const el = inRow[Math.min(col, inRow.length - 1)];
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    { row, col },
  );
}

async function measureOne(page, cdp, action) {
  await settle(page);
  const before = await scriptMs(cdp);
  await action();
  await settle(page);
  return (await scriptMs(cdp)) - before;
}

async function runScenarios(browser, base, rows, throttle) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  await page.goto(`${base}?rows=${rows}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector('[role="grid"]');
  await page.waitForTimeout(2500);
  if (CSS) await page.addStyleTag({ content: CSS });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  const out = {};
  const warm = 8;

  const clickCycle = [[2, 1], [5, 3], [3, 0], [6, 6], [1, 2], [4, 8], [7, 4]];
  const click = async (i) => {
    const [r, c] = clickCycle[i % clickCycle.length];
    const box = await cellBox(page, r, c);
    return measureOne(page, cdp, () => page.mouse.click(box.x, box.y));
  };
  const keyed = (keys) => (i) => measureOne(page, cdp, () => page.keyboard.press(keys[i % keys.length]));

  const scenarios = [
    ["click", click, null],
    ["arrow", keyed(["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"]), async () => page.mouse.click(...Object.values(await cellBox(page, 3, 2)))],
    ["shiftArrow", keyed(["Shift+ArrowDown", "Shift+ArrowRight", "Shift+ArrowUp", "Shift+ArrowLeft"]), async () => page.mouse.click(...Object.values(await cellBox(page, 3, 2)))],
    ["typeStart", async (i) => {
      const ms = await measureOne(page, cdp, () => page.keyboard.press(i % 2 ? "b" : "a"));
      await page.keyboard.press("Escape");
      return ms;
    }, async () => page.mouse.click(...Object.values(await cellBox(page, 3, 1)))],
  ];
  for (const [name, step, prepare] of scenarios) {
    if (prepare) await prepare();
    const samples = [];
    for (let i = 0; i < warm + ITERATIONS; i++) {
      const ms = await step(i);
      if (i >= warm) samples.push(ms);
    }
    out[name] = samples;
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await context.close();
  return out;
}

const browser = await chromium.launch();
const result = {};
try {
  for (const rows of ROW_COUNTS) {
    for (const throttle of THROTTLES) {
      const pooled = URLS.map(() => ({}));
      const perRun = URLS.map(() => ({}));
      for (let run = 0; run < RUNS; run++) {
        const order = [...URLS.entries()];
        if (run % 2) order.reverse();
        for (const [u, base] of order) {
          const samples = await runScenarios(browser, base, rows, throttle);
          for (const [name, values] of Object.entries(samples)) {
            (pooled[u][name] ??= []).push(...values);
            (perRun[u][name] ??= []).push(+median(values).toFixed(3));
          }
        }
      }
      for (const [u] of URLS.entries()) {
        const key = `${URLS.length > 1 ? `${"AB"[u]} ` : ""}${rows}rows@${throttle}x`;
        result[key] = Object.fromEntries(
          Object.entries(pooled[u]).map(([name, values]) => [
            name,
            { median: +median(values).toFixed(3), mad: +mad(values).toFixed(3), n: values.length, runMedians: perRun[u][name] },
          ]),
        );
        console.log(key, JSON.stringify(Object.fromEntries(Object.entries(result[key]).map(([n, s]) => [n, `${s.median}+-${s.mad}`]))));
      }
    }
  }
} finally {
  await browser.close();
}
if (args.out) await writeFile(args.out, `${JSON.stringify(result, null, 2)}\n`);
