import Link from "next/link";
import type { ReactNode } from "react";
import { faq, perfDemos, perfNote, perfRunHref, perfStats, serverHighlights } from "./data";

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
      <div className="mt-3 flex flex-wrap items-center gap-x-4 text-sm">
        <span className="font-medium">Scroll it yourself:</span>
        {perfDemos.map((d) => (
          <Link key={d.href} href={d.href} className={`inline-flex min-h-10 items-center underline underline-offset-4 ${focus}`}>
            {d.text}
          </Link>
        ))}
      </div>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
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
    <ul className="grid grid-cols-1 gap-px border bg-border sm:grid-cols-2">
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

export function Faq() {
  return (
    <div className="flex flex-col divide-y">
      {faq.map((f) => (
        <details key={f.question} className="group py-1">
          <summary className={`flex min-h-10 cursor-pointer items-center text-base font-medium ${focus}`}>{f.question}</summary>
          <div className="max-w-prose pb-3 text-base leading-relaxed text-muted-foreground">
            <p>{f.answer}</p>
            <div className="flex flex-wrap gap-x-4">
              {f.links.map((l) => (
                <Link key={l.href} href={l.href} className={`inline-flex min-h-10 items-center text-foreground underline underline-offset-4 ${focus}`}>
                  {l.text}
                </Link>
              ))}
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}
