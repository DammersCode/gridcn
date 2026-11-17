import { resolveSelectChoices } from "../cell-types/select";
import { textAccessorFor } from "../store/compute";
import type { CellAccessor } from "./index";
import type { CellType } from "../types";
import type { AnyColumnDef } from "../store/types";

type SetFilterValuesInput = {
  columns: readonly AnyColumnDef[];
  data: readonly unknown[];
  cellTypes: Record<string, CellType>;
  filterMode: "client" | "server";
  fetchFilterValues?: unknown;
};

const MIN_CHOICE_LIST_BOUND = 64;

const serverListsValues = (state: Pick<SetFilterValuesInput, "filterMode" | "fetchFilterValues">) => state.filterMode === "server" || state.fetchFilterValues !== undefined;

/**
 * The list bound of an `isAnyOf` or `isNoneOf` list restored from a link or a saved view:
 * `undefined` (the default of 1,000) when the server lists the column's values, else the larger of
 * 64 and the number of static `choices`; `undefined` for a column without `choices`.
 */
export function setFilterListBound(state: Pick<SetFilterValuesInput, "filterMode" | "fetchFilterValues">, column: { id?: string; options?: unknown } | undefined): number | undefined {
  const choices = (column?.options as { choices?: unknown } | undefined)?.choices;
  if (serverListsValues(state) || !Array.isArray(choices) || choices.length === 0) return undefined;
  return Math.max(choices.length, MIN_CHOICE_LIST_BOUND);
}

/**
 * The lowercased values an `isAnyOf` or `isNoneOf` list restored from a link or a saved view may
 * keep: the column's `choices` plus every loaded data value, so each value the header filter offers
 * survives. Returns `undefined` (check nothing) for a column without choices, when the server lists the values
 * (`filterMode="server"` or `fetchFilterValues`; the server evaluates them), and while no data has loaded. Builds each column's set on
 * first use.
 */
export function setFilterValuesOf(state: SetFilterValuesInput): (columnId: string) => ReadonlySet<string> | undefined {
  if (serverListsValues(state) || state.data.length === 0) return () => undefined;
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
