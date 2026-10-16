#!/usr/bin/env node
// Feature smoke suite: drives the production build (`next start`) of a consumer app that already has the registry demos installed.
// Usage: node scripts/e2e-smoke.mjs [appDir] [--url http://127.0.0.1:PORT]
import { spawn, execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import net from "node:net";

export const SMOKE_ITEMS = [
  "data-grid-minimal-demo",
  "data-grid-demo",
  "data-grid-sorting-filtering-demo",
  "data-grid-fill-patterns-demo",
  "data-grid-history-demo",
  "data-grid-io-demo",
  "data-grid-status-bar-demo",
  "data-grid-context-menu-demo",
  "data-grid-detail-panel-demo",
];
const REMOUNT_PAGE = "smoke-remount";

const here = dirname(fileURLToPath(import.meta.url));

/** Writes the remount harness page into the consumer app's e2e route folder. */
export function writeRemountPage(e2eDir) {
  const dir = join(e2eDir, REMOUNT_PAGE);
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(here, "e2e-smoke-remount-page.txt"), join(dir, "page.tsx"));
}

async function main() {
  const { chromium } = await import("playwright");
  const args = process.argv.slice(2);
  const urlFlag = args.indexOf("--url");
  const baseUrl = urlFlag >= 0 ? args[urlFlag + 1] : null;
  const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--url");
  const appDir = positional[0] ?? join(tmpdir(), "gridcn-e2e-scaffold");
  if (!existsSync(join(appDir, "package.json"))) {
    console.error(`No prepared app at ${appDir}. Run pnpm test:e2e-install --reuse first, or pass the app directory.`);
    process.exit(1);
  }

  const srcLayout = existsSync(join(appDir, "src", "app"));
  const componentsDir = join(appDir, srcLayout ? "src" : "", "components");
  const installProblems = checkInstalled(appDir, componentsDir);
  if (installProblems.length > 0) {
    console.error(`Installed-files check failed:\n${installProblems.map((p) => `  x ${p}`).join("\n")}`);
    process.exit(1);
  }

  let server = null;
  let origin = baseUrl;
  if (!origin) {
    const port = await freePort();
    server = spawn(`npx next start -p ${port}`, { cwd: appDir, shell: true, stdio: "ignore", detached: process.platform !== "win32" });
    origin = `http://127.0.0.1:${port}`;
    await waitForHttp(`${origin}/e2e/${SMOKE_ITEMS[0]}`);
  }

  const browser = await chromium.launch();
  const failures = [];
  const started = Date.now();
  try {
    for (const scenario of SCENARIOS) {
      const t0 = Date.now();
      const error = await runScenario(browser, origin, scenario);
      console.log(`${error ? "FAIL" : "ok  "} ${scenario.name} (${Date.now() - t0} ms)`);
      if (error) failures.push(`${scenario.name}: ${error}`);
    }
  } finally {
    await browser.close();
    if (server) killTree(server.pid);
  }
  console.log(`\n${SCENARIOS.length} scenarios in ${Math.round((Date.now() - started) / 1000)} s`);
  if (failures.length > 0) {
    console.error(`\n=== FAIL: ${failures.length} scenario(s) ===\n${failures.map((f, i) => `${i + 1}. ${f}`).join("\n")}`);
    process.exit(1);
  }
}

function checkInstalled(appDir, componentsDir) {
  const problems = [];
  if (!existsSync(join(componentsDir, "data-grid", "data-grid.tsx"))) problems.push("components/data-grid/data-grid.tsx is not installed");
  if (!existsSync(join(appDir, ".next", "BUILD_ID"))) problems.push(".next/BUILD_ID missing: the app has no production build");
  for (const item of SMOKE_ITEMS) {
    if (!existsSync(join(componentsDir, `${item}.tsx`))) problems.push(`components/${item}.tsx is not installed`);
  }
  for (const file of listFiles(componentsDir)) {
    if (/@\/registry\//.test(readFileSync(file, "utf8"))) problems.push(`${file} imports from @/registry/, which a consumer app does not have`);
  }
  return problems;
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

async function runScenario(browser, origin, { page: route, run }) {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"], acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || /hydrat|did not match/i.test(msg.text())) problems.push(`console ${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => problems.push(`page error: ${err}`));
  try {
    const response = await page.goto(`${origin}/e2e/${route}`, { waitUntil: "networkidle" });
    check(response?.status() === 200, `GET /e2e/${route} returned ${response?.status()}`);
    check(/\/_next\/static\//.test(await page.content()), "page does not load /_next/static assets of a production build");
    await page.locator('[role="grid"]').first().waitFor();
    await run(page);
    await page.waitForTimeout(100);
    check(problems.length === 0, problems.join("\n"));
    return null;
  } catch (error) {
    return [String(error?.message ?? error).split("\n")[0], ...problems].join(" | ");
  } finally {
    await context.close();
  }
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function eventually(fn, message) {
  const deadline = Date.now() + 5000;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`${message} (last value: ${JSON.stringify(last)})`);
}

const cell = (page, row, col) => page.locator(`[data-grid-row-index="${row}"] [role="gridcell"][data-column-id="${col}"]`);
const textOf = async (locator) => ((await locator.textContent()) ?? "").trim();

async function center(locator) {
  const box = await locator.boundingBox();
  check(box, "element has no bounding box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(page, from, to) {
  const a = await center(from);
  const b = await center(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

const selectedCount = (page) => page.locator('[role="gridcell"][aria-selected="true"]').count();

async function fillDragSeries(page) {
  await drag(page, cell(page, 0, "count"), cell(page, 2, "count"));
  const handle = page.locator("[data-grid-fill-handle]");
  await handle.waitFor();
  await drag(page, handle, cell(page, 5, "count"));
  await eventually(async () => (await textOf(cell(page, 5, "count"))) === "6", "fill handle drag did not extend the 1, 2, 3 series to 6");
  check((await textOf(cell(page, 3, "count"))) === "4", "fill series row 4 is not 4");
}

const SCENARIOS = [
  {
    name: "core: select a cell and drag a range",
    page: "data-grid-minimal-demo",
    run: async (page) => {
      await cell(page, 1, "name").click();
      await eventually(async () => (await cell(page, 1, "name").getAttribute("data-active")) !== null, "clicked cell is not active");
      check((await selectedCount(page)) === 1, "exactly one cell should be selected");
      await drag(page, cell(page, 0, "name"), cell(page, 1, "age"));
      await eventually(async () => (await selectedCount(page)) === 4, "dragging from Name/row 1 to Age/row 2 should select 4 cells");
    },
  },
  {
    name: "core: Enter edits and commits",
    page: "data-grid-minimal-demo",
    run: async (page) => {
      await cell(page, 0, "name").click();
      await page.keyboard.press("Enter");
      const editor = page.locator('[data-grid-row-index="0"] input');
      await editor.waitFor();
      await editor.fill("Ada Byron");
      await page.keyboard.press("Enter");
      await eventually(async () => (await textOf(cell(page, 0, "name"))) === "Ada Byron", "committed value is not shown");
    },
  },
  {
    name: "core: Escape cancels an edit",
    page: "data-grid-minimal-demo",
    run: async (page) => {
      await cell(page, 0, "name").click();
      await page.keyboard.press("Enter");
      const editor = page.locator('[data-grid-row-index="0"] input');
      await editor.waitFor();
      await editor.fill("discarded");
      await page.keyboard.press("Escape");
      await eventually(async () => (await page.locator('[data-grid-row-index="0"] input').count()) === 0, "editor stays open after Escape");
      check((await textOf(cell(page, 0, "name"))) === "Ada Lovelace", "Escape did not restore the original value");
    },
  },
  {
    name: "core: checkbox toggles on the first click",
    page: "data-grid-minimal-demo",
    run: async (page) => {
      const box = cell(page, 2, "active").getByRole("checkbox");
      check((await box.getAttribute("aria-checked")) === "false", "Margaret starts unchecked");
      const { x, y } = await center(box);
      await page.mouse.click(x, y);
      await eventually(async () => (await cell(page, 2, "active").getByRole("checkbox").getAttribute("aria-checked")) === "true", "first click did not check the box");
    },
  },
  {
    name: "core: keyboard navigation (arrows, Tab, Home, End)",
    page: "data-grid-minimal-demo",
    run: async (page) => {
      const active = async () => page.locator('[role="gridcell"][data-active]').evaluate((el) => `${el.parentElement?.getAttribute("data-grid-row-index")}:${el.getAttribute("data-column-id")}`);
      await cell(page, 0, "name").click();
      await page.keyboard.press("ArrowDown");
      await eventually(async () => (await active()) === "1:name", "ArrowDown did not move to row 2");
      await page.keyboard.press("ArrowRight");
      await eventually(async () => (await active()) === "1:age", "ArrowRight did not move to Age");
      await page.keyboard.press("Tab");
      await eventually(async () => (await active()) === "1:active", "Tab did not move to Active");
      await page.keyboard.press("Home");
      await eventually(async () => (await active()) === "1:name", "Home did not move to the first column");
      await page.keyboard.press("End");
      await eventually(async () => (await active()) === "1:active", "End did not move to the last column");
    },
  },
  {
    name: "core: sort by header click",
    page: "data-grid-sorting-filtering-demo",
    run: async (page) => {
      const ages = async () => (await page.locator('[role="gridcell"][data-column-id="age"]').allTextContents()).slice(0, 8).map(Number);
      await page.getByRole("columnheader", { name: "Age" }).click();
      await eventually(async () => {
        const values = await ages();
        return values.every((v, i) => i === 0 || values[i - 1] <= v) && values[0] < 25;
      }, "first rows are not ascending by Age");
      await page.getByRole("columnheader", { name: "Age" }).click();
      await eventually(async () => {
        const values = await ages();
        return values.every((v, i) => i === 0 || values[i - 1] >= v) && values[0] > 60;
      }, "second header click does not sort Age descending");
    },
  },
  {
    name: "core: filter narrows the rows",
    page: "data-grid-sorting-filtering-demo",
    run: async (page) => {
      await page.getByRole("button", { name: "Filters" }).click();
      await page.getByRole("button", { name: "Add filter" }).click();
      await page.getByLabel("Filter value").fill("Tiger");
      await eventually(async () => {
        const names = await page.locator('[role="gridcell"][data-column-id="name"]').allTextContents();
        return names.length > 0 && names.length < 20 && names.every((n) => n.includes("Tiger"));
      }, "rows are not narrowed to names containing Tiger");
    },
  },
  {
    name: "clipboard: copy a range and paste it elsewhere",
    page: "data-grid-minimal-demo",
    run: async (page) => {
      await drag(page, cell(page, 0, "name"), cell(page, 1, "age"));
      await page.keyboard.press("ControlOrMeta+c");
      await eventually(async () => (await page.evaluate(() => navigator.clipboard.readText())).includes("Ada Lovelace"), "system clipboard does not hold the copied range");
      await cell(page, 2, "name").click();
      await page.keyboard.press("ControlOrMeta+v");
      await eventually(
        async () => (await textOf(cell(page, 2, "name"))) === "Ada Lovelace" && (await textOf(cell(page, 2, "age"))) === "28",
        "pasted range is missing from row 3",
      );
    },
  },
  {
    name: "add-on: fill handle extends a series",
    page: "data-grid-fill-patterns-demo",
    run: async (page) => fillDragSeries(page),
  },
  {
    name: "add-on: fill plugin works again after a remount",
    page: REMOUNT_PAGE,
    run: async (page) => {
      await fillDragSeries(page);
      await page.getByRole("button", { name: "Remount" }).click();
      await eventually(async () => (await textOf(cell(page, 5, "count"))) === "", "remount did not reset the grid data");
      await fillDragSeries(page);
    },
  },
  {
    name: "add-on: undo and redo an edit",
    page: "data-grid-history-demo",
    run: async (page) => {
      const before = await textOf(cell(page, 0, "score"));
      await cell(page, 0, "score").click();
      await page.keyboard.press("Enter");
      const editor = page.locator('[data-grid-row-index="0"] input');
      await editor.fill("777");
      await page.keyboard.press("Enter");
      await eventually(async () => (await textOf(cell(page, 0, "score"))) === "777", "edit did not commit");
      await page.getByRole("button", { name: "Undo" }).click();
      await eventually(async () => (await textOf(cell(page, 0, "score"))) === before, "Undo did not restore the old value");
      await page.getByRole("button", { name: "Redo" }).click();
      await eventually(async () => (await textOf(cell(page, 0, "score"))) === "777", "Redo did not reapply the edit");
    },
  },
  {
    name: "add-on: import a CSV and export to CSV",
    page: "data-grid-io-demo",
    run: async (page) => {
      await page.getByRole("button", { name: "Import" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.locator('input[type="file"]').setInputFiles({
        name: "people.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("Name,Email,Score\nZed Zebra,zed@example.com,5\nYuri Yak,yuri@example.com,7\n"),
      });
      await dialog.getByRole("button", { name: /^Import/ }).last().click();
      await eventually(async () => (await textOf(cell(page, 0, "name"))) === "Zed Zebra", "imported rows did not replace the grid data");
      await page.getByRole("button", { name: /export/i }).click();
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: /csv/i }).click()]);
      check(download.suggestedFilename().endsWith(".csv"), `export file is ${download.suggestedFilename()}`);
      const csv = readFileSync(await download.path(), "utf8");
      check(csv.includes("Zed Zebra") && csv.includes("Yuri Yak"), "exported CSV misses the imported rows");
    },
  },
  {
    name: "add-on: status bar sums a numeric range",
    page: "data-grid-status-bar-demo",
    run: async (page) => {
      await drag(page, cell(page, 0, "score"), cell(page, 2, "score"));
      const scores = await Promise.all([0, 1, 2].map(async (row) => Number(await textOf(cell(page, row, "score")))));
      const sum = scores.reduce((a, b) => a + b, 0);
      const bar = page.locator('[role="status"]', { hasText: "Sum" });
      await eventually(async () => new RegExp(`Sum\\s*${sum}(?!\\d)`).test((await bar.textContent()) ?? ""), `status bar does not show Sum ${sum}`);
    },
  },
  {
    name: "add-on: context menu opens on right-click",
    page: "data-grid-context-menu-demo",
    run: async (page) => {
      await cell(page, 1, "name").click({ button: "right" });
      await page.getByRole("menu").waitFor();
      check((await page.getByRole("menuitem", { name: /copy/i }).count()) > 0, "context menu has no Copy item");
    },
  },
  {
    name: "recipe: clicking a cell opens that row in a dialog",
    page: "data-grid-detail-panel-demo",
    run: async (page) => {
      const name = await textOf(cell(page, 1, "name"));
      await cell(page, 1, "name").click();
      await eventually(async () => ((await page.getByRole("dialog").textContent()) ?? "").includes(name), `dialog does not show ${name}`);
    },
  },
];

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function waitForHttp(url) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).status === 200) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`next start did not serve ${url} within 60 s`);
}

function killTree(pid) {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    else process.kill(-pid, "SIGKILL");
  } catch {}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
