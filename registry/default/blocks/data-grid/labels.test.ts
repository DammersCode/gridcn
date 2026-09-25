import { describe, it, expect } from "vitest";
import { DEFAULT_LABELS, deepMergeLabels, type DataGridLabels } from "./labels";

/** Recursively walks every leaf of {@link DEFAULT_LABELS}, asserting it's a non-empty string or a function. */
function walkLeaves(value: unknown, path: string, onLeaf: (path: string, leaf: unknown) => void): void {
  if (typeof value === "function" || typeof value === "string") {
    onLeaf(path, value);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) walkLeaves(child, `${path}.${key}`, onLeaf);
    return;
  }
  onLeaf(path, value);
}

describe("DEFAULT_LABELS", () => {
  it("every leaf is a non-empty string or a function (no missing/blank defaults)", () => {
    walkLeaves(DEFAULT_LABELS, "labels", (path, leaf) => {
      const ok = typeof leaf === "function" || (typeof leaf === "string" && leaf.length > 0);
      expect(ok, `${path} should be a non-empty string or function, got ${JSON.stringify(leaf)}`).toBe(true);
    });
  });

  it("interpolated function labels are callable and return non-empty strings", () => {
    expect(DEFAULT_LABELS.toolbar.searchMatches(3, 17)).toBe("3/17");
    expect(DEFAULT_LABELS.toolbar.searchMatchesCapped(1)).toBe("1/1000+");
    expect(DEFAULT_LABELS.contextMenu.duplicateRows(1)).toBe("Duplicate row");
    expect(DEFAULT_LABELS.contextMenu.duplicateRows(3)).toBe("Duplicate rows");
    expect(DEFAULT_LABELS.contextMenu.deleteRows(1)).toBe("Delete row");
    expect(DEFAULT_LABELS.contextMenu.deleteRows(3)).toBe("Delete rows");
    expect(DEFAULT_LABELS.contextMenu.columnMenuAriaLabel("Name")).toBe("Name column menu");
    expect(DEFAULT_LABELS.markers.selectRow(4)).toBe("Select row 4");
    expect(DEFAULT_LABELS.toolbar.filterValueAnyOfSummary(0)).toBe("Any value");
    expect(DEFAULT_LABELS.toolbar.filterValueAnyOfSummary(2)).toBe("2 selected");
    expect(DEFAULT_LABELS.toolbar.filterReorderAnnouncement("Name", 2, 3)).toBe("Name filter moved to position 2 of 3");
    expect(DEFAULT_LABELS.sort.sortReorderAnnouncement("Age", 1, 4)).toBe("Age sort moved to position 1 of 4");
    expect(DEFAULT_LABELS.io.columnFallback(3)).toBe("Column 3");
    expect(DEFAULT_LABELS.io.mapColumnAriaLabel("Email")).toBe('Map "Email" to grid column');
    expect(DEFAULT_LABELS.io.previewTruncated(50, 1000)).toBe("Showing 50 of 1000 rows");
    expect(DEFAULT_LABELS.io.sheet).toBe("Sheet");
    expect(DEFAULT_LABELS.io.importRejectedCells(1)).toBe("1 cell failed validation and was left empty.");
    expect(DEFAULT_LABELS.io.importRejectedCells(3)).toBe("3 cells failed validation and were left empty.");
  });
});

describe("deepMergeLabels", () => {
  it("returns the base object unchanged when there's no override", () => {
    expect(deepMergeLabels(DEFAULT_LABELS, undefined)).toBe(DEFAULT_LABELS);
  });

  it("a partial override at a nested group keeps its untouched sibling keys", () => {
    const merged = deepMergeLabels(DEFAULT_LABELS, { toolbar: { searchPlaceholder: "Suchen…" } });
    expect(merged.toolbar.searchPlaceholder).toBe("Suchen…");
    // siblings in the same group survive untouched
    expect(merged.toolbar.filter).toBe(DEFAULT_LABELS.toolbar.filter);
    expect(merged.toolbar.addFilter).toBe(DEFAULT_LABELS.toolbar.addFilter);
    // untouched top-level groups survive untouched (by reference)
    expect(merged.contextMenu).toBe(DEFAULT_LABELS.contextMenu);
    expect(merged.keybindings).toBe(DEFAULT_LABELS.keybindings);
  });

  it("merges nested groups two levels deep (keybindings.categories)", () => {
    const merged = deepMergeLabels(DEFAULT_LABELS, { keybindings: { categories: { navigation: "Navigation (DE)" } } });
    expect(merged.keybindings.categories.navigation).toBe("Navigation (DE)");
    expect(merged.keybindings.categories.selection).toBe(DEFAULT_LABELS.keybindings.categories.selection);
    expect(merged.keybindings.title).toBe(DEFAULT_LABELS.keybindings.title);
  });

  it("replaces a function label wholesale rather than merging into it", () => {
    const customSearchMatches = (current: number, total: number) => `${current} of ${total}`;
    const merged = deepMergeLabels(DEFAULT_LABELS, { toolbar: { searchMatches: customSearchMatches } });
    expect(merged.toolbar.searchMatches).toBe(customSearchMatches);
    expect(merged.toolbar.searchMatches(2, 5)).toBe("2 of 5");
  });

  it("replaces the 3-arg reorder-announcement functions (filter and sort) wholesale, keeping siblings", () => {
    const customFilterAnnouncement = (column: string, position: number, total: number) => `${column} @ ${position}/${total}`;
    const customSortAnnouncement = (column: string, position: number, total: number) => `sort ${column} -> ${position} of ${total}`;
    const merged = deepMergeLabels(DEFAULT_LABELS, {
      toolbar: { filterReorderAnnouncement: customFilterAnnouncement },
      sort: { sortReorderAnnouncement: customSortAnnouncement },
    });
    expect(merged.toolbar.filterReorderAnnouncement).toBe(customFilterAnnouncement);
    expect(merged.toolbar.filterReorderAnnouncement("Name", 2, 3)).toBe("Name @ 2/3");
    expect(merged.sort.sortReorderAnnouncement).toBe(customSortAnnouncement);
    expect(merged.sort.sortReorderAnnouncement("Age", 1, 4)).toBe("sort Age -> 1 of 4");
    // untouched sibling keys in the same groups survive by reference
    expect(merged.toolbar.reorderFilterAriaLabel).toBe(DEFAULT_LABELS.toolbar.reorderFilterAriaLabel);
    expect(merged.sort.reorderSortAriaLabel).toBe(DEFAULT_LABELS.sort.reorderSortAriaLabel);
  });

  it("a full-object override replaces the whole group, not a merge", () => {
    const customFilterOperators: DataGridLabels["filterOperators"] = {
      contains: "x", notContains: "x", equals: "x", notEquals: "x",
      startsWith: "x", endsWith: "x", empty: "x", notEmpty: "x",
      gt: "x", gte: "x", lt: "x", lte: "x", isBetween: "x", isAnyOf: "x",
    };
    const merged = deepMergeLabels(DEFAULT_LABELS, { filterOperators: customFilterOperators });
    expect(merged.filterOperators).toEqual(customFilterOperators);
  });

  it("replaces wholesale when base is not a plain object (e.g. called directly on a leaf)", () => {
    expect(deepMergeLabels("base string" as never, "override string" as never)).toBe("override string");
  });

  it("never mutates the base object", () => {
    const snapshot: unknown = JSON.parse(JSON.stringify(DEFAULT_LABELS, (_key, value: unknown) => (typeof value === "function" ? "[fn]" : value)));
    deepMergeLabels(DEFAULT_LABELS, { toolbar: { searchPlaceholder: "changed" } });
    const after: unknown = JSON.parse(JSON.stringify(DEFAULT_LABELS, (_key, value: unknown) => (typeof value === "function" ? "[fn]" : value)));
    expect(after).toEqual(snapshot);
  });
});
