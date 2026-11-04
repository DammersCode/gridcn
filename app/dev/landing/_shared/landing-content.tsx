import Link from "next/link";
import type { ReactNode } from "react";
import { InstallCommand } from "@/components/install-command";
import { PLAIN_PITCH } from "./data";
import { addOnTiles, agentSkills, AgentIcon, comparison, coreTraits, headlineFeatures } from "./content";
import { GridMock } from "./grid-mock";
import { HeroActions, ReleaseBadge } from "./hero";
import { ParityBars, ParityLegend, ParityLink, ParitySummary, PerfStats, ServerHighlights } from "./parts";

function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex w-fit max-w-full flex-col gap-1 border bg-card px-4 py-3">
        <h2 id={id} className="text-xl font-semibold tracking-tight">
          {title}
        </h2>
        {intro && <p className="max-w-2xl text-sm text-muted-foreground">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="border bg-card p-4">{children}</div>;
}

const tile = "flex h-full flex-col gap-1 bg-card p-4 transition-colors hover:bg-muted";

export function LandingContent() {
  return (
    <div className="relative z-10 flex w-full max-w-5xl flex-col gap-8 px-4 pb-16 pt-8 sm:px-6">
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 border bg-card p-6 text-center sm:p-8">
        <ReleaseBadge />
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">gridcn</h1>
        <p className="text-lg font-medium sm:text-xl">{PLAIN_PITCH}</p>
        <HeroActions className="justify-center" />
        <div className="w-full max-w-md min-w-0 text-start">
          <InstallCommand item="data-grid" />
        </div>
        <Link
          href="/docs/agent-skills"
          className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium underline underline-offset-4"
        >
          <AgentIcon className="size-4" aria-hidden="true" />
          Building with an AI agent? Install the gridcn agent skills
        </Link>
      </section>

      <GridMock />

      <Section id="gap" title="The gap gridcn fills" intro="Range selection, spreadsheet paste and a fill handle are paid features in the big grids. gridcn ships them open source: core plus one-line add-ons.">
        <ul className="grid gap-px border bg-border sm:grid-cols-3">
          {headlineFeatures.map(({ icon: Icon, title, text }) => (
            <li key={title} className="bg-card p-4">
              <Icon className="mb-2 size-5 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium">{title}</p>
              <p className="text-xs text-muted-foreground">{text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="server" title="Server mode, built in" intro="Local array or server pages: the same grid, the same features.">
        <ServerHighlights />
        <Panel>
          <ParitySummary className="mb-3" />
          <ParityBars />
          <ParityLegend />
          <p className="mt-2">
            <ParityLink>Full matrix in the docs →</ParityLink>
          </p>
        </Panel>
      </Section>

      <Section id="perf" title="Measured at 100k rows">
        <PerfStats />
      </Section>

      <Section id="shadcn" title="Built the shadcn way">
        <ul className="grid gap-px border bg-border sm:grid-cols-2 lg:grid-cols-5">
          {coreTraits.map(({ icon: Icon, title, text, href }) => (
            <li key={title} className="bg-card">
              <Link href={href} className={tile}>
                <Icon className="mb-1 size-5 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm font-medium">{title}</span>
                <span className="text-xs text-muted-foreground">{text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="compare" title="The gap, quantified" intro="Where the same features sit in the grids you are probably comparing: free tier, paid tier or your own code.">
        <div className="overflow-x-auto border bg-card">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b bg-muted">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-start font-medium">
                  Capability
                </th>
                {comparison.columns.map((c) => (
                  <th key={c} scope="col" className={c === "gridcn" ? "px-4 py-2.5 text-center font-semibold text-primary" : "px-4 py-2.5 text-center font-medium"}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map(({ feature, values }) => (
                <tr key={feature} className="border-b last:border-0">
                  <th scope="row" className="px-4 py-2.5 text-start font-medium">
                    {feature}
                  </th>
                  {values.map((v, i) => (
                    <td key={i} className={i === 0 ? "px-4 py-2.5 text-center font-medium" : "px-4 py-2.5 text-center text-muted-foreground"}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="w-fit max-w-full border bg-card px-3 py-2 text-xs text-muted-foreground">
          Tiers as of 09/2026 (AG Grid v36, MUI X v9, TanStack Table v9). Vendors change tiers: verify before relying on this.
        </p>
      </Section>

      <Section id="agents" title="Your coding agent knows gridcn" intro="Five skills for Claude Code, Cursor, Codex and other agents: the procedures and silent traps the docs alone cannot enforce.">
        <div className="w-full max-w-md border bg-card p-2">
          <InstallCommand command="skills add DammersCode/gridcn" />
        </div>
        <ul className="grid gap-px border bg-border sm:grid-cols-2 lg:grid-cols-5">
          {agentSkills.map(({ icon: Icon, title, text }) => (
            <li key={title} className="bg-card">
              <Link href={`/docs/agent-skills#${title}`} className={tile}>
                <Icon className="mb-1 size-5 text-muted-foreground" aria-hidden="true" />
                <span className="font-mono text-xs font-medium">{title}</span>
                <span className="text-xs text-muted-foreground">{text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="addons" title="Modular by design" intro="The core is selection, keyboard, editing, cell types, clipboard and validation. Add-ons are separate registry items you install only if you want them.">
        <ul className="grid grid-cols-2 gap-px border bg-border sm:grid-cols-4 lg:grid-cols-7">
          {addOnTiles.map(({ icon: Icon, title, href }) => (
            <li key={title} className="bg-card">
              <Link href={href} className="flex h-full min-h-20 flex-col items-center justify-center gap-2 p-3 text-center text-sm transition-colors hover:bg-muted">
                <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
                {title}
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

