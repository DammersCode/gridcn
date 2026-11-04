import Link from "next/link";
import { addOns, coreFeatures } from "../landing/_shared/data";
import { HeroActions, Install, ReleaseBadge, TAGLINE } from "../landing/_shared/hero";
import { LazyHeroDemo } from "../landing/_shared/lazy-demo";
import { ParityBars, ParityLink, ParitySummary, PerfStats, SectionHead, ServerHighlights } from "../landing/_shared/parts";
import { DraftShell } from "../landing/_shared/shell";
import { BackdropVeil } from "../landing/_shared/veil";

// DEV-ONLY draft A "Stack": centered hero, demo directly below, one tight column. Delete when a draft is chosen.
export default function LandingA() {
  return (
    <DraftShell name="A · Stack">
      <BackdropVeil className="bg-background/60 backdrop-blur-[3px]" />
      <main className="relative z-10 flex w-full max-w-5xl flex-col gap-10 px-4 pb-16 pt-10 sm:px-6">
        <section className="flex flex-col items-center gap-4 text-center">
          <ReleaseBadge />
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">gridcn</h1>
          <p className="max-w-2xl text-base text-muted-foreground sm:text-lg">{TAGLINE}</p>
          <HeroActions className="justify-center" />
          <Install />
        </section>

        <LazyHeroDemo className="h-[26rem]" />

        <section aria-labelledby="perf">
          <SectionHead title="Measured at 100k rows" />
          <span id="perf" className="sr-only">Performance</span>
          <PerfStats />
        </section>

        <section aria-labelledby="server">
          <SectionHead title="Server mode, built in">
            <ParityLink>Data modes in the docs →</ParityLink>
          </SectionHead>
          <ServerHighlights />
          <div className="mt-4 border bg-card p-4">
            <ParitySummary className="mb-3" />
            <ParityBars />
          </div>
        </section>

        <section aria-labelledby="core">
          <SectionHead title="The rest of the kit" />
          <ul className="grid gap-px border bg-border sm:grid-cols-3">
            {coreFeatures.map((f) => (
              <li key={f.title} className="bg-card p-3">
                <p className="text-sm font-medium">{f.title}</p>
                <p className="text-xs text-muted-foreground">{f.text}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            Add-ons:
            {addOns.map(([name, href]) => (
              <Link key={name} href={href} className="underline underline-offset-4 hover:text-foreground">
                {name}
              </Link>
            ))}
          </p>
        </section>
      </main>
    </DraftShell>
  );
}
