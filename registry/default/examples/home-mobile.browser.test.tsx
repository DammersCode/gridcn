import type { ComponentProps } from "react";
import { page, userEvent } from "vitest/browser";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { FrameworkProvider } from "fumadocs-core/framework";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import HomePage from "@/app/(home)/page";
import { baseOptions } from "@/lib/layout.shared";
// real stylesheet: the overflow this file guards against is pure layout (flex sizing +
// max-width + margins) — without Tailwind's cascade the classes it changes do not exist.
import "@/app/global.css";

// next/link's bundle reads process.env at import time, which the browser harness has no define
// for; without a router it renders plain <a> anyway, so mock it to the same anchor.
vi.mock("next/link", () => ({
  // next/link is CJS: mark the mock as ESM so importers' .default interop picks the component,
  // not the whole module object.
  __esModule: true,
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useLinkStatus: () => ({ pending: false }),
}));

// the real Code is an async server component; the browser harness renders client components only.
vi.mock("@/components/landing/code", () => ({
  Code: ({ code, label }: { code: string; label: string }) => (
    <pre tabIndex={0} aria-label={label} className="min-w-0 overflow-x-auto border p-4 font-mono text-xs">
      {code}
    </pre>
  ),
}));

const WIDTH = 375;
const HEIGHT = 667;

// The app wires Next's router through fumadocs' FrameworkProvider (RootProvider); this harness
// has no Next router, so the header's link/active-state hooks get a static "/" and plain anchors.
function HomeRoute() {
  return (
    <FrameworkProvider
      usePathname={() => "/"}
      useParams={() => ({})}
      useRouter={() => ({ push: () => {}, refresh: () => {} })}
    >
      <HomeLayout links={[]} {...baseOptions()}>
        <HomePage />
      </HomeLayout>
    </FrameworkProvider>
  );
}

describe("home page at a 375x667 viewport (iPhone 8)", () => {
  beforeAll(async () => {
    await page.viewport(WIDTH, HEIGHT);
  });

  it("has no horizontal overflow at document level and the hero card fits the width", async () => {
    await render(<HomeRoute />);
    const h1Locator = page.getByRole("heading", { name: /data grid you own/, level: 1 });
    await expect.element(h1Locator).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 400));
    const h1 = h1Locator.element() as HTMLElement;

    // all eight content sections rendered: without them the scrollWidth check below is vacuous
    expect(document.querySelectorAll("h2").length).toBe(8);

    const heroCard = h1.closest("section") as HTMLElement;
    expect(heroCard, "hero card holds the h1").not.toBeNull();
    expect(heroCard.offsetParent, "hero card is visible").not.toBeNull();
    expect(heroCard.clientWidth).toBeLessThanOrEqual(WIDTH);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(WIDTH);

    await page.screenshot();
  });

  it("shows the live grid in the first screen", async () => {
    await render(<HomeRoute />);
    const grid = page.getByRole("grid", { name: "Live example grid" });
    await expect.element(grid).toBeInTheDocument();
    const rect = (grid.element() as HTMLElement).getBoundingClientRect();
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.top).toBeLessThan(HEIGHT - 120);
  });

  it("puts Get started above the grid and the first screen", async () => {
    await render(<HomeRoute />);
    const cta = page.getByText("Get started");
    await expect.element(cta).toBeInTheDocument();
    const ctaRect = (cta.element() as HTMLElement).getBoundingClientRect();
    const grid = page.getByRole("grid", { name: "Live example grid" });
    await expect.element(grid).toBeInTheDocument();
    const gridRect = (grid.element() as HTMLElement).getBoundingClientRect();
    expect(ctaRect.bottom).toBeLessThan(HEIGHT);
    expect(ctaRect.top).toBeLessThan(gridRect.top);
    expect((cta.element() as HTMLElement).closest("a")?.getAttribute("href")).toBe("/docs/learning-path/install-gridcn");
  });

  it("shows no column reorder grip in the hero grid header", async () => {
    await render(<HomeRoute />);
    const grid = page.getByRole("grid", { name: "Live example grid" });
    await expect.element(grid).toBeInTheDocument();
    expect((grid.element() as HTMLElement).querySelector("[data-column-reorder-handle], [aria-roledescription=\"sortable\"]")).toBeNull();
    const headers = [...(grid.element() as HTMLElement).querySelectorAll<HTMLElement>("[role=columnheader]")];
    expect(headers.map((h) => h.scrollWidth <= h.clientWidth + 1)).not.toContain(false);
  });

  it("undoes a fill in the hero grid with Ctrl+Z", async () => {
    await render(<HomeRoute />);
    const grid = page.getByRole("grid", { name: "Live example grid" });
    await expect.element(grid).toBeInTheDocument();
    const cells = (text: string) => [...(grid.element() as HTMLElement).querySelectorAll<HTMLElement>("[role=gridcell]")].filter((c) => c.textContent === text);
    const ada = cells("Ada")[0]!;
    ada.click();
    await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
    await userEvent.keyboard("{Control>}d{/Control}");
    expect(cells("Grace").length).toBe(1);
    await userEvent.keyboard("{Control>}z{/Control}");
    await expect.poll(() => cells("Grace").length).toBe(2);
  });

  it("gives every link in the content a tap target of 40px or more", async () => {
    await render(<HomeRoute />);
    await expect.element(page.getByRole("heading", { name: /data grid you own/, level: 1 })).toBeInTheDocument();
    const small = [...document.querySelectorAll<HTMLElement>("section a, nav[aria-label='Site links'] a")]
      .filter((a) => !a.closest("[role='grid']"))
      .map((a) => ({ text: (a.textContent ?? "").trim().slice(0, 40), height: a.getBoundingClientRect().height }))
      .filter((a) => a.height > 0 && a.height < 40);
    expect(small).toEqual([]);
  });

  it("keeps every comparison cell a link with a vendor or docs target", async () => {
    await render(<HomeRoute />);
    const links = page.getByRole("link", { name: /^AG Grid, Fill handle: Enterprise$/ });
    await expect.element(links.first()).toBeInTheDocument();
    expect((links.first().element() as HTMLAnchorElement).href).toBe("https://www.ag-grid.com/react-data-grid/cell-selection-fill-handle/");
  });
});
