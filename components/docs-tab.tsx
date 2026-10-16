"use client";

import { useEffect, type ComponentProps } from "react";
import { Tab } from "fumadocs-ui/components/tabs";

function revealHashTarget(): void {
  const id = decodeURIComponent(window.location.hash.slice(1));
  const panel = id ? document.getElementById(id)?.closest<HTMLElement>('[role="tabpanel"]') : null;
  if (!panel?.hidden) return;
  document.getElementById(panel.getAttribute("aria-labelledby") ?? "")?.focus();
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
}

/** Tab panel that stays mounted while inactive, so heading anchors inside it exist and open the tab. */
export function DocsTab(props: ComponentProps<typeof Tab>) {
  useEffect(() => {
    revealHashTarget();
    window.addEventListener("hashchange", revealHashTarget);
    return () => window.removeEventListener("hashchange", revealHashTarget);
  }, []);
  return <Tab forceMount {...props} />;
}
