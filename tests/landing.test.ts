import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { pageIndex } from "../scripts/docs-verify-lib.mjs";
import { CLIENT_CODE, faq, HEADLINE, perfDemos, perfStats, serverHighlights, SUBLINE } from "../components/landing/data";
import { CODE_THEMES } from "../lib/code-themes";
import { showReleaseBadge } from "../components/landing/hero";
import { addOnTiles, COMPARISON_DATE, comparison, kitTiles, FEATURE_MATRIX_HREF } from "../components/landing/items";

const root = join(__dirname, "..");
const pages = pageIndex(join(root, "content/docs")) as Map<string, { anchors: Set<string> }>;
const landingDir = join(root, "components/landing");
const landingSources = readdirSync(landingDir)
  .filter((f) => /\.(ts|tsx)$/.test(f))
  .map((f) => ({ file: f, text: readFileSync(join(landingDir, f), "utf8") }));

const BLOCKS_WITHOUT_TILE: Record<string, string> = {};

function resolves(href: string): boolean {
  const [path = "", anchor] = href.split("#");
  const page = pages.get(path.replace(/\/$/, ""));
  if (!page) return false;
  return anchor === undefined || page.anchors.has(anchor);
}

describe("landing page links", () => {
  it("every docs link in the landing source is a 2.0 page (no redirect, no dead anchor)", () => {
    const dead: string[] = [];
    for (const { file, text } of landingSources) {
      for (const match of text.matchAll(/["'`](\/docs[\w/#-]*)/g)) {
        const href = (match[1] as string).replace(/#$/, "");
        if (!resolves(href)) dead.push(`${file}: ${href}`);
      }
    }
    expect(dead).toEqual([]);
  });

  it("every add-on tile, kit tile, server card, perf source, perf demo and FAQ link resolves", () => {
    const hrefs = [
      ...addOnTiles.map((t) => t.href),
      ...kitTiles.map((t) => t.href),
      ...serverHighlights.map((t) => t.href),
      ...perfStats.map((t) => t.href),
      ...perfDemos.map((t) => t.href),
      ...faq.flatMap((f) => f.links.map((l) => l.href)),
    ];
    expect(hrefs.filter((h) => !resolves(h))).toEqual([]);
  });

  it("the agent skills link target exists", () => {
    expect(resolves("/docs/try-automate/use-agent-skills")).toBe(true);
    expect(readFileSync(join(landingDir, "landing-page.tsx"), "utf8")).toContain("/docs/try-automate/use-agent-skills");
  });
});

describe("landing kit tiles", () => {
  it("fill a 2, 3 and 4 column grid without a gap", () => {
    for (const columns of [2, 3, 4]) expect(kitTiles.length % columns, `${columns} columns`).toBe(0);
  });
});

describe("landing server cards and FAQ", () => {
  it("shows four server cards so the two-column grid has no gap", () => {
    expect(serverHighlights.map((h) => h.title)).toEqual(["Pages", "Server sort and filter", "Saves with rollback", "Selection across pages"]);
  });

  it("answers five questions and states the framework tests as the docs page does", () => {
    expect(faq).toHaveLength(5);
    expect(faq.find((f) => f.question === "Which frameworks are tested?")?.answer).toContain("Install tests cover Next.js 16 and Vite");
  });

  it("removes the what-is-new panel and the paid-tier sentence", () => {
    const page = readFileSync(join(landingDir, "landing-page.tsx"), "utf8");
    expect(page).not.toMatch(/NewPanel|paid tier|migrate-2-0/);
  });
});

describe("landing add-on tiles", () => {
  const registry = JSON.parse(readFileSync(join(root, "registry.json"), "utf8")) as { items: { name: string; type: string }[] };
  const blocks = registry.items.filter((i) => i.type === "registry:block").map((i) => i.name);

  it("lists every registry block or excludes it with a reason", () => {
    const listed = new Set(addOnTiles.map((t) => t.block));
    const missing = blocks.filter((b) => !listed.has(b) && !(b in BLOCKS_WITHOUT_TILE));
    expect(missing).toEqual([]);
  });

  it("lists no block that is not in the registry", () => {
    expect(addOnTiles.map((t) => t.block).filter((b) => !blocks.includes(b))).toEqual([]);
  });
});

describe("landing comparison", () => {
  it("dates the check and links every vendor cell to a vendor page", () => {
    expect(COMPARISON_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const row of comparison.rows) {
      for (const cell of row.cells.slice(1)) expect(cell.href, `${row.feature}: ${cell.value}`).toMatch(/^https:\/\/(www\.ag-grid\.com|mui\.com)\//);
    }
  });

  it("shows the rows where gridcn loses, linked to the feature matrix", () => {
    const losing = comparison.rows.filter((r) => r.cells[0].value === "Not built");
    expect(losing.map((r) => r.feature)).toEqual(["Row grouping", "Tree data", "Pivoting", "Master-detail"]);
    for (const row of losing) expect(row.cells[0].href).toBe(FEATURE_MATRIX_HREF);
    expect(resolves(FEATURE_MATRIX_HREF)).toBe(true);
  });

  it("links vendor cells to the page section that states them", () => {
    const cell = (feature: string, column: number) => comparison.rows.find((r) => r.feature === feature)!.cells[column]!;
    expect(cell("Row grouping", 1).href).toBe("https://www.ag-grid.com/react-data-grid/grouping/");
    expect(cell("Fill handle", 2).href).toBe("https://mui.com/x/react-data-grid/clipboard/#drag-to-fill");
  });

  it("has no install-command row", () => {
    expect(comparison.rows.map((r) => r.feature.toLowerCase()).filter((f) => f.includes("shadcn"))).toEqual([]);
  });
});

describe("landing copy", () => {
  const copy = landingSources.map((s) => s.text).join("\n");

  it("makes no unbacked claim", () => {
    expect(copy.replace("Is it accessible?", "")).not.toMatch(/WCAG|\baccessible\b/i);
    expect(copy).not.toMatch(/\bspreadsheet\b(?!-style)/i);
    expect(copy).not.toMatch(/leads where|silent traps|lazy-rows hook/i);
    expect(copy).not.toMatch(/Lazy rows|16\.8 ms|91\.7 ms|0\.3.7\.6 ms/);
  });

  it("states the fill and keymap facts as the docs do", () => {
    const fill = kitTiles.find((t) => t.title === "Fill handle")!.text;
    expect(fill).toContain("Two cells that form a series");
    expect(kitTiles.find((t) => t.title === "Keyboard navigation")!.text).not.toMatch(/Remap any/);
  });

  it("writes whole sentences and plain headings", () => {
    expect(copy).not.toMatch(/Modular by design|Real Chromium\.|Tailwind v4|tile a selection|corner circle/);
  });

  it("gives every install command on the page its own label", () => {
    const page = readFileSync(join(landingDir, "landing-page.tsx"), "utf8");
    const labels = [...page.matchAll(/<InstallCommand[^>]*label="([^"]+)"/g)].map((m) => m[1]);
    expect(labels).toHaveLength(2);
    expect(new Set(labels).size).toBe(2);
  });

  it("loads the hero grid after the first paint", () => {
    expect(readFileSync(join(landingDir, "hero-grid.tsx"), "utf8")).toContain("dynamic(");
  });

  it("takes the version badge from package.json", () => {
    const hero = readFileSync(join(landingDir, "hero.tsx"), "utf8");
    expect(hero).toContain("appVersion");
    expect(hero).not.toMatch(/>\s*\d+\.\d+/);
  });

  it("names React and the license in the hero", () => {
    expect(HEADLINE).toMatch(/React/);
    expect(SUBLINE).toMatch(/Apache‑2\.0/);
    expect(readFileSync(join(root, "LICENSE"), "utf8")).toMatch(/Apache License/);
  });

  it("hides the release badge until the version is 2.0", () => {
    expect(showReleaseBadge("1.3.0")).toBe(false);
    expect(showReleaseBadge("2.0.0")).toBe(true);
  });

  it("sends Get started to the install guide", () => {
    expect(readFileSync(join(landingDir, "hero.tsx"), "utf8")).toContain("/docs/learning-path/install-gridcn");
  });

  it("gives the header GitHub link a hidden icon through an explicit link item", () => {
    const layout = readFileSync(join(root, "lib/layout.shared.tsx"), "utf8");
    expect(layout).not.toContain("githubUrl");
    expect(layout).toContain("GithubIcon");
  });

  it("loads the search dialog on first open", () => {
    expect(readFileSync(join(root, "app/layout.tsx"), "utf8")).toContain("preload: false");
  });

  it("keeps the first-grid sample bounded in height and marked as a client component", () => {
    expect(CLIENT_CODE).toContain('"use client"');
    expect(CLIENT_CODE).toMatch(/className="h-\d+/);
  });
});

describe("landing code block", () => {
  it("uses the shared code theme pair", () => {
    expect(CODE_THEMES).toEqual({ light: "github-light-high-contrast", dark: "github-dark-high-contrast" });
    for (const f of ["components/component-preview.tsx", "components/manual-install.tsx", "components/landing/code.tsx", "source.config.ts"]) {
      expect(readFileSync(join(root, f), "utf8"), f).toContain("CODE_THEMES");
    }
  });

  it("highlights with the dual theme variables of the docs code blocks", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { Code } = await import("../components/landing/code");
    const html = renderToStaticMarkup(await Code({ code: "const a = 1;", label: "Sample" }));
    expect(html).toContain("--shiki-light");
    expect(html).toContain("--shiki-dark");
    expect(html).not.toMatch(/background-color:\s*#|bg-card/);
    expect(html).toContain('aria-label="Sample"');
  });
});

describe("landing idle mount", () => {
  it("falls back to a timer when requestIdleCallback is missing", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    const { whenIdle } = await import("../components/landing/when-idle");
    const callback = vi.fn();
    const cancel = whenIdle(callback);
    vi.runAllTimers();
    expect(callback).toHaveBeenCalledTimes(1);
    const cancelled = vi.fn();
    whenIdle(cancelled)();
    vi.runAllTimers();
    expect(cancelled).not.toHaveBeenCalled();
    cancel();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
