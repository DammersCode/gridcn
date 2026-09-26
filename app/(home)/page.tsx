import Link from "next/link";
import type { ComponentProps } from "react";
import {
  ArrowUpDown,
  Blocks,
  Bot,
  Clipboard,
  CloudDownload,
  Database,
  FileSpreadsheet,
  Gauge,
  Keyboard,
  Languages,
  LayoutGrid,
  Link2,
  ListOrdered,
  MousePointer2,
  PaintBucket,
  Palette,
  Pencil,
  Pin,
  Radio,
  RefreshCw,
  Shapes,
  Undo2,
  Users,
} from "lucide-react";
import { Card, Cards } from "fumadocs-ui/components/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HeroShader } from "@/components/hero-shader";
import { InstallCommand } from "@/components/install-command";
import DataGridDemo from "@/registry/default/examples/data-grid-demo";
import { gitConfig } from "@/lib/shared";

/** Inline GitHub mark — lucide-react ships no "Github" icon. */
function GithubIcon(props: ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.1 3.29 9.4 7.86 10.94.57.1.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.34-1.28-1.69-1.28-1.69-1.04-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.2-3.09-.12-.29-.52-1.48.11-3.08 0 0 .97-.31 3.2 1.18a11 11 0 0 1 5.82 0c2.22-1.49 3.19-1.18 3.19-1.18.64 1.6.24 2.79.12 3.08.75.8 1.2 1.83 1.2 3.09 0 4.43-2.7 5.4-5.26 5.69.41.36.78 1.07.78 2.15 0 1.56-.01 2.81-.01 3.19 0 .3.21.66.8.55A11.5 11.5 0 0 0 23.5 12c0-6.27-5.23-11.5-11.5-11.5Z" />
    </svg>
  );
}

const headlineFeatures = [
  {
    icon: MousePointer2,
    title: "Range selection",
    description:
      "Anchor + rectangular range, ctrl-click multi-range, full row/column channels, keyboard-driven extension.",
  },
  {
    icon: Clipboard,
    title: "Spreadsheet clipboard",
    description:
      "Native copy/cut/paste with TSV + HTML table formats — pastes to and from Excel, Google Sheets, Apple Numbers, and other spreadsheets.",
  },
  {
    icon: PaintBucket,
    title: "Fill handle",
    description:
      'Drag to tile a selection, with series inference — arithmetic runs, zero-padded numbers, "Item 1" → "Item 2".',
  },
];

const coreTraits = [
  {
    icon: LayoutGrid,
    title: "Real DOM, real virtualization",
    description:
      "CSS Grid + subgrid, windowed row rendering, smooth at 100k rows.",
    href: "/docs/performance",
  },
  {
    icon: Keyboard,
    title: "Typed columns",
    description:
      "defineColumns<TData>() infers value types and per-cell-type options; typos are compile errors.",
    href: "/docs/quick-start#define-columns",
  },
  {
    icon: Palette,
    title: "shadcn tokens only",
    description:
      "No bespoke palette, no extra CSS files — dark mode works the moment your theme does.",
    href: "/docs/styling-theming",
  },
  {
    icon: Radio,
    title: "Streaming updates",
    description:
      "updateCells / updateRows push live rows into the view — incremental sort stays single-digit ms at 100k rows.",
    href: "/docs/streaming-updates",
  },
  {
    icon: Languages,
    title: "i18n & RTL ready",
    description:
      "Typed label objects for every UI string, full RTL with mirrored pinning and pointer math.",
    href: "/docs/i18n",
  },
];

const perfStats = [
  {
    value: "~33 MB",
    title: "working set @ 100k rows",
    description:
      "Mount footprint of a production build — comparators measure 170–300 MB in the same harness.",
  },
  {
    value: "0 renders",
    title: "React re-renders on scroll",
    description:
      "Row and column windowing moves one CSS transform per tick; the store never invalidates during a scroll.",
  },
  {
    value: "0.3–7.6 ms",
    title: "incremental sort @ 100k",
    description:
      "Re-sorts the visible index in place for k = 1 → 256 changed rows instead of rebuilding the whole view.",
  },
];

const addOns = [
  { icon: PaintBucket, title: "Fill handle", href: "/docs/addons/fill" },
  { icon: Undo2, title: "Undo & redo", href: "/docs/addons/undo-redo" },
  {
    icon: ArrowUpDown,
    title: "Sorting & filtering",
    href: "/docs/sorting-filtering-search",
  },
  {
    icon: FileSpreadsheet,
    title: "Import & export",
    href: "/docs/addons/import-export",
  },
  { icon: Link2, title: "URL state", href: "/docs/addons/url-state" },
  {
    icon: Blocks,
    title: "Context menu",
    href: "/docs/columns",
  },
  {
    icon: MousePointer2,
    title: "Keybindings dialog",
    href: "/docs/selection-keyboard",
  },
  {
    icon: ArrowUpDown,
    title: "Toolbar & search",
    href: "/docs/sorting-filtering-search",
  },
  {
    icon: ArrowUpDown,
    title: "Sort list",
    href: "/docs/sorting-filtering-search",
  },
  { icon: Pin, title: "Pinned rows", href: "/docs/addons/pinned-rows" },
  { icon: Users, title: "Multiplayer presence", href: "/docs/addons/presence" },
  { icon: CloudDownload, title: "Lazy loading", href: "/docs/lazy-loading" },
  { icon: ListOrdered, title: "Pagination", href: "/docs/pagination" },
  { icon: Pencil, title: "Cell editing types", href: "/docs/editing-cell-types" },
];

const agentSkills = [
  {
    icon: Gauge,
    title: "gridcn-performance",
    description: "Audits a slow grid against the memoization and virtualization traps, in order.",
  },
  {
    icon: Shapes,
    title: "gridcn-custom-cell-type",
    description: "Builds a cell type that pastes, sorts, and edits like the built-ins.",
  },
  {
    icon: Database,
    title: "gridcn-data-source",
    description: "Picks client, streaming, lazy, or paged data and wires server sort and filter.",
  },
  {
    icon: Blocks,
    title: "gridcn-addons",
    description: "Wires several add-ons into one grid, each output in the right place.",
  },
  {
    icon: RefreshCw,
    title: "gridcn-upgrade",
    description: "Pulls upstream fixes into copied source and keeps your local edits.",
  },
];

const comparison = {
  columns: ["gridcn", "AG Grid", "MUI X", "TanStack Table"],
  rows: [
    {
      feature: "Range selection",
      values: ["Free", "Enterprise", "Premium", "Headless"],
    },
    {
      feature: "Excel / Sheets clipboard round-trip",
      values: ["Free", "Enterprise", "Premium", "Headless"],
    },
    {
      feature: "Fill handle",
      values: ["Add-on", "Enterprise", "Premium (v9)", "—"],
    },
    {
      feature: "Undo & redo",
      values: ["Add-on", "Community (v36)", "Premium", "Headless"],
    },
    {
      feature: "npx shadcn add",
      values: ["One line", "—", "—", "Examples only"],
    },
  ],
};

export default function HomePage() {
  return (
    <div className="relative flex flex-1 flex-col items-center">
      <HeroShader />
      <div className="border bg-card z-10 mt-20 mb-16 flex w-full max-w-2xl flex-col items-center gap-6 px-6 sm:px-10 py-10 text-center">
        <Badge variant="outline">
          Source-available · shadcn registry
        </Badge>
        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          gridcn
        </h1>
        <p className="text-lg text-muted-foreground">
          A composable, high-performance data grid for the shadcn ecosystem —
          range selection, spreadsheet clipboard, typed cell editors,
          validation, and windowed rendering at 100k+ rows.
        </p>
        <p className="text-sm text-muted-foreground">
          Works in Next.js, Vite, and any React 19 app with Tailwind v4 —{" "}
          <Link href="/docs/project-status#framework-floors" className="underline underline-offset-4 hover:text-foreground">
            see compatibility
          </Link>
          .
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button render={<Link href="/docs" />} nativeButton={false} size="lg">
            Get started
          </Button>
          <Button
            render={
              <a
                href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}
                target="_blank"
                rel="noreferrer"
              />
            }
            nativeButton={false}
            variant="outline"
            size="lg"
          >
            <GithubIcon className="size-4" />
            GitHub
          </Button>
        </div>
        <div className="w-full max-w-md text-start">
          <InstallCommand item="data-grid" />
        </div>
        <Link
          href="/docs/agent-skills"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <Bot className="size-4" aria-hidden="true" />
          Building with an AI agent? Install the gridcn agent skills
        </Link>
      </div>

      <div className="relative z-10 w-full max-w-5xl px-6">
        <div className="border bg-card z-10 mx-auto mb-4 w-fit px-5 py-2">
          <p className="text-center text-sm text-foreground">
            Click-drag to select a range, drag the fill handle to extend a
            series, Ctrl+C / Ctrl+V for native clipboard round-trips.
          </p>
        </div>
        <div className="overflow-hidden border border-border bg-background shadow-sm">
          <DataGridDemo />
        </div>
      </div>

      <div className="relative z-10 mt-24 w-full max-w-5xl px-6">
        <div className="border bg-card z-10 mx-auto mb-8 flex w-fit flex-col items-center gap-2 px-8 py-5 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            The gap gridcn fills
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            Range selection, spreadsheet clipboard paste, and a fill handle
            are paid-tier features — Enterprise in AG Grid, Premium in MUI X.
             gridcn ships them source-available: core plus one-line add-ons.
          </p>
        </div>
        <Cards>
          {headlineFeatures.map(({ icon: Icon, title, description }) => (
            <Card
              key={title}
              icon={<Icon />}
              title={title}
              description={description}
            />
          ))}
        </Cards>
      </div>

      <div className="relative z-10 mt-16 w-full max-w-5xl px-6">
        <div className="border bg-card z-10 mx-auto mb-8 w-fit px-8 py-4">
          <h2 className="text-center text-2xl font-semibold tracking-tight text-foreground">
            Built the shadcn way
          </h2>
        </div>
        <Cards>
          {coreTraits.map(({ icon: Icon, title, description, href }) => (
            <Card
              key={title}
              icon={<Icon />}
              title={title}
              description={description}
              href={href}
            />
          ))}
        </Cards>
      </div>

      <div className="relative z-10 mt-16 w-full max-w-5xl px-6">
        <div className="border bg-card z-10 mx-auto mb-8 flex w-fit flex-col items-center gap-2 px-8 py-5 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            Performance you can measure
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            100k-row production benchmark against MUI X DataGrid,
            react-data-grid, and a TanStack assembly — same seed, same
            harness, same machine.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {perfStats.map(({ value, title, description }) => (
            <Link
              key={title}
              href="/docs/performance"
              className="border bg-card flex flex-col items-center gap-2 p-6 text-center transition-colors hover:border-primary/40"
            >
              <span className="text-3xl font-bold tracking-tight text-foreground">
                {value}
              </span>
              <span className="text-sm font-medium text-foreground">
                {title}
              </span>
              <span className="text-xs text-muted-foreground">
                {description}
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div className="relative z-10 mt-16 w-full max-w-5xl px-6">
        <div className="border bg-card z-10 mx-auto mb-8 flex w-fit flex-col items-center gap-2 px-8 py-5 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            The gap, quantified
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            Where the same features sit in the grids you are probably comparing
            — free tier, paid tier, or your own code.
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border bg-background">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-border bg-muted">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-medium">
                  Capability
                </th>
                {comparison.columns.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className={
                      column === "gridcn"
                        ? "px-4 py-3 text-center font-semibold text-primary"
                        : "px-4 py-3 text-center font-medium"
                    }
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map(({ feature, values }) => (
                <tr key={feature} className="border-b border-border last:border-0">
                  <th scope="row" className="px-4 py-3 text-left font-medium">
                    {feature}
                  </th>
                  {values.map((value, index) => (
                    <td
                      key={index}
                      className={
                        value === "—"
                          ? "px-4 py-3 text-center text-muted-foreground/50"
                          : index === 0
                            ? "px-4 py-3 text-center font-medium text-foreground"
                            : "px-4 py-3 text-center text-muted-foreground"
                      }
                    >
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border bg-card z-10 mx-auto mt-4 w-fit max-w-full px-5 py-2">
          <p className="text-center text-xs text-muted-foreground">
          Tiers as of 09/2026 (AG Grid v36, MUI X v9, TanStack Table v9).
          Vendors change tiers — verify before relying on this:{" "}
          <a
            className="underline decoration-muted-foreground/50 underline-offset-2 hover:text-foreground"
            href="https://www.ag-grid.com/license-pricing/"
            rel="noreferrer"
            target="_blank"
          >
            AG Grid pricing
          </a>
          ,{" "}
          <a
            className="underline decoration-muted-foreground/50 underline-offset-2 hover:text-foreground"
            href="https://mui.com/x/introduction/licensing/"
            rel="noreferrer"
            target="_blank"
          >
            MUI X licensing
          </a>
          ,{" "}
          <a
            className="underline decoration-muted-foreground/50 underline-offset-2 hover:text-foreground"
            href="https://tanstack.com/table/latest"
            rel="noreferrer"
            target="_blank"
          >
            TanStack Table
          </a>
          .
          </p>
        </div>
      </div>

      <div className="relative z-10 mt-16 w-full max-w-5xl px-6">
        <div className="border bg-card z-10 mx-auto mb-8 flex w-full max-w-2xl flex-col items-center gap-2 px-6 py-5 text-center sm:px-8">
          <Badge variant="outline">
            <Bot aria-hidden="true" />
            Agent skills
          </Badge>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            Your coding agent knows gridcn
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            Five skills for Claude Code, Cursor, Codex, and other agents: the
            procedures and silent traps the docs alone cannot enforce.
          </p>
          <div className="w-full max-w-md text-start">
            <InstallCommand command="skills add DammersCode/gridcn" />
          </div>
        </div>
        <Cards>
          {agentSkills.map(({ icon: Icon, title, description }) => (
            <Card
              key={title}
              icon={<Icon />}
              title={title}
              description={description}
              href={`/docs/agent-skills#${title}`}
            />
          ))}
        </Cards>
      </div>

      <div className="relative z-10 mt-16 w-full max-w-5xl px-6 pb-24">
        <div className="border bg-card z-10 mx-auto mb-8 flex w-fit flex-col items-center gap-2 px-8 py-5 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            Modular by design
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            The core engine is selection, keyboard, editing, cell types,
            clipboard, and validation. The twelve add-ons — fill handle,
            undo/redo, presence, pinned rows, and more — are separate registry
            items you install only if you want them.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {addOns.map(({ icon: Icon, title, href }) => (
            <Link
              key={title}
              href={href}
              className="flex flex-col items-center gap-2 border border-border bg-card p-4 text-center text-sm text-card-foreground transition-colors hover:border-primary/50 hover:bg-muted"
            >
              <Icon
                className="size-5 text-muted-foreground"
                aria-hidden="true"
              />
              {title}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
