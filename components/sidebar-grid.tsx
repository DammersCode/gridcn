"use client";

import { useEffect } from "react";

// Group-band class for folder trigger rows; the CSS pairs with :has()-free selectors (repo policy).
const BAND = "nd-nav-band";
const isCell = (n: Node) => n.nodeType === Node.ELEMENT_NODE && ((n as Element).classList.contains("gutter-cell") || (n as Element).classList.contains("chev-cell"));

// Rewrites the fumadocs sidebar into the grid canvas. Idempotent: every step guards on the
// nodes it creates, so re-runs (MutationObserver, React re-render) are no-ops.
function build(sidebar: HTMLElement) {
  sidebar.querySelectorAll("a.relative.flex.flex-row, button.relative.flex.flex-row").forEach((item) => {
    // The folder chevron is the only direct-child svg carrying data-icon (fumadocs base.js).
    item.querySelectorAll(":scope > svg[data-icon]").forEach((svg) => {
      if (svg.parentElement?.classList.contains("chev-cell")) return;
      const cell = document.createElement("span");
      cell.className = "chev-cell";
      svg.replaceWith(cell);
      cell.appendChild(svg);
      item.classList.add(BAND);
    });
    // Icon + title (+ status dot) move into the content cell; spacing then lives inside it.
    if (item.querySelector(":scope > .nav-content")) return;
    const parts = [...item.childNodes].filter((n) => !isCell(n));
    const first = parts[0];
    if (!first) return;
    const content = document.createElement("span");
    content.className = "nav-content";
    item.insertBefore(content, first);
    for (const node of parts) {
      if (node.nodeType !== Node.TEXT_NODE) {
        content.appendChild(node);
        continue;
      }
      const text = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (!text) continue;
      const title = document.createElement("span");
      title.className = "nav-title";
      title.title = text;
      // Titles are bare text nodes: move (not replace) the node so React in-place updates
      // still hit the live node.
      title.appendChild(node);
      content.appendChild(title);
    }
  });

  const root = sidebar.querySelector<HTMLElement>("[data-radix-scroll-area-viewport] > div");
  // The viewport's *:gap-0.5! child utility carries !important and wins the cascade;
  // only an inline important declaration on the frame zeroes the row gap reliably.
  if (root) root.style.setProperty("gap", "0px", "important");

  const process = (container: Element | null, depth: number) => {
    if (!container) return;
    for (const child of container.children) {
      const item = child.matches("a, button")
        ? child
        : child.matches("div[data-state]")
          ? (child.querySelector(":scope > a, :scope > button") ?? null)
          : null;
      // Nesting offset as empty gutter columns (no arrow glyph: removed by design).
      if (item && depth > 0 && !item.querySelector(":scope > .gutter-cell")) {
        for (let i = 0; i < depth; i++) {
          const g = document.createElement("span");
          g.className = "gutter-cell";
          item.prepend(g);
        }
      }
      // Every nested row carries the chevron column; leaves get an empty ghost cell so the
      // column divider line is continuous through the whole block.
      if (item && depth > 0 && !item.querySelector(":scope > .chev-cell")) {
        const g = document.createElement("span");
        g.className = "chev-cell";
        item.appendChild(g);
      }
      if (child.matches("div[data-state]")) {
        const content = child.querySelector(":scope > div");
        if (content) process(content.firstElementChild, depth + 1);
      }
    }
  };
  process(root, 0);
}

/** Mounts the sidebar grid-canvas rewrite (docs pages only; renders nothing). */
export function SidebarGrid() {
  useEffect(() => {
    const sidebar = document.getElementById("nd-sidebar");
    if (!sidebar) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      build(sidebar);
    };
    const observer = new MutationObserver(() => {
      if (!raf) raf = requestAnimationFrame(apply);
    });
    apply();
    observer.observe(sidebar, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);
  return null;
}
