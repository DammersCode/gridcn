"use client";

import { Tabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DocsTabs } from "@/components/docs-tabs";

/** Props for {@link PreviewTabs}. */
export type PreviewTabsProps = {
  /** The live demo node (already resolved server-side). */
  preview: ReactNode;
  /** The highlighted source node (already resolved server-side). */
  code: ReactNode;
  /** Preview area alignment; grids are block-level so 'start' avoids fake centering whitespace. */
  align?: "start" | "center";
};

const TABS = [
  { value: "preview", label: "Preview" },
  { value: "code", label: "Code" },
] as const;

/** diceui-style Preview/Code panel: pill tabs in a muted header bar, fixed-height panels. */
export function PreviewTabs({ preview, code, align = "start" }: PreviewTabsProps): ReactNode {
  return (
    <DocsTabs tabs={TABS} defaultValue="preview" className="my-6">
      <Tabs.Panel value="preview" tabIndex={-1}>
        <div
          className={cn(
            // justify-center on an overflowing child pushes it out BOTH sides and the left overhang
            // is unreachable by scrolling; safe-center only centers while the child actually fits.
            "flex min-h-112.5 w-full overflow-x-auto p-6",
            align === "center" ? "items-center justify-center-safe" : "items-start justify-start",
          )}
        >
          {preview}
        </div>
      </Tabs.Panel>
      {/* flatten the CodeBlock figure into the panel (diceui pattern) — the figure keeps its own copy button + scroll viewport */}
      {/* the max-h must sit on the scroll viewport itself: capping figure/pre instead leaves the
          viewport at its own 600px max, pushing its horizontal scrollbar below the figure's
          overflow-hidden clip — scrollable content with an invisible bar. */}
      <Tabs.Panel
        value="code"
        className="[&_figure]:my-0 [&_figure]:rounded-none [&_figure]:border-0 [&_figure]:shadow-none [&_.fd-scroll-container]:max-h-112.5"
      >
        {code}
      </Tabs.Panel>
    </DocsTabs>
  );
}
