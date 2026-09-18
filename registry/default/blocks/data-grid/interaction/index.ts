/** Domain barrel — interaction hooks (grid pointer/keyboard, commit guard, seed focus, container) + history. */
export { createHistory, applyChange, invertChange, type History, type HistoryOptions } from "./history";
export { useCommitGuard } from "./use-commit-guard";
export { useSeedFocus } from "./use-seed-focus";
export { useDataGridContainer } from "./use-data-grid-container";
export {
  useGridInteraction,
  pointerToCoord,
  jumpToDataBoundary,
  type InteractionLayout,
  type UseGridInteractionOptions,
  type JumpDirection,
  type GridInteractionHandlers,
} from "./use-grid-interaction";
