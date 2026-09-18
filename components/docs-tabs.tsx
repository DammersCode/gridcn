"use client";

import type { ReactNode } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { cn } from "@/lib/utils";

export type DocsTabItem = {
  value: string;
  label: ReactNode;
};

type DocsTabsProps = {
  tabs: readonly DocsTabItem[];
  children: ReactNode;
  /** Extra content rendered in the header bar after the tab list (e.g. a copy button). */
  headerEnd?: ReactNode;
  className?: string;
  headerClassName?: string;
  tabClassName?: string;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
};

// The tab shell is `not-prose`, so links inside it lose the typography plugin's `.prose a` style;
// this mirrors that rule so widget links read the same as prose links.
export const DOCS_LINK = "underline underline-offset-[3.5px] decoration-primary decoration-[1.5px] font-medium transition-opacity duration-200 hover:opacity-80";

/** House tab shell (diceui pattern): pill tabs in a muted header bar, `rounded-xl border` frame. Shared by PreviewTabs, InstallCommand, and the Manual tab. */
export function DocsTabs({
  tabs,
  children,
  headerEnd,
  className,
  headerClassName,
  tabClassName,
  defaultValue,
  value,
  onValueChange,
}: DocsTabsProps): ReactNode {
  return (
    <Tabs.Root
      defaultValue={defaultValue ?? tabs[0]?.value}
      value={value}
      onValueChange={onValueChange as (value: unknown) => void}
      className={cn("not-prose overflow-hidden rounded-xl border border-border", className)}
    >
      <div className={cn("flex items-center border-b border-border bg-secondary/50 px-3 py-1.5", headerClassName)}>
        <Tabs.List className="flex items-center gap-1">
          {tabs.map((tab) => (
            <Tabs.Tab
              key={tab.value}
              value={tab.value}
              className={cn(
                // border on both states (transparent when inactive) so activation never shifts layout
                "h-7 rounded-md border border-transparent px-3 text-xs font-medium text-muted-foreground outline-none transition-colors",
                "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                // Base UI Tabs.Tab emits data-active (TabsTabDataAttributes), not data-selected
                "data-active:border-border data-active:bg-background data-active:text-foreground data-active:shadow-sm",
                tabClassName,
              )}
            >
              {tab.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {headerEnd}
      </div>
      {children}
    </Tabs.Root>
  );
}
