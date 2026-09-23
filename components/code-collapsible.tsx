"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Clipboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type CodeCollapsibleProps = {
  /** Destination path shown as the block's title bar, e.g. "components/data-grid-fill/fill.ts". */
  title: string;
  /** The raw code text, for the copy button — the syntax-highlighted tree can't be copied as plain text. */
  code: string;
  /** The code block markup (e.g. a highlighted `<CodeBlock>`/`<Pre>` tree) to collapse. */
  children: ReactNode;
  className?: string;
};

const COLLAPSED_HEIGHT = "max-h-72";

/** Collapsed-by-default code block with its own title bar (destination path + copy + expand), matching shadcn/diceui's manual-install pattern. */
export function CodeCollapsible({ title, code, children, className }: CodeCollapsibleProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      className={cn("not-prose overflow-hidden rounded-xl border border-border bg-card", className)}
      data-state={open ? "open" : "closed"}
    >
      <div className="flex h-9.5 items-center gap-2 border-b border-border px-4">
        <span className="flex-1 truncate font-mono text-xs text-muted-foreground">{title}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Copy code"
          onClick={copy}
        >
          {copied ? <Check /> : <Clipboard />}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Collapse" : "Expand"}
          <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
        </Button>
      </div>
      <div className={cn("relative overflow-hidden [&>figure]:my-0 [&>figure]:rounded-none [&>figure]:border-0 [&>figure]:shadow-none", !open && COLLAPSED_HEIGHT)}>
        {children}
        {!open && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-b from-transparent to-card" />
        )}
      </div>
    </div>
  );
}
