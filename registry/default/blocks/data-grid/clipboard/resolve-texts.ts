import type { DataGridStoreState } from "../store/types";
import type { ViewCoord } from "../types";
import { isThenable } from "../store/async-gate";

/**
 * Calls each touched column's `resolveTexts` once with the column's distinct texts. Returns `undefined`
 * when no hook answered with a promise, so a sync paste keeps its straight-line cost.
 */
export function resolveColumnTexts(s: DataGridStoreState, cells: readonly (readonly string[])[], target: ViewCoord, signal: () => AbortSignal): Promise<void> | undefined {
  const pending: Promise<void>[] = [];
  const width = cells.reduce((max, row) => Math.max(max, row.length), 0);
  for (let c = 0; c < width && target.col + c < s.visibleColumns.length; c++) {
    const column = s.visibleColumns[target.col + c]!; // bounded by the loop condition
    const resolveTexts = s.cellTypes[column.type ?? "text"]?.resolveTexts;
    if (!resolveTexts) continue;
    const texts = new Set<string>();
    for (const row of cells) if (row[c] !== undefined) texts.add(row[c]);
    const answer = resolveTexts.call(s.cellTypes[column.type ?? "text"], [...texts], column.options, { signal: signal() });
    if (isThenable(answer)) pending.push(Promise.resolve(answer));
  }
  return pending.length > 0 ? Promise.all(pending).then(() => undefined) : undefined;
}
