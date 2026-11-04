import Link from "next/link";
import type { ReactNode } from "react";
import { highlight } from "fumadocs-core/highlight";
import { InstallCommand } from "@/components/install-command";
import { SUBLINE } from "./data";
import { addOnTiles, agentSkills, AgentIcon, comparison, coreTraits, headlineFeatures } from "./content";
import { HeroActions, ReleaseBadge } from "./hero";
import { ParityLink, PerfStats, ServerHighlights } from "./parts";

export type LandingVariant = "base" | "agents" | "proof" | "dense";

const focus = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";
const tile = `flex h-full flex-col gap-1 p-3 transition-colors hover:bg-muted ${focus}`;
const CODE = `const columns = defineColumns<Person>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text" },
  { id: "age", header: "Age", accessorKey: "age", type: "number" },
] as const);

<DataGrid defaultData={rows} columns={columns} />`;
const installFit = "min-w-0 [&_pre]:whitespace-pre-wrap [&_pre]:break-all max-sm:[&_button]:min-h-10 max-sm:[&_button]:min-w-10";

async function HeroCode() {
  const code = await highlight(CODE, {
    lang: "tsx",
    themes: { light: "github-light", dark: "github-dark" },
    components: {
      pre: (props) => (
        <pre
          {...props}
          aria-label="Usage example"
          tabIndex={0}
          className="min-w-0 overflow-x-auto border p-4 text-start font-mono text-xs leading-relaxed max-sm:hidden dark:!bg-[var(--shiki-dark-bg)] dark:[&_span]:!text-[var(--shiki-dark)]"
        />
      ),
    },
  });
  return code;
}

function Panel({ id, title, intro, children, className }: { id: string; title: string; intro?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={`flex min-w-0 flex-col gap-3 border bg-card p-4 ${className ?? ""}`}>
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
            <p className="text-xs text-muted-foreground">
              {comparison.columns.map((c, i) => (
                <span key={c} className="me-3 inline-block">
                  <span className={i === 0 ? "font-semibold text-primary" : ""}>{c.replace(" Table", "")}</span> {values[i]}
                </span>
              ))}
            </p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Tiers as of 09/2026 (AG Grid v36, MUI X v9, TanStack Table v9). Vendors change tiers: verify before relying on this.</p>
    </>
  );
}

function TileGrid({ children, className }: { children: ReactNode; className: string }) {
  return <ul className={`grid gap-px border bg-border ${className}`}>{children}</ul>;
}

function Hero({ withStats }: { withStats?: boolean }) {
  return (
    <section className="flex flex-col gap-5 border bg-card p-6 sm:p-7">
      <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="flex min-w-0 flex-col items-center gap-3 text-center lg:items-start lg:text-start">
          <ReleaseBadge />
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Spreadsheet power. Fast, typed, complete.</h1>
          <p className="text-lg font-medium sm:text-xl">{SUBLINE}</p>
          <p className="text-sm text-muted-foreground">
            Sort, filter, edit and paste like Excel. One command copies the code into your app: you own the code and install no gridcn runtime package.
          </p>
          <HeroActions className="justify-center lg:justify-start" />
          <div className={`w-full max-w-md text-start ${installFit}`}>
            <InstallCommand item="data-grid" />
          </div>
          <Link href="/docs/agent-skills" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium underline underline-offset-4">
            <AgentIcon className="size-4" aria-hidden="true" />
            Building with an AI agent? Install the gridcn agent skills
          </Link>
        </div>
        <HeroCode />
      </div>
      {withStats && <PerfStats />}
    </section>
  );
}

function KitPanel() {
  const capabilities = [...headlineFeatures.map((f) => ({ ...f, href: undefined as string | undefined })), ...coreTraits];
  return (
    <Panel id="kit" title="What you get" intro="Range selection, spreadsheet paste and a fill handle are paid features in the big grids. gridcn ships them free, built the shadcn way.">
      <TileGrid className="grid-cols-2 lg:grid-cols-4">
        {capabilities.map(({ icon: Icon, title, text, href }) => (
          <li key={title} className="bg-card">
            {href ? (
              <Link href={href} className={tile}>
                <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                <h3 className="text-sm font-medium">{title}</h3>
                <span className="text-xs text-muted-foreground max-sm:line-clamp-1">{text}</span>
              </Link>
            ) : (
              <div className={tile}>
                <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                <h3 className="text-sm font-medium">{title}</h3>
                <span className="text-xs text-muted-foreground max-sm:line-clamp-1">{text}</span>
              </div>
            )}
          </li>
        ))}
      </TileGrid>
    </Panel>
  );
}

function ServerPanel() {
  return (
    <Panel id="server" title="Server mode, built in" intro="Local array or server pages: the same grid, the same features.">
      <ServerHighlights columns="grid-cols-2 lg:grid-cols-3" />
      <ParityLink>Which features work in which data mode →</ParityLink>
    </Panel>
  );
}

function PerfPanel() {
  return (
    <Panel id="perf" title="Measured at 100k rows">
      <PerfStats />
    </Panel>
  );
}

function ComparePanel() {
  return (
    <Panel id="compare" title="The gap, quantified" intro="Where the same features sit in the grids you are probably comparing: free tier, paid tier or your own code.">
      <CompareTable />
    </Panel>
  );
}

function AgentsPanel({ wide }: { wide?: boolean }) {
  return (
    <Panel id="agents" title="Your coding agent knows gridcn" intro="Five skills for Claude Code, Cursor, Codex and other agents: the procedures and silent traps the docs alone cannot enforce.">
      <div className={`w-full max-w-md ${installFit}`}>
        <InstallCommand command="skills add DammersCode/gridcn" />
      </div>
      <TileGrid className={wide ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-5" : "grid-cols-1"}>
        {agentSkills.map(({ icon: Icon, title, text }) => (
          <li key={title} className="bg-card">
            <Link href={`/docs/agent-skills#${title}`} className={tile}>
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              <h3 className="font-mono text-xs font-medium">{title}</h3>
              <span className="text-xs text-muted-foreground">{text}</span>
            </Link>
          </li>
        ))}
      </TileGrid>
    </Panel>
  );
}

function AddOnsPanel({ wide }: { wide?: boolean }) {
  return (
    <Panel id="addons" title="Modular by design" intro="The core is selection, keyboard, editing, cell types, clipboard and validation. Each add-on is a separate registry item: install only the ones you want.">
      <TileGrid className={wide ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-2"}>
        {addOnTiles.map(({ icon: Icon, title, href }) => (
          <li key={title} className="bg-card">
            <Link
              href={href}
              className={`flex h-full min-h-16 flex-col items-center justify-center gap-1.5 p-2 text-center text-xs transition-colors hover:bg-muted ${wide ? "" : "lg:min-h-12 lg:flex-row lg:justify-start lg:px-3 lg:text-start"} ${focus}`}
            >
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              {title}
            </Link>
          </li>
        ))}
      </TileGrid>
    </Panel>
  );
}

const pair = "grid items-start gap-4 lg:grid-cols-2";

export function LandingContent({ variant = "base" }: { variant?: LandingVariant }) {
  return (
    <div className="relative z-10 flex w-full max-w-5xl flex-col gap-4 px-4 pb-12 pt-6 sm:px-6">
      <Hero withStats={variant === "proof"} />
      {variant === "base" && (
        <>
          <KitPanel />
          <ServerPanel />
          <PerfPanel />
          <ComparePanel />
          <div className={pair}>
            <AgentsPanel />
            <AddOnsPanel />
          </div>
        </>
      )}
      {variant === "agents" && (
        <>
          <AgentsPanel wide />
          <ServerPanel />
          <PerfPanel />
          <KitPanel />
          <ComparePanel />
          <AddOnsPanel wide />
        </>
      )}
      {variant === "proof" && (
        <>
          <ServerPanel />
          <KitPanel />
          <ComparePanel />
          <div className={pair}>
            <AgentsPanel />
            <AddOnsPanel />
          </div>
        </>
      )}
      {variant === "dense" && (
        <>
          <div className={pair}>
            <KitPanel />
            <ServerPanel />
          </div>
          <PerfPanel />
          <div className={pair}>
            <ComparePanel />
            <AgentsPanel />
          </div>
          <AddOnsPanel wide />
        </>
      )}
    </div>
  );
}
