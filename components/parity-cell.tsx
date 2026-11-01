import { Check, CircleDashed, Minus, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ParityStatus = "supported" | "gap" | "n/a" | "unverified";

// the site green (status-new) mixed toward the foreground keeps 3:1 against the light background; the preset has no success token
const STATUS: Record<ParityStatus, { word: string; Icon: LucideIcon; tone: string }> = {
  supported: { word: "Supported", Icon: Check, tone: "text-[color-mix(in_oklab,var(--status-new)_55%,var(--foreground))]" },
  gap: { word: "Gap", Icon: TriangleAlert, tone: "text-destructive" },
  "n/a": { word: "Not applicable", Icon: Minus, tone: "text-muted-foreground" },
  unverified: { word: "Not verified", Icon: CircleDashed, tone: "text-warning" },
};

const ORDER: readonly ParityStatus[] = ["supported", "gap", "n/a", "unverified"];

/** One matrix cell: an icon in the status color, with the status word kept as text for screen readers. */
export function ParityCell({ status, note }: { status: ParityStatus; note?: string }): ReactNode {
  const { word, Icon, tone } = STATUS[status];
  return (
    <span className={cn("inline-flex items-center justify-center", tone)} title={note}>
      <Icon aria-hidden="true" className="size-4" strokeWidth={2.5} />
      <span className="sr-only">{word}</span>
    </span>
  );
}

/** The key above the matrix: each status with its icon and word. */
export function ParityLegend({ statuses = ORDER }: { statuses?: readonly ParityStatus[] } = {}): ReactNode {
  return (
    <ul className="not-prose my-4 flex flex-wrap gap-x-5 gap-y-1 text-sm">
      {statuses.map((status) => {
        const { word, Icon, tone } = STATUS[status];
        return (
          <li key={status} className="inline-flex items-center gap-1.5">
            <Icon aria-hidden="true" className={cn("size-4", tone)} strokeWidth={2.5} />
            <span>{word}</span>
          </li>
        );
      })}
    </ul>
  );
}
