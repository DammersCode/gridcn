import Link from "next/link";
import { addOns, coreFeatures } from "../landing/_shared/data";
import { HeroActions, Install, ReleaseBadge, TAGLINE } from "../landing/_shared/hero";
import { GridMock } from "../landing/_shared/grid-mock";
import { ParityHeatmap, ParityLink, ParitySummary, PerfStats, SectionHead, ServerHighlights } from "../landing/_shared/parts";
import { DraftShell } from "../landing/_shared/shell";
import { BackdropVeil } from "../landing/_shared/veil";

// DEV-ONLY draft B "Split": text left, static grid picture right, bento below, veil strongest in the center column. Delete when a draft is chosen.
export default function LandingB() {
  return (
    <DraftShell name="B · Split">
      <BackdropVeil
        className="bg-background/55 backdrop-blur-sm"
        layers={["bg-background/30 backdrop-blur-lg [mask-image:linear-gradient(to_right,transparent,black_18%,black_82%,transparent)]"]}
      />
      <main className="relative z-10 flex w-full max-w-6xl flex-col gap-8 px-4 pb-16 pt-8 sm:px-6">
        <section className="grid items-center gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="flex flex-col items-start gap-4 border bg-card/90 p-6">
            <ReleaseBadge />
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">gridcn</h1>
            <p className="text-base text-muted-foreground">{TAGLINE}</p>
            <HeroActions />
            <Install />
          </div>
          <GridMock />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="border bg-card/90 p-4">
            <SectionHead title="One grid, every data mode" />
            <ParitySummary className="mb-3" />
            <ParityHeatmap />
            <p className="mt-3"><ParityLink>Read the full matrix →</ParityLink></p>
          </div>
          <div className="flex flex-col gap-3 border bg-card/90 p-4">
            <SectionHead title="Measured at 100k rows" />
            <PerfStats className="[&>ul]:grid-cols-1" />
          </div>
        </section>

        <section>
          <SectionHead title="Server mode, built in" />
          <ServerHighlights />
        </section>

        <section className="border bg-card/90 p-4">
          <SectionHead title="The rest of the kit" />
          <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {coreFeatures.map((f) => (
              <li key={f.title} className="text-sm">
                <span className="font-medium">{f.title}.</span>{" "}
                <span className="text-muted-foreground">{f.text}</span>
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
