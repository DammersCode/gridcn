/** Compile-time check: types the docs teach are importable from the public barrel. */
import type {
  DataGridFilterOperatorLabels,
  DataGridFindReplaceLabels,
  DataGridSortLabels,
  ErrorStateContext,
  ErrorStateRenderer,
  UseDataGridClipboardOptions,
} from "./data-grid";

export type BarrelTypes = [
  DataGridFilterOperatorLabels,
  DataGridFindReplaceLabels,
  DataGridSortLabels,
  ErrorStateContext,
  UseDataGridClipboardOptions,
];

export const renderError: ErrorStateRenderer = ({ error, retry }) => (retry ? String(error) : null);
