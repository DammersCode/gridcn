/**
 * Compile-time-only check: `GridMenuItemSpec.id` completes the built-in ids and still takes any
 * string, and `useDataGridRowOps()` needs no argument. The tsc gate typechecks this file.
 */
import { useDataGridRowOps, type BuiltInMenuItemId, type CellMenuItemsResolver } from "./data-grid-context-menu";

export const keepClipboard: CellMenuItemsResolver = (_ctx, defaults) => defaults.filter((spec) => spec.id === "copy" || spec.id === "my-own");

const builtIn: BuiltInMenuItemId = "delete-rows";
// @ts-expect-error a built-in id typo is not a BuiltInMenuItemId
const typo: BuiltInMenuItemId = "delete-row";
export const headerMenuIds = ["sep-move", "move-toward-start", "move-toward-end", "widen-column", "narrow-column"] as const satisfies readonly BuiltInMenuItemId[];

export function useFlags(): boolean {
  const { canCreateRow, canDuplicateRow } = useDataGridRowOps();
  return canCreateRow && canDuplicateRow;
}

void builtIn;
void typo;
