import Link from "next/link";
import type { ReactNode } from "react";
import { InstallCommand } from "@/components/install-command";
import { gitConfig } from "@/lib/shared";
import { CLIENT_CODE, HEADLINE, newInTwo, SERVER_CODE, SUBLINE } from "./data";
import { Code } from "./code";
import { HeroGrid } from "./hero-grid";
import { addOnTiles, agentSkills, COMPARISON_DATE, comparison, FEATURE_MATRIX_HREF, kitTiles } from "./items";
import { HeroActions, ReleaseBadge } from "./hero";
import { DataModesLink, focus, PerfStats, ServerHighlights, SiteLink } from "./parts";

const tile = `flex h-full flex-col gap-1 p-3 transition-colors hover:bg-muted ${focus}`;
const repo = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

const installFit = "min-w-0 [&_pre]:whitespace-pre-wrap [&_pre]:break-all max-sm:[&_button]:min-h-10 max-sm:[&_button]:min-w-10";

function Panel({ id, title, intro, children, className }: { id: string; title: string; intro?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={`flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 ${className ?? ""}`}>
      <div>
        <h2 id={id} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {intro && <p className="mt-1 max-w-prose text-base leading-relaxed text-muted-foreground">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

function TileGrid({ children, className }: { children: ReactNode; className: string }) {
  return <ul className={`grid gap-px overflow-hidden rounded-lg border bg-border ${className}`}>{children}</ul>;
}

function Hero() {
  return (
    <section aria-labelledby="hero" className="grid gap-x-8 gap-y-4 rounded-lg border bg-card p-6 sm:p-7 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col items-center gap-3 text-center lg:col-start-1 lg:row-start-1 lg:items-start lg:text-start">
        <ReleaseBadge />
        <h1 id="hero" className="text-3xl font-bold tracking-tight sm:text-5xl">
          {HEADLINE}
        </h1>
        <p className="text-base font-medium sm:text-xl">{SUBLINE}</p>
        <HeroActions className="justify-center lg:justify-start" />
      </div>
      <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
        <HeroGrid />
      </div>
      <div className="flex min-w-0 flex-col items-center gap-2 text-center lg:col-start-1 lg:row-start-2 lg:items-start lg:text-start">
        <div className={`w-full max-w-md text-start ${installFit}`}>
          <InstallCommand item="data-grid" />
        </div>
        <p className="text-sm text-muted-foreground">
          Needs a shadcn/ui project, React 19 and Tailwind v4.{" "}
          <Link href="/docs/learning-path/install-gridcn" className="inline-flex min-h-10 items-center underline underline-offset-4">
            Install guide
          </Link>
        </p>
      </div>
    </section>
  );
}

function KitPanel() {
  return (
    <Panel id="kit" title="What you get" intro={<>Range selection, paste from Excel and a fill handle cost a paid tier in AG Grid and MUI X. In gridcn they are free.</>}>
      <TileGrid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {kitTiles.map(({ icon: Icon, title, text, href }) => (
          <li key={title} className="bg-card">
            <Link href={href} className={tile}>
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              <h3 className="text-sm font-medium">{title}</h3>
              <span className="text-sm leading-relaxed text-muted-foreground">{text}</span>
            </Link>
          </li>
        ))}
      </TileGrid>
      <Link href="/docs/support-upgrades/license-credits" className="inline-flex min-h-10 items-center text-sm underline underline-offset-4">
        Free under the Apache License 2.0
      </Link>
    </Panel>
  );
}

function NewPanel() {
  return (
    <Panel id="new" title="What is new in 2.0">
      <ul className="grid gap-1 text-sm">
        {newInTwo.map(({ text, href }) => (
          <li key={href + text}>
            <Link href={href} className={`flex min-h-10 items-center border px-3 py-2 transition-colors hover:bg-muted ${focus}`}>
              {text}
            </Link>
          </li>
        ))}
      </ul>
      <SiteLink href={`${repo}/blob/${gitConfig.branch}/CHANGELOG.md`} className="inline-flex min-h-10 items-center text-sm underline underline-offset-4">
        Every change is in the changelog
      </SiteLink>
    </Panel>
  );
}

function StartPanel() {
  return (
    <Panel id="start" title="Your first grid" intro="Run the install command, then add this file. The grid needs a bounded height, here h-96.">
      <Code code={CLIENT_CODE} label="Client grid example" />
      <Link href="/docs/learning-path/render-your-first-grid" className="inline-flex min-h-10 items-center text-sm underline underline-offset-4">
        Render your first grid, step by step
      </Link>
    </Panel>
  );
}

function ServerPanel() {
  return (
    <Panel id="server" title="Server mode" intro="A local array or server rows: the same grid. The grid sends the sort, the filter and the search text. You answer with rows.">
      <Code code={SERVER_CODE} label="Server rows example" />
      <ServerHighlights />
      <DataModesLink>Which feature works in which data mode</DataModesLink>
    </Panel>
  );
}

function PerfPanel() {
  return (
    <Panel id="perf" title="Tested at 100,000 rows">
      <PerfStats />
    </Panel>
  );
}

function CompareTable() {
  return (
    <>
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
            {comparison.rows.map(({ feature, cells }) => (
              <tr key={feature} className="border-b last:border-0">
                <th scope="row" className="px-3 py-2 text-start font-medium">
                  {feature}
                </th>
                {cells.map((cell, i) => (
                  <td key={comparison.columns[i]} className="px-1 py-1 text-center">
                    <SiteLink
                      href={cell.href}
                      aria-label={`${comparison.columns[i]}, ${feature}: ${cell.value}`}
                      className={`inline-flex min-h-10 items-center px-2 hover:underline underline-offset-4 ${i === 0 ? "font-medium" : "text-muted-foreground"} ${focus}`}
                    >
                      {cell.value}
                    </SiteLink>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-2 sm:hidden">
        {comparison.rows.map(({ feature, cells }) => (
          <li key={feature} className="border p-3 text-sm">
            <p className="font-medium">{feature}</p>
            <ul className="mt-1 grid grid-cols-3 gap-x-2 text-xs">
              {cells.map((cell, i) => (
                <li key={comparison.columns[i]}>
                  <SiteLink
                    href={cell.href}
                    aria-label={`${comparison.columns[i]}, ${feature}: ${cell.value}`}
                    className={`inline-flex min-h-10 items-center gap-1 ${focus}`}
                  >
                    <span className={i === 0 ? "font-semibold text-primary" : "text-foreground"}>{comparison.columns[i]}</span>
                    <span className="text-muted-foreground">{cell.value}</span>
                  </SiteLink>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </>
  );
}

function ComparePanel() {
  return (
    <Panel
      id="compare"
      title="How gridcn compares"
      intro="Each cell links to the page that states it. gridcn ships the editing features free. It does not build row grouping, tree data, pivoting or master-detail."
    >
      <CompareTable />
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        Checked on {COMPARISON_DATE} against the vendors&apos; public documentation pages. Vendors change tiers: check the linked page.{" "}
        <Link href={FEATURE_MATRIX_HREF} className="inline-flex min-h-10 items-center underline underline-offset-4">
          Feature matrix of gridcn
        </Link>
      </p>
    </Panel>
  );
}

function AgentsPanel() {
  return (
    <Panel id="agents" title="Skills for your coding agent" intro="Five skills for Claude Code, Cursor, Codex and other agents. Each one is a step-by-step procedure for one gridcn task.">
      <div className={`w-full max-w-md ${installFit}`}>
        <InstallCommand command="skills add DammersCode/gridcn" />
      </div>
      <TileGrid className="grid-cols-1">
        {agentSkills.map(({ icon: Icon, title, text }) => (
          <li key={title} className="bg-card">
            <Link href={`/docs/try-automate/use-agent-skills#${title}`} className={tile}>
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              <h3 className="font-mono text-sm font-medium">{title}</h3>
              <span className="text-sm leading-relaxed text-muted-foreground">{text}</span>
            </Link>
          </li>
        ))}
      </TileGrid>
    </Panel>
  );
}

function AddOnsPanel() {
  return (
    <Panel id="addons" title="Modular by design" intro="Each add-on is a separate registry item. Install only the ones you want.">
      <TileGrid className="grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
        {addOnTiles.map(({ icon: Icon, title, href }) => (
          <li key={title} className="bg-card">
            <Link
              href={href}
              className={`flex h-full min-h-16 flex-col items-center justify-center gap-1.5 p-2 text-center text-sm transition-colors hover:bg-muted ${focus}`}
            >
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              {title}
            </Link>
          </li>
        ))}
      </TileGrid>
      <Link href="/docs/fit-features/add-ons-a-z" className="inline-flex min-h-10 items-center text-sm underline underline-offset-4">
        Every add-on, A to Z
      </Link>
    </Panel>
  );
}

function FooterLinks() {
  const links = [
    { label: "Docs", href: "/docs" },
    { label: "Accessibility gaps", href: "/docs/accessibility/accessibility-gaps" },
    { label: "License", href: "/docs/support-upgrades/license-credits" },
    { label: "Changelog", href: `${repo}/blob/${gitConfig.branch}/CHANGELOG.md` },
    { label: "GitHub", href: repo },
  ];
  return (
    <footer>
    <nav aria-label="More" className="flex flex-wrap justify-center gap-x-4 text-sm">
      {links.map((l) => (
        <SiteLink key={l.label} href={l.href} className={`inline-flex min-h-10 items-center underline underline-offset-4 ${focus}`}>
          {l.label}
        </SiteLink>
      ))}
    </nav>
    </footer>
  );
}

export function LandingPage() {
  return (
    <div className="relative z-10 flex w-full max-w-5xl flex-col gap-4 px-4 pb-12 pt-6 sm:px-6">
      <Hero />
      <KitPanel />
      <StartPanel />
      <NewPanel />
      <PerfPanel />
      <ServerPanel />
      <ComparePanel />
      <AgentsPanel />
      <AddOnsPanel />
      <FooterLinks />
    </div>
  );
}
