export type LlmsTask = { intent: string; slug: string[]; anchor?: string; label: string };

/** Intent → docs page (and heading anchor). The llms.txt route fails the build when a page or anchor is missing. */
export const LLMS_TASKS: LlmsTask[] = [
  { intent: "Delete the selected rows in bulk", slug: ["row-operations"], anchor: "programmatic-actions", label: "Row operations: Programmatic actions" },
  { intent: "Sort on the server", slug: ["sorting-filtering-search"], anchor: "controlled-mode-server-side-sortfilter", label: "Sorting, filtering & search: Controlled mode" },
  { intent: "Sort a lazy grid on the server", slug: ["lazy-loading"], anchor: "sorting-a-lazy-grid", label: "Lazy loading: Sorting a lazy grid" },
  { intent: "Export CSV only, or choose export options", slug: ["addons", "import-export"], anchor: "export", label: "Import & export: Export" },
  { intent: "Load rows lazily with a total and a loading state", slug: ["lazy-loading"], label: "Lazy loading" },
  { intent: "Undo and redo", slug: ["addons", "undo-redo"], anchor: "quick-start-usedatagridstate", label: "Undo & redo: Quick start" },
  { intent: "Control the selection from app state", slug: ["events-state"], anchor: "controlling-the-selection", label: "Events & state: Controlling the selection" },
  { intent: "Persist the column layout (widths, order, pins, hidden)", slug: ["columns"], anchor: "persisting-a-users-layout", label: "Columns: Persisting a user's layout" },
  { intent: "Limit imported files (size, rows, columns)", slug: ["addons", "import-export"], anchor: "import-limits", label: "Import & export: Import limits" },
  { intent: "Add a custom cell type", slug: ["custom-cell-types"], label: "Custom cell types" },
  { intent: "Paginate with bookmarkable pages", slug: ["pagination"], label: "Pagination" },
  { intent: "Find a callback or event", slug: ["events-state"], anchor: "find-the-callback-you-need", label: "Events & state: Find the callback you need" },
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
