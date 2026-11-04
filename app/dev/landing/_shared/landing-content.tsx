import Link from "next/link";
import type { ReactNode } from "react";
import { InstallCommand } from "@/components/install-command";
import { PLAIN_PITCH } from "./data";
import { addOnTiles, agentSkills, AgentIcon, comparison, coreTraits, headlineFeatures } from "./content";
import { HeroActions, ReleaseBadge } from "./hero";
import { ParityBars, ParityLegend, ParityLink, ParitySummary, PerfStats, ServerHighlights } from "./parts";

const focus = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";
const tile = `flex h-full flex-col gap-1 p-3 transition-colors hover:bg-muted ${focus}`;
const installFit = "min-w-0 [&_pre]:whitespace-pre-wrap [&_pre]:break-all max-sm:[&_button]:min-h-10 max-sm:[&_button]:min-w-10";

function Panel({ id, title, intro, children, className }: { id: string; title: string; intro?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={`flex flex-col gap-3 border bg-card p-4 ${className ?? ""}`}>
      <div>
        <h2 id={id} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {intro && <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

function TileGrid({ children, className }: { children: ReactNode; className: string }) {
  return <ul className={`grid gap-px border bg-border ${className}`}>{children}</ul>;
}

export function LandingContent() {
  const capabilities = [
    ...headlineFeatures.map((f) => ({ ...f, href: undefined as string | undefined })),
    ...coreTraits,
  ];
  return (
    <div className="relative z-10 flex w-full max-w-5xl flex-col gap-4 px-4 pb-12 pt-6 sm:px-6">
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-3 border bg-card p-6 text-center sm:p-7">
        <ReleaseBadge />
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">gridcn</h1>
        <p className="text-lg font-medium sm:text-xl">{PLAIN_PITCH}</p>
        <p className="text-sm text-muted-foreground">
          Sort, filter, edit and paste like Excel. One command copies the code into your app: you own it, no npm dependency.{" "}
          <Link href="#perf" className="inline-block py-2 underline underline-offset-4">
            See the numbers
          </Link>
          .
        </p>
        <HeroActions className="justify-center" />
        <div className={`w-full max-w-md text-start ${installFit}`}>
          <InstallCommand item="data-grid" />
        </div>
        <Link href="/docs/agent-skills" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium underline underline-offset-4">
          <AgentIcon className="size-4" aria-hidden="true" />
          Building with an AI agent? Install the gridcn agent skills
        </Link>
      </section>


      <Panel id="kit" title="What you get" intro="Range selection, spreadsheet paste and a fill handle are paid features in the big grids. gridcn ships them open source, built the shadcn way.">
        <TileGrid className="grid-cols-2 lg:grid-cols-4">
          {capabilities.map(({ icon: Icon, title, text, href }) => (
            <li key={title} className="bg-card">
              {href ? (
                <Link href={href} className={tile}>
                  <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="text-sm font-medium">{title}</span>
                  <span className="text-xs text-muted-foreground">{text}</span>
                </Link>
              ) : (
                <div className={tile}>
                  <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="text-sm font-medium">{title}</span>
                  <span className="text-xs text-muted-foreground">{text}</span>
                </div>
              )}
            </li>
          ))}
        </TileGrid>
      </Panel>

      <Panel id="server" title="Server mode, built in" intro="Local array or server pages: the same grid, the same features.">
        <ServerHighlights columns="grid-cols-2 lg:grid-cols-3" />
      </Panel>

      <div className="flex flex-col gap-4">
        <Panel id="parity" title="One grid, every data mode">
          <ParitySummary />
          <ParityBars />
          <ParityLegend />
          <ParityLink>Full matrix in the docs →</ParityLink>
        </Panel>
        <Panel id="perf" title="Measured at 100k rows">
          <PerfStats />
        </Panel>
      </div>

      <Panel id="compare" title="The gap, quantified" intro="Where the same features sit in the grids you are probably comparing: free tier, paid tier or your own code.">
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  Capability
                </th>
                {comparison.columns.map((c) => (
                  <th key={c} scope="col" className={c === "gridcn" ? "px-3 py-2 text-center font-semibold text-primary" : "px-3 py-2 text-center font-medium"}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map(({ feature, values }) => (
                <tr key={feature} className="border-b last:border-0">
                  <th scope="row" className="px-3 py-2 text-start font-medium">
                    {feature}
                  </th>
                  {values.map((v, i) => (
                    <td key={i} className={i === 0 ? "px-3 py-2 text-center font-medium" : "px-3 py-2 text-center text-muted-foreground"}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="grid gap-2 sm:hidden">
          {comparison.rows.map(({ feature, values }) => (
            <li key={feature} className="border p-3 text-sm">
              <p className="mb-1 font-medium">{feature}</p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                {comparison.columns.map((c, i) => (
                  <div key={c} className="flex justify-between gap-2">
                    <dt className={i === 0 ? "font-semibold text-primary" : "text-muted-foreground"}>{c}</dt>
                    <dd className={i === 0 ? "font-medium" : "text-muted-foreground"}>{values[i]}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">Tiers as of 09/2026 (AG Grid v36, MUI X v9, TanStack Table v9). Vendors change tiers: verify before relying on this.</p>
      </Panel>

      <Panel id="agents" title="Your coding agent knows gridcn" intro="Five skills for Claude Code, Cursor, Codex and other agents: the procedures and silent traps the docs alone cannot enforce.">
        <div className={`w-full max-w-md ${installFit}`}>
          <InstallCommand command="skills add DammersCode/gridcn" />
        </div>
        <TileGrid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 max-sm:[&>li:nth-child(n+4)]:hidden">
          {agentSkills.map(({ icon: Icon, title, text }) => (
            <li key={title} className="bg-card">
              <Link href={`/docs/agent-skills#${title}`} className={tile}>
                <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                <span className="font-mono text-xs font-medium">{title}</span>
                <span className="text-xs text-muted-foreground">{text}</span>
              </Link>
            </li>
          ))}
        </TileGrid>
        <Link href="/docs/agent-skills" className="inline-flex min-h-10 items-center text-sm underline underline-offset-4 sm:hidden">All five skills →</Link>
      </Panel>

      <Panel id="addons" title="Modular by design" intro="The core is selection, keyboard, editing, cell types, clipboard and validation. Each add-on is a separate registry item: install only the ones you want.">
        <TileGrid className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {addOnTiles.map(({ icon: Icon, title, href }) => (
            <li key={title} className="bg-card">
              <Link href={href} className={`flex h-full min-h-16 flex-col items-center justify-center gap-1.5 p-2 text-center text-xs transition-colors hover:bg-muted ${focus}`}>
                <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                {title}
              </Link>
            </li>
          ))}
        </TileGrid>
      </Panel>

      <footer className="mx-auto flex w-full max-w-3xl flex-col items-center gap-3 border bg-card p-6 text-center">
        <h2 className="text-lg font-semibold tracking-tight">Start in one command</h2>
        <HeroActions className="justify-center" />
      </footer>
    </div>
  );
}
