import Link from "next/link";
import type { ReactNode } from "react";
import {
  parityByMode,
  parityModes,
  parityRows,
  parityTotals,
  perfNote,
  perfStats,
  serverHighlights,
} from "./data";
import { cn } from "@/lib/utils";

export const PARITY_HREF = "/docs/data-modes";

const statusClass = {
  supported: "bg-primary",
  gap: "bg-destructive",
  "n/a": "bg-muted-foreground/30",
} as const;

export function ParitySummary({ className }: { className?: string }) {
  const t = parityTotals;
  return (
    <p className={cn("text-sm text-muted-foreground", className)}>
      {t.features} features across {t.modes} data modes:{" "}
      <strong className="text-foreground">
        {t.supported} of {t.cells} cells supported
      </strong>
      , {t.na} not applicable, {t.gap} known gaps.
    </p>
  );
}

/** Variant 1: one coverage bar per data mode. */
export function ParityBars() {
  return (
    <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
      {parityByMode.map((m) => (
        <li key={m.id} className="flex items-center gap-3 text-sm">
          <span className="w-9 shrink-0 font-mono text-xs text-muted-foreground">{m.id}</span>
          <span className="min-w-0 flex-1 truncate">{m.label}</span>
          <span
            className="flex h-2 w-24 shrink-0 overflow-hidden bg-muted"
            role="img"
            aria-label={`${m.supported} supported, ${m.na} not applicable, ${m.gap} gaps`}
          >
            <span className="bg-primary" style={{ width: `${(m.supported / parityTotals.features) * 100}%` }} />
            <span className="bg-muted-foreground/30" style={{ width: `${(m.na / parityTotals.features) * 100}%` }} />
            <span className="bg-destructive" style={{ width: `${(m.gap / parityTotals.features) * 100}%` }} />
          </span>
          <span className="w-10 shrink-0 text-end text-xs tabular-nums text-muted-foreground">
            {m.supported}/{parityTotals.features}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ParityLegend() {
  return (
    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <i className="size-2.5 bg-primary" />✓
        supported
      </span>
      <span className="inline-flex items-center gap-1.5">
        <i className="size-2.5 bg-muted-foreground/30" />–
        not applicable
      </span>
      <span className="inline-flex items-center gap-1.5">
        <i className="size-2.5 bg-destructive" />✕
        known gap
      </span>
    </p>
  );
}

/** Variant 2: the whole matrix as a heatmap, one square per cell. */
export function ParityHeatmap() {
  return (
    <div>
      <div
        className="grid w-fit gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${parityModes.length}, 18px)` }}
        role="img"
        aria-label={`Parity matrix: ${parityTotals.supported} of ${parityTotals.cells} cells supported, ${parityTotals.gap} known gaps`}
      >
        {parityModes.map((m) => (
          <span key={m.id} className="text-center font-mono text-xs text-muted-foreground">
            {m.id}
          </span>
        ))}
        {parityRows.flatMap((r) =>
          r.statuses.map((s, i) => (
            <span
              key={`${r.id}-${i}`}
              title={`${r.feature} · ${parityModes[i].label}: ${s}`}
              className={cn("size-[18px]", statusClass[s])}
            />
          )),
        )}
      </div>
      <ParityLegend />
    </div>
  );
}

/** Variant 3: a count table, modes as columns. */
export function ParityCounts() {
  const rows = [
    ["supported", "Supported"],
    ["na", "Not applicable"],
    ["gap", "Known gap"],
  ] as const;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <caption className="sr-only">Feature count per data mode</caption>
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th scope="col" className="py-1.5 text-start font-medium">
              Data mode
            </th>
            {parityByMode.map((m) => (
              <th key={m.id} scope="col" className="px-1 py-1.5 text-center font-mono font-medium"><abbr title={m.label} className="no-underline">
                {m.id}
              </abbr></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, label]) => (
            <tr key={key} className="border-b last:border-0">
              <th scope="row" className="py-1.5 text-start font-normal text-muted-foreground">
                {label}
              </th>
              {parityByMode.map((m) => (
                <td
                  key={m.id}
                  className={cn("px-1 py-1.5 text-center tabular-nums", key === "gap" && m.gap > 0 && "font-medium text-destructive")}
                >
                  {m[key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">{parityByMode.map((m) => `${m.id} ${m.label}`).join(" · ")}</p>
    </div>
  );
}

export function PerfStats({ className }: { className?: string }) {
  return (
    <div className={className}>
      <ul className="grid gap-px border bg-border sm:grid-cols-3">
        {perfStats.map((s) => (
          <li key={s.title} className="bg-card">
            <Link href={s.href} className="flex h-full flex-col gap-1 p-4 transition-colors hover:bg-muted">
              <span className="text-2xl font-bold tracking-tight tabular-nums">{s.value}</span>
              <span className="text-sm font-medium">{s.title}</span>
              <span className="text-xs text-muted-foreground">{s.detail}</span>
              <span className="text-xs underline underline-offset-4">Source: {s.source}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">{perfNote}</p>
    </div>
  );
}

export function ServerHighlights({ columns = "sm:grid-cols-2 lg:grid-cols-4" }: { columns?: string }) {
  return (
    <ul className={cn("grid gap-px border bg-border", columns)}>
      {serverHighlights.map((h) => (
        <li key={h.title} className="bg-card">
          <Link href={h.href} className="flex h-full flex-col gap-1 p-4 transition-colors hover:bg-muted">
            <span className="text-sm font-medium">{h.title}</span>
            <span className="text-xs text-muted-foreground">{h.text}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function SectionHead({ title, children, link }: { title: string; children?: ReactNode; link?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {link}
      {children}
    </div>
  );
}

export function ParityLink({ children }: { children: ReactNode }) {
  return (
    <Link href={PARITY_HREF} className="inline-flex min-h-10 items-center text-sm underline underline-offset-4 hover:text-foreground">
      {children}
    </Link>
  );
}
