import type { ComponentProps } from "react";
import { page } from "vitest/browser";
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
    await expect.element(page.getByRole("heading", { name: "gridcn", level: 1 })).toBeInTheDocument();
    // let layout settle: fonts, the shader canvas resize, and the demo grid's re-fit after resize
    await new Promise((r) => setTimeout(r, 400));
    const h1 = page.getByRole("heading", { name: "gridcn", level: 1 }).element() as HTMLElement;

    // all five content sections rendered — without them the scrollWidth check below is vacuous
    expect(document.querySelectorAll("h2").length).toBe(5);

    // the h1's parent is the tagline card (border bg-card max-w-2xl flex-col)
    const heroCard = h1.parentElement as HTMLElement;
    expect(heroCard, "hero card holds the h1").not.toBeNull();
    expect(heroCard.offsetParent, "hero card is visible").not.toBeNull();
    expect(heroCard.clientWidth).toBeLessThanOrEqual(WIDTH);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(WIDTH);

    await page.screenshot();
  });
});
