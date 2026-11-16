// @vitest-environment node
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env["LANDING_URL"];

const viewports = [
  { name: "desktop", width: 1280, height: 800, maxLines: 3 },
  { name: "phone", width: 375, height: 667, maxLines: 5 },
];

const measureText = () =>
  [...document.querySelectorAll<HTMLElement>("main p, main li a span, main li > span")]
    .filter((el) => (el.textContent ?? "").trim().length > 40 && !el.closest("pre, table, [aria-hidden=true]") && el.getClientRects().length > 0)
    .map((el) => {
      const style = getComputedStyle(el);
      const lineHeight = Number.parseFloat(style.lineHeight);
      return {
        text: (el.textContent ?? "").trim().slice(0, 40),
        lines: Math.round(el.getBoundingClientRect().height / lineHeight),
        fontSize: Number.parseFloat(style.fontSize),
      };
    });

const sectionBox = (id: string) => {
  const r = document.getElementById(id)?.closest("section")?.getBoundingClientRect();
  return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null;
};

const gridRows = () =>
  [...document.querySelectorAll<HTMLElement>("main ul")]
    .filter((ul) => getComputedStyle(ul).display === "grid" && ul.getClientRects().length > 0)
    .map((ul) => {
      const rows = new Map<number, number>();
      for (const li of ul.children) {
        const top = Math.round(li.getBoundingClientRect().top);
        rows.set(top, (rows.get(top) ?? 0) + 1);
      }
      return { name: (ul.closest("section")?.querySelector("h2")?.textContent ?? "?") + ` (${ul.children.length} items)`, perRow: [...rows.values()] };
    });

const gridWidths = [375, 768, 1024, 1280, 1440];

describe.skipIf(!url)("landing layout", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser.close();
  });

  for (const { name, width, height, maxLines } of viewports) {
    it(`${name}: body text wraps to at most ${maxLines} lines and is at least 14px`, async () => {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.goto(url as string);
      const items = await page.evaluate(measureText);
      await page.close();
      expect(items.length).toBeGreaterThan(10);
      expect(items.filter((i) => i.lines > maxLines).map((i) => `${i.lines} lines: ${i.text}`)).toEqual([]);
      expect(items.filter((i) => i.fontSize < 14).map((i) => `${i.fontSize}px: ${i.text}`)).toEqual([]);
    });

    it(`${name}: Tested at 100,000 rows and What is new never share a row`, async () => {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.goto(url as string);
      const perf = await page.evaluate(sectionBox, "perf");
      const news = await page.evaluate(sectionBox, "new");
      await page.close();
      expect(perf).not.toBeNull();
      expect(news).not.toBeNull();
      const verticalOverlap = Math.min(perf!.bottom, news!.bottom) - Math.max(perf!.top, news!.top);
      expect(verticalOverlap).toBeLessThanOrEqual(0);
    });
  }

  for (const width of gridWidths) {
    for (const colorScheme of ["light", "dark"] as const) {
      it(`${width}px ${colorScheme}: every tile grid fills every row`, async () => {
        const page = await browser.newPage({ viewport: { width, height: 800 }, colorScheme });
        await page.goto(url as string);
        const grids = await page.evaluate(gridRows);
        await page.close();
        expect(grids.length).toBeGreaterThan(3);
        expect(grids.filter((g) => new Set(g.perRow).size > 1).map((g) => `${g.name}: ${g.perRow.join(",")}`)).toEqual([]);
      });
    }
  }
});
