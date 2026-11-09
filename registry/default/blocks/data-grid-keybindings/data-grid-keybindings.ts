/** Public entry point — the only module consumers/docs should import from. */

export { DataGridKeybindingsDialog, type DataGridKeybindingsDialogProps } from "./keybindings-dialog";
export {
  useDataGridKeybindings,
  type UseDataGridKeybindingsOptions,
  type UseDataGridKeybindingsResult,
} from "./use-data-grid-keybindings";
export { BindingChips } from "./binding-label";

// Relative on purpose: the shadcn CLI rewrites import paths, never augmentation module names.
declare module "../data-grid/types" {
  interface GridActions {
    openKeybindings: true;
  }
}
