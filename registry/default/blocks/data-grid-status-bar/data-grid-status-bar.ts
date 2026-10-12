/** Public entry point — the only module consumers/docs should import from. */

export {
  DataGridStatusBar,
  type DataGridStatusBarProps,
  type StatusBarAggregate,
} from "./status-bar";
export { useDataGridSelectionStats } from "./use-data-grid-selection-stats";
export { MAX_STATUS_CELLS, type SelectionStats } from "./compute-selection-stats";
