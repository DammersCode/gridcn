/** Public entry point for the data-grid-find-replace add-on — the only module consumers should import from. */

export {
  useDataGridFindReplace,
  type UseDataGridFindReplaceOptions,
  type UseDataGridFindReplaceResult,
} from "./use-data-grid-find-replace";
export { planReplace, type ReplaceOptions, type ReplacePlan, type ReplaceSkipReason, type ReplaceState } from "./plan-replace";

// Relative on purpose: the shadcn CLI rewrites import paths, never augmentation module names.
declare module "../data-grid/types" {
  interface GridActions {
    openFindReplace: true;
    openFind: true;
  }
}
