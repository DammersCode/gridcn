/** Public entry point — the only module consumers/docs should import from. */

export { useDataGridHistory, type UseDataGridHistoryOptions, type UseDataGridHistoryResult } from "./use-data-grid-history";
export { useDataGridState, type UseDataGridStateOptions, type UseDataGridStateResult } from "./use-data-grid-state";

/** Offers the `undo`/`redo` global-shortcut flags — this add-on is what makes them do anything. */
// Relative on purpose: the shadcn CLI rewrites import paths, never augmentation module names.
declare module "../data-grid/keyboard/global-shortcuts" {
  interface DataGridGlobalShortcutActions {
    undo: true;
    redo: true;
  }
}
