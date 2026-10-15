"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type CopyStatus = "idle" | "copied" | "failed";

const RESET_MS = 1500;

/** Copies text to the clipboard; `status` reads "failed" when the browser refuses the write. */
export function useCopyText(): { status: CopyStatus; copy: (text: string) => Promise<void> } {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(async (text: string) => {
    let next: CopyStatus = "copied";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      next = "failed";
    }
    setStatus(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus("idle"), RESET_MS);
  }, []);

  return { status, copy };
}

/** Icon for a copy button: `idle` until a copy finishes, then a check or a cross. */
export function CopyIcon({ status, idle, className }: { status: CopyStatus; idle: ReactNode; className?: string }): ReactNode {
  if (status === "copied") return <Check className={className} />;
  if (status === "failed") return <X className={cn(className, "text-destructive")} />;
  return idle;
}

/** Live region that announces the copy result; render it beside the button, not inside it. */
export function CopyAnnouncer({ status }: { status: CopyStatus }): ReactNode {
  return (
    <span role="status" className="sr-only">
      {status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : ""}
    </span>
  );
}
