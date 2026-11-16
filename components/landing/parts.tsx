import Link from "next/link";
import type { ReactNode } from "react";
import { perfNote, perfRunHref, perfStats, serverHighlights } from "./data";

export const focus = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

const isExternal = (href: string) => /^https?:\/\//.test(href);

export function SiteLink({ href, className, children, ...rest }: { href: string; className?: string; children: ReactNode; "aria-label"?: string }) {
  if (isExternal(href)) {
    return (
      <a href={href} className={className} target="_blank" rel="noreferrer" {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} {...rest}>
      {children}
    </Link>
  );
}

export function PerfStats() {
  return (
    <div>
      <ul className="grid gap-px border bg-border lg:grid-cols-3">
        {perfStats.map((s) => (
          <li key={s.title} className="bg-card">
            <Link href={s.href} className={`flex h-full flex-col gap-1 p-4 transition-colors hover:bg-muted ${focus}`}>
              <span className="text-2xl font-bold tracking-tight tabular-nums">{s.value}</span>
              <span className="text-base font-medium">{s.title}</span>
              <span className="text-sm leading-relaxed text-muted-foreground">{s.detail}</span>
              <span className="text-sm underline underline-offset-4">Source: {s.source}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {perfNote}{" "}
        <Link href={perfRunHref} className="inline-flex min-h-10 items-center underline underline-offset-4">
          Run the benchmark on your machine
        </Link>
      </p>
    </div>
  );
}

export function ServerHighlights() {
  return (
    <ul className="grid gap-px border bg-border md:grid-cols-3">
      {serverHighlights.map((h) => (
        <li key={h.title} className="bg-card">
          <Link href={h.href} className={`flex h-full flex-col gap-1 p-4 transition-colors hover:bg-muted ${focus}`}>
            <h3 className="text-sm font-medium">{h.title}</h3>
            <span className="text-sm leading-relaxed text-muted-foreground">{h.text}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function DataModesLink({ children }: { children: ReactNode }) {
  return (
    <Link href="/docs/data-modes/data-mode-support" className="inline-flex min-h-10 items-center text-sm underline underline-offset-4 hover:text-foreground">
      {children}
    </Link>
  );
}
