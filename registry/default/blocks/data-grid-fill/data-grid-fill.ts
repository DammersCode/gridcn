/** Public entry point — the only module consumers/docs should import from. */
export { useDataGridFill, type UseDataGridFillOptions, type UseDataGridFillResult, type FillArgs } from "./use-data-grid-fill";
export { computeFillTarget, type AllowedFillDirections, type ComputeFillTargetOptions } from "./fill";
export { detectSeries, type SeriesDescriptor } from "./fill";
export { generateFill, type FillDirection, type GenerateFillOptions } from "./fill";
export { fillDirection, rectRelativeTo } from "./fill";

/** Offers the `fillDown`/`fillRight` global-shortcut flags — this add-on is what makes them do anything. */
// Relative on purpose: the shadcn CLI rewrites import paths, never augmentation module names.
declare module "../data-grid/keyboard/global-shortcuts" {
  interface DataGridGlobalShortcutActions {
    fillDown: true;
    fillRight: true;
  }
}
