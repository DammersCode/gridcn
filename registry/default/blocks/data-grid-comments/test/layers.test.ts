// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createCommentEngine } from "../comment-engine";
import { DEFAULT_COMMENTS_LABELS } from "../labels";
import { commentMenuItems, createMenuItemsResolver } from "../menu-items";
import type { CellComment, UseDataGridCommentsOptions } from "../types";

const record: CellComment = { id: "c1", rowId: "r1", columnId: "name", text: "hi", author: { id: "a" }, createdAt: 1, updatedAt: 1, version: 1, resolved: false };

function make(options: UseDataGridCommentsOptions = {}, controlled = false) {
  return createCommentEngine({ getOptions: () => options, controlled });
}

describe("comments labels layers", () => {
  it("uses the defaults without a grid", () => {
    expect(make().labels().locale).toBe(DEFAULT_COMMENTS_LABELS.locale);
  });

  it("takes the grid locale and labels.comments, and lets the hook labels win", () => {
    const engine = make({ labels: { cancel: "Hook cancel" } });
    engine.attachGrid({ readOnly: () => false, saveStatus: () => undefined, open: () => true, gridLabels: () => ({ locale: "de-DE", comments: { cancel: "Grid cancel", save: "Sichern" } }) });
    const labels = engine.labels();
    expect(labels.locale).toBe("de-DE");
    expect(labels.save).toBe("Sichern");
    expect(labels.cancel).toBe("Hook cancel");
  });

  it("lets a hook locale beat the grid locale", () => {
    const engine = make({ labels: { locale: "fr-FR" } });
    engine.attachGrid({ readOnly: () => false, saveStatus: () => undefined, open: () => true, gridLabels: () => ({ locale: "de-DE" }) });
    expect(engine.labels().locale).toBe("fr-FR");
  });
});

describe("seed", () => {
  it("applies a function seed result once", () => {
    const engine = make();
    engine.seed([record]);
    expect(engine.getComments()).toHaveLength(1);
  });

  it("ignores the seed when controlled", () => {
    const engine = make({ comments: [] }, true);
    engine.seed([record]);
    expect(engine.getComments()).toHaveLength(0);
  });
});

describe("menu items", () => {
  const engine = make();
  const ctx = { rowId: "r1", columnId: "name", viewRowIndex: 0 };

  it("returns a typed separator and the item", () => {
    const [separator, item] = commentMenuItems(engine, ctx);
    expect(separator).toEqual({ id: "sep-comments", separator: true });
    expect(item.id).toBe("comments");
    expect(item.label).toBe(DEFAULT_COMMENTS_LABELS.menuItem);
  });

  it("the manual resolver appends once and skips a menu that already holds the item", () => {
    const resolve = createMenuItemsResolver(engine);
    const once = resolve(ctx, [{ id: "copy" }]);
    expect(once.map((i) => i.id)).toEqual(["copy", "sep-comments", "comments"]);
    expect(resolve(ctx, once as { id: string }[])).toBe(once);
  });
});
