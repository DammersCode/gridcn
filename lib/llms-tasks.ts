export type LlmsTask = { intent: string; slug: string[]; anchor?: string; label: string };

/** Intent → docs page (and heading anchor). The llms.txt route fails the build when a page or anchor is missing. */
export const LLMS_TASKS: LlmsTask[] = [
  { intent: "Delete the selected rows in bulk", slug: ["rows-pages-menus", "row-operations"], label: "Row operations" },
  { intent: "Sort on the server", slug: ["data-modes", "query-server-rows"], label: "Query server rows" },
  { intent: "Sort a scroll-mode grid on the server", slug: ["data-modes", "query-server-rows"], label: "Query server rows" },
  { intent: "Export CSV only, or choose export options", slug: ["import-export", "export"], label: "Export" },
  { intent: "Load rows while scrolling with a total and a loading state", slug: ["scroll-mode", "load-rows-while-scrolling"], label: "Load rows while scrolling" },
  { intent: "Undo and redo", slug: ["clipboard-undo", "undo-redo"], label: "Undo and redo" },
  { intent: "Control the selection from app state", slug: ["events-state", "selection-cell-events"], label: "Selection and cell events" },
  { intent: "Persist the column layout (widths, order, pins, hidden)", slug: ["columns", "column-visibility"], label: "Column visibility" },
  { intent: "Limit imported files (size, rows, columns)", slug: ["import-export", "import"], label: "Import" },
  { intent: "Add a custom cell type", slug: ["recipes-custom-code", "write-cell-type"], label: "Write a cell type" },
  { intent: "Paginate with bookmarkable pages", slug: ["server-pagination", "keep-pages-url"], label: "Keep pages in URL" },
  { intent: "Find a callback or event", slug: ["cheatsheets-messages", "events-z"], label: "Events A to Z" },
];

export const SKILL_NAMES = ["gridcn-performance", "gridcn-custom-cell-type", "gridcn-data-source", "gridcn-addons", "gridcn-upgrade"];

/** GitHub-style heading slug, also honoring explicit `[#id]` suffixes. */
export function headingAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const heading = !inFence && /^#{1,6}\s+(.*)$/.exec(line);
    if (!heading) continue;
    const explicit = /\[#([^\]]+)\]\s*$/.exec(heading[1]!);
    if (explicit) anchors.add(explicit[1]!);
    const text = heading[1]!.replace(/\[#[^\]]+\]\s*$/, "").replace(/`/g, "");
    anchors.add(text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-"));
  }
  return anchors;
}
