import { resolveSelectChoices } from "../cell-types/select";
import { textAccessorFor } from "../store/compute";
import type { CellAccessor } from "./index";
import type { AnyColumnDef, CellType } from "../types";

type SetFilterValuesInput = {
  columns: readonly AnyColumnDef[];
  data: readonly unknown[];
  cellTypes: Record<string, CellType>;
  filterMode: "client" | "server";
};

/**
 * The lowercased values an `isAnyOf` or `isNoneOf` list restored from a link or a saved view may
 * keep: the column's `choices` plus every loaded data value, so each value the header filter offers
 * survives. Returns `undefined` (check nothing) for a column without choices, in server filter
 * mode (the server evaluates the values), and while no data has loaded. Builds each column's set on
 * first use.
 */
export function setFilterValuesOf(state: SetFilterValuesInput): (columnId: string) => ReadonlySet<string> | undefined {
  if (state.filterMode === "server" || state.data.length === 0) return () => undefined;
  const cache = new Map<string, ReadonlySet<string> | undefined>();
  let accessor: CellAccessor | undefined;
  return (columnId) => {
    if (cache.has(columnId)) return cache.get(columnId);
    const choices = (state.columns.find((c) => c.id === columnId)?.options as { choices?: Parameters<typeof resolveSelectChoices>[0] } | undefined)?.choices;
    let allowed: Set<string> | undefined;
    if (Array.isArray(choices) && choices.length > 0) {
      allowed = new Set(resolveSelectChoices(choices).map((choice) => choice.value.toLowerCase()));
      accessor ??= textAccessorFor(state.columns, state.data, state.cellTypes);
      for (let row = 0; row < state.data.length; row++) {
        if (state.data[row] !== undefined) allowed.add(accessor.getText(row, columnId).toLowerCase());
      }
    }
    cache.set(columnId, allowed);
    return allowed;
  };
}
