import Link from "next/link";
import type { ComponentProps } from "react";
import {
  ArrowUpDown,
  Blocks,
  Clipboard,
  FileSpreadsheet,
  Keyboard,
  Layers,
  Link2,
  MousePointer2,
  PaintBucket,
  Palette,
  Undo2,
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
    icon: Layers,
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
];

const addOns = [
  { icon: Undo2, title: "Undo & redo", href: "/docs/undo-redo" },
  {
    icon: ArrowUpDown,
    title: "Sorting, filtering & search",
    href: "/docs/sorting-filtering-search",
  },
  {
    icon: FileSpreadsheet,
    title: "Import & export",
    href: "/docs/import-export",
  },
  { icon: Link2, title: "URL state", href: "/docs/url-state" },
  { icon: Blocks, title: "Context menu & keybindings", href: "/docs/columns" },
];

export default function HomePage() {
  return (
    <div className="relative flex flex-1 flex-col items-center">
      <HeroShader />
      <div className="glass-panel z-10 mx-6 mt-20 mb-16 flex max-w-2xl flex-col items-center gap-6 px-10 py-10 text-center">
        <Badge variant="outline" className="gap-1.5 py-1">
          MIT licensed · shadcn registry
        </Badge>
        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          gridcn
        </h1>
        <p className="text-lg text-muted-foreground">
          An editable data grid for the shadcn ecosystem — range selection,
          spreadsheet clipboard, and a fill handle, done right.
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
      </div>

      <div className="relative z-10 w-full max-w-5xl px-6">
        <div className="overflow-hidden rounded-xl border border-border shadow-sm">
          <DataGridDemo />
        </div>
        <div className="glass-panel-pill z-10 mx-auto mt-4 w-fit px-5 py-2">
          <p className=" text-center text-sm text-muted-foreground">
            Click-drag to select a range, drag the fill handle to extend a
            series, Ctrl+C / Ctrl+V for native clipboard round-trips.
          </p>
        </div>
      </div>

      <div className="relative z-10 mt-24 w-full max-w-5xl px-6">
        <div className="glass-panel-pill z-10 mx-auto mb-8 flex w-fit flex-col items-center gap-2 px-8 py-5 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            The gap gridcn fills
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            Range selection, spreadsheet clipboard paste, and a fill handle are
            Enterprise-only features in AG Grid and MUI X. gridcn ships them
            free — core plus one-line add-ons.
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
        <div className="glass-panel-pill z-10 mx-auto mb-8 w-fit px-8 py-4">
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

      <div className="relative z-10 mt-16 w-full max-w-5xl px-6 pb-24">
        <div className="glass-panel-pill z-10 mx-auto mb-8 flex w-fit flex-col items-center gap-2 px-8 py-5 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            Modular by design
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            The core engine is selection, keyboard, editing, cell types,
            clipboard, and validation. Everything else — including the fill
            handle — is a separate registry item you install only if you want
            it.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {addOns.map(({ icon: Icon, title, href }) => (
            <Link
              key={title}
              href={href}
              className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-4 text-center text-sm text-card-foreground transition-colors hover:border-primary/50 hover:bg-muted"
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
