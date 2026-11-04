import Link from "next/link";
import { PLAIN_PITCH, addOns, coreFeatures } from "../landing/_shared/data";
import { HeroActions, Install, ReleaseBadge} from "../landing/_shared/hero";
import { GridMock } from "../landing/_shared/grid-mock";
import { ParityCounts, ParityModeList, ParityLink, ParitySummary, PerfStats, ServerHighlights } from "../landing/_shared/parts";
import { DraftShell } from "../landing/_shared/shell";
import { Tabs } from "../landing/_shared/tabs";
import { BackdropVeil } from "../landing/_shared/veil";

// DEV-ONLY draft C "Tabs": short hero, grid, then one tabbed panel so the page is two screens. Delete when a draft is chosen.
export default function LandingC() {
  return (
    <DraftShell name="C · Tabs">
      <BackdropVeil className="bg-background/55 backdrop-blur-[3px]" />
      <div className="relative z-10 flex w-full max-w-5xl flex-col gap-6 px-4 pb-12 pt-8 sm:px-6">
        <section className="flex flex-col items-center gap-3 text-center">
          <ReleaseBadge />
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">gridcn</h1>
          <p className="max-w-2xl text-lg font-medium sm:text-xl">{PLAIN_PITCH}</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <HeroActions />
          </div>
          <Install />
        </section>

        <GridMock />

        <Tabs
          tabs={[
            {
              label: "Server mode",
              panel: (
                <div className="flex flex-col gap-3">
                  <ServerHighlights columns="sm:grid-cols-2 lg:grid-cols-4" />
                </div>
              ),
            },
            {
              label: "Local and server parity",
              panel: (
                <div className="flex flex-col gap-3">
                  <ParitySummary />
                  <div className="hidden sm:block"><ParityCounts /></div>
                  <div className="sm:hidden"><ParityModeList /></div>
                  <ParityLink>Read the full matrix →</ParityLink>
                </div>
              ),
            },
            { label: "Performance", panel: <PerfStats /> },
            {
              label: "The kit",
              panel: (
                <div className="flex flex-col gap-3">
                  <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                    {coreFeatures.map((f) => (
                      <li key={f.title} className="text-sm">
                        <span className="font-medium">{f.title}.</span>{" "}
                        <span className="text-muted-foreground">{f.text}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    Add-ons:
                    {addOns.map(([name, href]) => (
                      <Link key={name} href={href} className="inline-flex min-h-10 items-center underline underline-offset-4 hover:text-foreground">
                        {name}
                      </Link>
                    ))}
                  </p>
                </div>
              ),
            },
          ]}
        />
      </div>
    </DraftShell>
  );
}
