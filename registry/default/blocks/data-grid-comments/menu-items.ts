import type { CommentEngine } from "./comment-engine";
import type { CommentMenuItem, CommentMenuItemsResolver, CommentMenuSeparator } from "./types";

const COMMENTS_ITEM_ID = "comments";

type MenuCtx = { rowId: string; columnId: string };

/** The separator and the "Comments…" item. The popover opens on the next frame, after the menu has closed and returned focus. */
export function commentMenuItems(engine: CommentEngine, ctx: MenuCtx): [CommentMenuSeparator, CommentMenuItem] {
  return [
    { id: "sep-comments", separator: true },
    {
      id: COMMENTS_ITEM_ID,
      label: engine.labels().menuItem,
      onClick: () => {
        requestAnimationFrame(() => {
          if (engine.isDisposed()) return;
          engine.openComments({ rowId: ctx.rowId, columnId: ctx.columnId }, "menu");
        });
      },
    },
  ];
}

/** The manual path for a menu that does not read plugin items; it adds nothing when the plugin's item is already there. */
export function createMenuItemsResolver(engine: CommentEngine): CommentMenuItemsResolver {
  return function getCommentMenuItems<TItem extends { id: string }>(
    ctx: { rowId: string; columnId: string; viewRowIndex: number },
    defaults: TItem[],
  ): (TItem | CommentMenuItem | CommentMenuSeparator)[] {
    if (defaults.some((item) => item.id === COMMENTS_ITEM_ID)) return defaults;
    return [...defaults, ...commentMenuItems(engine, ctx)];
  };
}
