import type { CommentEngine } from "./comment-engine";
import { resolveCommentsLabels } from "./labels";
import type { CommentMenuItem, CommentMenuItemsResolver, UseDataGridCommentsOptions } from "./types";

/** Appends a "Comments…" item to the cell menu. The popover opens on the next frame, after the menu has closed and returned focus. */
export function createMenuItemsResolver(engine: CommentEngine, getOptions: () => UseDataGridCommentsOptions): CommentMenuItemsResolver {
  return function getCommentMenuItems<TItem extends { id: string }>(
    ctx: { rowId: string; columnId: string; viewRowIndex: number },
    defaults: TItem[],
  ): (TItem | CommentMenuItem)[] {
    const label = resolveCommentsLabels(getOptions().labels).menuItem;
    const separator = { id: "sep-comments", separator: true } as unknown as TItem;
    const item: CommentMenuItem = {
      id: "comments",
      label,
      onClick: () => {
        requestAnimationFrame(() => {
          if (engine.isDisposed()) return;
          engine.openComments({ rowId: ctx.rowId, columnId: ctx.columnId }, "menu");
        });
      },
    };
    return [...defaults, separator, item];
  };
}
