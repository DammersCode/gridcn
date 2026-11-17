/** Public entry point: the only module consumers and docs import from. */
export { useDataGridComments } from "./use-data-grid-comments";
export type { DataGridCommentsLabels } from "./labels";
export type {
  ApplyRemoteSkipReason,
  ApplyRemoteVerdict,
  CellComment,
  CommentAction,
  CommentAuthor,
  CommentChange,
  CommentCreateGateCtx,
  CommentFetchCtx,
  CommentFetchErrorCtx,
  CommentGateCtx,
  CommentMenuItem,
  CommentMenuItemsResolver,
  CommentRejectedCtx,
  CommentRejectReason,
  CommentSaveAck,
  CommentSaveCtx,
  CommentSaveRejectReason,
  CommentSaveResult,
  CommentSource,
  CommentsChangeCtx,
  OrphanedCommentsCtx,
  UseDataGridCommentsOptions,
  UseDataGridCommentsResult,
} from "./types";

// Relative on purpose: the shadcn CLI rewrites import paths, never augmentation module names.
declare module "../data-grid/types" {
  interface GridActions {
    openComments: true;
  }
}
