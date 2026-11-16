import type { ColumnGroupModel } from "../columns/column-groups";
import { columnFlag, completeColumnOrder, pinZone, reorderColumnIds, reorderGroupBlock } from "./compute";
import type { AnyColumnDef } from "./types";

/**
 * Why `setColumnOrder` did not move: `"disabled"` — `enableColumnReorder` is `false`; `"unknown-column"` — `id` or
 * `targetId` names no column or group; `"not-reorderable"` — the column, the target, or a group member has
 * `reorderable: false`; `"pin-zone"` — the target sits in another pin zone; `"nothing-to-do"` — the move keeps the order.
 */
export type ColumnOrderSkipReason = "disabled" | "unknown-column" | "not-reorderable" | "pin-zone" | "nothing-to-do";

/** What `setColumnOrder` and `canSetColumnOrder` return: `ok` when the move changes the order, else the reason it does not. */
export type ColumnOrderResult = { ok: true } | { ok: false; reason: ColumnOrderSkipReason };

type ColumnOrderInput = {
  columns: readonly AnyColumnDef[];
  columnOrder: readonly string[] | null;
  enableColumnReorder: boolean;
};

const skip = (reason: ColumnOrderSkipReason) => ({ result: { ok: false, reason } as const });
const sameOrder = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, index) => id === b[index]);

/** The order a move produces, or the reason it changes nothing. */
export function planColumnOrder(
  s: ColumnOrderInput,
  groups: ColumnGroupModel | null | undefined,
  id: string,
  targetId: string,
  position: "before" | "after",
): { result: ColumnOrderResult; order?: string[] } {
  if (!s.enableColumnReorder) return skip("disabled");
  const target = s.columns.find((c) => c.id === targetId);
  const currentIds = completeColumnOrder(s.columns, s.columnOrder, groups);
  if (groups?.groups.has(id)) {
    const members = s.columns.filter((c) => groups.paths.get(c.id)?.includes(id));
    if (!target) return skip("unknown-column");
    if (!columnFlag(target, "reorderable") || members.some((c) => !columnFlag(c, "reorderable"))) return skip("not-reorderable");
    const order = reorderGroupBlock(currentIds, s.columns, groups, id, targetId, position);
    return sameOrder(order, currentIds) ? skip("nothing-to-do") : { result: { ok: true }, order };
  }
  const column = s.columns.find((c) => c.id === id);
  if (!column || !target) return skip("unknown-column");
  if (!columnFlag(column, "reorderable") || !columnFlag(target, "reorderable")) return skip("not-reorderable");
  if (pinZone(column) !== pinZone(target)) return skip("pin-zone");
  const order = reorderColumnIds(currentIds, s.columns, id, targetId, position, groups);
  return sameOrder(order, currentIds) ? skip("nothing-to-do") : { result: { ok: true }, order };
}
