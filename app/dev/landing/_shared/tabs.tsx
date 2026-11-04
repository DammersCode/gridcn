"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Tabs({ tabs }: { tabs: { label: string; panel: ReactNode }[] }) {
  const [active, setActive] = useState(0);
  const id = useId();
  return (
    <section aria-labelledby={`${id}-h`} className="border bg-card/90">
      <h2 id={`${id}-h`} className="sr-only">Why gridcn</h2>
      <div role="tablist" className="flex overflow-x-auto border-b">
        {tabs.map((t, i) => (
          <button
            key={t.label}
            id={`${id}-tab-${i}`}
            role="tab"
            type="button"
            aria-selected={active === i}
            aria-controls={`${id}-panel-${i}`}
            tabIndex={active === i ? 0 : -1}
            onClick={(e) => { setActive(i); e.currentTarget.scrollIntoView({ inline: "nearest", block: "nearest" }); }}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              const next = (active + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
              setActive(next);
              document.getElementById(`${id}-tab-${next}`)?.scrollIntoView({ inline: "nearest", block: "nearest" });
              document.getElementById(`${id}-tab-${next}`)?.focus();
            }}
            className={cn(
              "shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              active === i
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div
          key={t.label}
          id={`${id}-panel-${i}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${i}`}
          hidden={active !== i}
          className="min-h-72 p-4"
        >
          {t.panel}
        </div>
      ))}
    </section>
  );
}
