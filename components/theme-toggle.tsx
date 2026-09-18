"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

/**
 * Sharp-cornered light/dark toggle wired to ncdai/theme-toggle-effect-polygon (installed CSS in
 * global.css: view-transition keyframes + --theme-toggle-polygon-duration). Wrapping setTheme in
 * document.startViewTransition is what triggers the polygon reveal; without it, this is a plain toggle.
 */
export function ThemeToggle({ className }: { className?: string }): ReactNode {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const toggle = () => {
    const next = resolvedTheme === "dark" ? "light" : "dark";
    if (!document.startViewTransition) {
      setTheme(next);
      return;
    }
    document.startViewTransition(() => setTheme(next));
  };

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle theme"
      data-theme-toggle=""
      className={cn(
        "inline-flex size-8 items-center justify-center border border-border bg-background text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </button>
  );
}
