import type { CheckedRowsLifetime } from "../types";
import { resolveFilterMode, resolveSortMode } from "./compute";
import type { DataGridStoreState, InternalSyncProps } from "./types";

/**
 * The lifetime that applies: the default follows `totalRowCount` and the marker checkboxes, and `"across-filters"` on a server-sorted
 * or server-filtered grid without `totalRowCount` is `"until-cleared"`.
 */
export function resolveCheckedRowsLifetime(props: InternalSyncProps): CheckedRowsLifetime {
  const windowed = props.totalRowCount !== undefined;
  const lifetime = props.checkedRowsLifetime ?? (windowed ? "across-filters" : /(checkbox|both)$/.test(props.rowMarkers ?? "none") ? "until-cleared" : "until-click");
  const holdsEveryRow = windowed || (resolveSortMode(props) !== "server" && resolveFilterMode(props) !== "server");
  return lifetime === "across-filters" && !holdsEveryRow ? "until-cleared" : lifetime;
}

/** Resolves the optional selection-config sync props to their defaults, and a non-finite or negative `totalRowCount` to `null`. */
export function resolveSelectionConfig(props: InternalSyncProps): Pick<
  DataGridStoreState,
  | "rowMarkers"
  | "enableRowSelection"
  | "enableRowDelete"
  | "checkedRowsLifetime"
  | "totalRowCount"
  | "enableColumnSelection"
  | "enableRangeSelection"
  | "enableMultiRange"
  | "enableColumnResize"
  | "enableColumnReorder"
  | "enableColumnPinning"
  | "headerClickBehavior"
> {
  return {
    rowMarkers: props.rowMarkers ?? "none",
    enableRowSelection: props.enableRowSelection ?? true,
    enableRowDelete: props.enableRowDelete ?? true,
    checkedRowsLifetime: resolveCheckedRowsLifetime(props),
    totalRowCount: typeof props.totalRowCount === "number" && !(Number.isFinite(props.totalRowCount) && props.totalRowCount >= 0) ? null : props.totalRowCount,
    enableColumnSelection: props.enableColumnSelection ?? true,
    enableRangeSelection: props.enableRangeSelection ?? true,
    enableMultiRange: props.enableMultiRange ?? true,
    enableColumnResize: props.enableColumnResize ?? true,
    enableColumnReorder: props.enableColumnReorder ?? true,
    enableColumnPinning: props.enableColumnPinning ?? true,
    headerClickBehavior: props.headerClickBehavior ?? (props.totalRowCount !== undefined ? "sort" : "select"),
  };
}
