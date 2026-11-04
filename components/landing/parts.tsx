import Link from "next/link";
import type { ReactNode } from "react";
import { perfNote, perfStats, serverHighlights } from "./data";
import { cn } from "@/lib/utils";

const DATA_MODES_HREF = "/docs/data-modes";

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
            <h3 className="text-sm font-medium">{h.title}</h3>
            <span className="text-xs text-muted-foreground">{h.text}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function DataModesLink({ children }: { children: ReactNode }) {
  return (
    <Link href={DATA_MODES_HREF} className="inline-flex min-h-10 items-center text-sm underline underline-offset-4 hover:text-foreground">
      {children}
    </Link>
  );
}
