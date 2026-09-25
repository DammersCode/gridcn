import type { CellCoord, CellType, DataChange, DataOp } from "../types";
import type { OverlayPlugin } from "../overlays";
import type { RowBandsSpec } from "../layout-context";
import { getCellValue, setCellValue } from "../columns/column-helpers";
import { isDev } from "../is-dev";
import { isStandardSchema, runValidateSync, type ValidateResult } from "../validation/validate-cell";
import { runValidateBatch, type ValidateBatchItem } from "../validation/validate-batch";
import { isColumnReadOnly } from "./compute";
import { cellTypes as defaultCellTypes } from "../cell-types/cell-types";
import type { AnyColumnDef, CellPatch, CommitResult, DataGridStoreState, InternalSyncProps, RowEdit, UpdateCellsSkip } from "./types";

export function warnDev(message: string): void {
  if (isDev()) console.warn(`[data-grid] ${message}`);
}

/**
 * Warns once per instance (per passed Set) for every column whose `type` resolves to nothing in
 * the effective cellTypes registry (the passed registry, or the built-ins when none was passed) —
 * a typo silently degrades the column to text rendering, and its edit/paste/delete paths go dead
 * (see `resolveEditTarget`). The single warn site for the cellTypes replace-semantics footgun
 * (a custom registry omitting a used type); do not add a second one.
 */
export function checkUnresolvableColumnTypes(
  columns: readonly AnyColumnDef[],
  cellTypes: Readonly<Record<string, unknown>> | undefined,
  warned: Set<string>,
): void {
  if (!isDev()) return;
  const registry: Record<string, unknown> = cellTypes ?? defaultCellTypes;
  for (const column of columns) {
    if (column.type === undefined || registry[column.type] !== undefined) continue;
    const key = `${column.id}:${column.type}`;
    if (warned.has(key)) continue;
    warned.add(key);
    warnDev(`column "${column.id}" has type "${column.type}" which resolves to nothing in the cellTypes registry (typo or a custom registry without it); it renders as text and its edits, pastes, and deletes are dropped`);
  }
}

/** Fires `warnDev` at most once per session — for guardrails whose cause (a mistaken prop combo) doesn't change across re-renders, so repeating it every render would just be noise. */
let warnedBothDataProps = false;

/** `data` + `defaultData` are mutually exclusive (React value/defaultValue semantics); `data` wins. */
export function warnBothDataPropsOnce(): void {
  if (warnedBothDataProps || !isDev()) return;
  warnedBothDataProps = true;
  warnDev("both `data` and `defaultData` were provided; `data` wins (controlled) and `defaultData` is ignored");
}

/** Dev-only guardrails: duplicate column ids, missing getRowId, unstable columns/data/overlayPlugins/rowBands identity across renders. */
export function checkDevGuardrails(
  props: InternalSyncProps,
  prevColumns: readonly AnyColumnDef[] | undefined,
  prevData: readonly unknown[] | undefined,
  prevOverlayPlugins: readonly OverlayPlugin[] | undefined,
  prevRowBands: RowBandsSpec | undefined,
): void {
  if (!isDev()) return;

  const seen = new Set<string>();
  for (const column of props.columns) {
    if (seen.has(column.id)) warnDev(`duplicate column id "${column.id}"`);
    seen.add(column.id);
  }

  if (typeof props.getRowId !== "function") {
    warnDev("getRowId is required and must be a function");
  }

  if (props.data !== undefined && props.defaultData !== undefined) {
    warnBothDataPropsOnce();
  }

  if (prevColumns !== undefined && prevColumns !== props.columns) {
    warnDev(
      "columns array identity changed since the last render; pass a stable reference (e.g. useMemo) or every row re-renders",
    );
  }
  if (prevOverlayPlugins !== undefined && prevOverlayPlugins !== props.overlayPlugins) {
    warnDev(
      "overlayPlugins array identity changed since the last render; pass a stable reference (module scope or useMemo) or DataGridOverlays re-renders every tick",
    );
  }
  if (prevRowBands !== undefined && prevRowBands !== props.rowBands) {
    warnDev(
      "rowBands identity changed since the last render; pass a stable reference (the add-on's hook already returns one) or every render recomputes band heights/aria-rowcount",
    );
  }
  // Controlled mode only: in uncontrolled mode props.data is undefined (data lives in the store),
  // and the store's own array legitimately gets a new reference on every mutation — not a bug.
  if (props.data !== undefined && prevData !== undefined && prevData !== props.data && prevData.length === props.data.length) {
    // Only identity churn with zero row changes is the anti-pattern (array rebuilt per render);
    // a legitimate immutable edit swaps ≥1 row reference — the early exit keeps this cheap for it.
    const data = props.data;
    let anyRowChanged = false;
    for (let i = 0; i < prevData.length; i++) {
      if (prevData[i] !== data[i]) {
        anyRowChanged = true;
        break;
      }
    }
    if (!anyRowChanged) {
      warnDev("data array identity changed with no row changes; pass a stable reference (rebuilding it every render defeats row memoization)");
    }
  }
}

/**
 * Shared value-write path for both `commitCellEdit` (editing session) and `commitCellValue` (direct
 * write, e.g. checkbox toggle). `value` may already be schema-validated+transformed (the async
 * editor-commit layer passes `result.value`, having awaited the schema itself) — this still
 * re-runs `validate` (cheap, idempotent for a well-behaved schema) so the sync/function-form path
 * is unchanged and a direct `commitCellValue` call always gets checked.
 *
 * `onInvalid: "warn"` columns commit a rejected value (raw — a rejection carries no transformed
 * value) and report it in `warnings` so the store can flag the cell in `cellErrors`; `rejection`
 * is the async layer's awaited schema rejection, which the sync re-run here cannot see (a schema
 * Promise passes `runValidateSync` untouched).
 */
export function computeCommit(s: DataGridStoreState, coord: CellCoord, value: unknown, rejection?: string): CommitResult {
  const target = resolveEditTarget(s, coord);
  if (!target) return { noop: true };
  const { column, dataRowIndex, row } = target;
  const validated = runValidateSync(column.validate, value, row);
  let nextValue: unknown;
  let warning: string | undefined;
  if ("error" in validated) {
    if (column.onInvalid !== "warn") return { error: validated.error };
    nextValue = value;
    warning = validated.error;
  } else {
    nextValue = validated.value;
    if (rejection !== undefined && column.onInvalid === "warn") warning = rejection;
  }
  const prevValue = getCellValue(row, column);
  if (Object.is(prevValue, nextValue)) {
    // re-committing the SAME invalid value is a deliberate keep: the flag (re)lands
    return warning === undefined
      ? { noop: true }
      : { noop: true, warnings: [{ rowId: s.getRowId(row, dataRowIndex), columnId: column.id, message: warning }] };
  }

  const nextRow = setCellValue(row, column, nextValue);
  const nextData = s.data.slice();
  nextData[dataRowIndex] = nextRow;
  const rowId = s.getRowId(nextRow, dataRowIndex);
  const change: DataChange<unknown> = {
    source: "edit",
    ops: [
      {
        type: "update",
        rowId,
        row: nextRow,
        prev: row,
        cells: [{ columnId: column.id, value: nextValue, prev: prevValue }],
      },
    ],
  };
  return warning === undefined
    ? { data: nextData, change }
    : { data: nextData, change, warnings: [{ rowId, columnId: column.id, message: warning }] };
}

/** Looks up the column, data row, and cell type at a view coord; null when any part is unresolvable. */
export function resolveEditTarget(
  s: DataGridStoreState,
  coord: CellCoord,
): { column: AnyColumnDef; dataRowIndex: number; row: unknown; cellType: CellType } | null {
  const column = s.visibleColumns[coord.col];
  if (!column) return null;
  const dataRowIndex = s.viewIndex[coord.row];
  if (dataRowIndex === undefined) return null;
  const row = s.data[dataRowIndex];
  if (row === undefined) return null;
  const cellType = s.cellTypes[column.type ?? "text"];
  if (!cellType) return null;
  return { column, dataRowIndex, row, cellType };
}

/**
 * Applies `writes` (view-row + column-id + already-resolved value) against `s`, deduping multiple
 * writes to the same row/column (last one wins), skipping readOnly cells, unresolvable rows/columns,
 * and no-op values (`Object.is` against the current value). Shared by `deleteSelection` and
 * `applyCellUpdates` so both funnel through one row-edit accumulation + op-building path.
 */
export function computeRowEditsBatch(
  s: DataGridStoreState,
  writes: { viewRow: number; columnId: string; value: unknown }[],
): { nextData: readonly unknown[]; ops: DataOp<unknown>[] } | null {
  const rowEdits = new Map<number, RowEdit>();
  const columnById = new Map(s.visibleColumns.map((column) => [column.id, column] as const));

  for (const write of writes) {
    const dataRowIndex = s.viewIndex[write.viewRow];
    if (dataRowIndex === undefined) continue;
    const column = columnById.get(write.columnId);
    if (!column) continue;

    const entry = rowEdits.get(dataRowIndex);
    const baseRow = entry?.row ?? s.data[dataRowIndex];
    if (baseRow === undefined) continue;
    if (isColumnReadOnly(column, baseRow)) continue;

    // explicit TData=unknown: baseRow's `undefined`-narrowed type ({} | null) would otherwise drive
    // inference instead of column's own already-unknown TData, tripping ColumnDef<unknown>'s setValue.
    const prevValue = getCellValue<unknown, typeof column>(baseRow, column);
    if (Object.is(prevValue, write.value)) continue;

    const row = setCellValue<unknown, typeof column>(baseRow, column, write.value);
    const cells = entry?.cells ?? new Map<string, { columnId: string; value: unknown; prev: unknown }>();
    // last write to this row/column wins; `prev` stays the value before ANY write in this batch.
    const existingPrev = cells.get(column.id)?.prev ?? prevValue;
    cells.set(column.id, { columnId: column.id, value: write.value, prev: existingPrev });
    rowEdits.set(dataRowIndex, { row, cells });
  }

  if (rowEdits.size === 0) return null;

  const nextData = s.data.slice();
  const ops: DataOp<unknown>[] = [];
  for (const [dataRowIndex, { row, cells }] of rowEdits) {
    const prevRow = s.data[dataRowIndex];
    nextData[dataRowIndex] = row;
    ops.push({
      type: "update",
      rowId: s.getRowId(row, dataRowIndex),
      row,
      prev: prevRow,
      cells: Array.from(cells.values()),
    });
  }
  return { nextData, ops };
}

/**
 * Applies id-keyed {@link CellPatch}es against `s` — the direct-update path's counterpart to
 * {@link computeRowEditsBatch}. Differences, all deliberate: rows are addressed by STABLE ROW ID
 * through the caller-supplied `rowIndex` map (never a view index, so a patch survives an active
 * sort), and every column is resolvable, not only visible ones (a streaming producer must be able
 * to write a column the user has hidden). Same skip rules otherwise: unknown row, unknown column,
 * readOnly cell, and `Object.is`-equal no-op writes are dropped; duplicate patches to one cell
 * dedupe last-write-wins with `prev` held at the pre-batch value.
 *
 * `skipValidation` bypasses the per-column `validate` a 200-cell tick would otherwise re-run for a
 * producer that already validated; otherwise a cell whose value fails validation is skipped,
 * matching {@link computeRowEditsBatch}'s bulk contract (a stream has no UI surface to reject a
 * batch on and must never drop a whole batch for one bad value). Every skipped patch is named in
 * the returned `skipped` list for the action's verdict.
 */
export function computeCellPatchBatch(
  s: DataGridStoreState,
  patches: readonly CellPatch[],
  rowIndex: ReadonlyMap<string, number>,
  skipValidation: boolean,
): { nextData: readonly unknown[] | null; ops: DataOp<unknown>[]; touchedRows: number[]; skipped: UpdateCellsSkip[] } {
  const columnsById = new Map(s.columns.map((c) => [c.id, c] as const));
  const rowEdits = new Map<number, RowEdit>();
  const skipped: UpdateCellsSkip[] = [];

  for (let patchIndex = 0; patchIndex < patches.length; patchIndex++) {
    const patch = patches[patchIndex]!;
    const dataRowIndex = rowIndex.get(patch.rowId);
    if (dataRowIndex === undefined) {
      skipped.push({ patchIndex, reason: "unknown-row" });
      continue;
    }
    const column = columnsById.get(patch.columnId);
    if (!column) {
      skipped.push({ patchIndex, reason: "unknown-column" });
      continue;
    }

    const entry = rowEdits.get(dataRowIndex);
    const baseRow = entry?.row ?? s.data[dataRowIndex];
    if (baseRow === undefined) {
      skipped.push({ patchIndex, reason: "hole" });
      continue;
    }
    if (isColumnReadOnly(column, baseRow)) {
      skipped.push({ patchIndex, reason: "readonly" });
      continue;
    }

    let value = patch.value;
    if (!skipValidation) {
      const validated = runValidateSync(column.validate, value, baseRow);
      if ("error" in validated) {
        skipped.push({ patchIndex, reason: "invalid" });
        continue;
      }
      value = validated.value;
    }

    const prevValue = getCellValue<unknown, typeof column>(baseRow, column);
    if (Object.is(prevValue, value)) {
      skipped.push({ patchIndex, reason: "no-op" });
      continue;
    }

    const row = setCellValue<unknown, typeof column>(baseRow, column, value);
    const cells = entry?.cells ?? new Map<string, { columnId: string; value: unknown; prev: unknown }>();
    const existingPrev = cells.get(column.id)?.prev ?? prevValue;
    cells.set(column.id, { columnId: column.id, value, prev: existingPrev });
    rowEdits.set(dataRowIndex, { row, cells });
  }

  if (rowEdits.size === 0) return { nextData: null, ops: [], touchedRows: [], skipped };

  const nextData = s.data.slice();
  const ops: DataOp<unknown>[] = [];
  // The data indices whose values actually changed — the incremental view-index path's input.
  const touchedRows: number[] = [];
  for (const [dataRowIndex, { row, cells }] of rowEdits) {
    const prevRow = s.data[dataRowIndex];
    nextData[dataRowIndex] = row;
    touchedRows.push(dataRowIndex);
    ops.push({
      type: "update",
      rowId: s.getRowId(row, dataRowIndex),
      row,
      prev: prevRow,
      cells: Array.from(cells.values()),
    });
  }
  return { nextData, ops, touchedRows, skipped };
}

/**
 * Whether any column `patches` writes carries a Standard Schema, the only `validate` form that can
 * be async. A purely structural test — it never CALLS a validator, so the ordinary streaming tick
 * (no validators, or the function form) pays one map lookup per patch and nothing else, and
 * `computeCellPatchBatch` still runs every validator exactly once, inline, as it always has.
 */
export function patchesNeedAsyncCheck(s: DataGridStoreState, patches: readonly CellPatch[]): boolean {
  const columnsById = new Map(s.columns.map((c) => [c.id, c] as const));
  for (const patch of patches) {
    if (isStandardSchema(columnsById.get(patch.columnId)?.validate)) return true;
  }
  return false;
}

/**
 * Validates `patches` for {@link DataGridActions.updateCells} ahead of the apply, so what reaches
 * {@link computeCellPatchBatch} carries only accepted, already-transformed values and runs with
 * validation off. There is still exactly ONE apply path — this only decides what enters it, and it
 * runs at all only when {@link patchesNeedAsyncCheck} says a schema is in play.
 *
 * Failing cells are dropped from the apply and reported by index, so one bad value never loses the
 * whole batch and the caller still learns which of its patches were rejected.
 */
export function prevalidatePatches(
  s: DataGridStoreState,
  patches: readonly CellPatch[],
  rowIndex: ReadonlyMap<string, number>,
): PrevalidatedPatches | Promise<PrevalidatedPatches> {
  const columnsById = new Map(s.columns.map((c) => [c.id, c] as const));
  const items: ValidateBatchItem[] = patches.map((patch) => {
    const dataRowIndex = rowIndex.get(patch.rowId);
    return {
      validate: columnsById.get(patch.columnId)?.validate,
      value: patch.value,
      row: dataRowIndex === undefined ? undefined : s.data[dataRowIndex],
    };
  });

  const results = runValidateBatch(items);
  if (results instanceof Promise) return results.then((resolved) => keepAccepted(patches, resolved));
  return keepAccepted(patches, results);
}

/** Accepted patches with their index in the caller's array, and the caller's indexes of rejected ones. */
export type PrevalidatedPatches = { accepted: CellPatch[]; acceptedIndexes: number[]; rejectedIndexes: number[] };

function keepAccepted(patches: readonly CellPatch[], results: readonly ValidateResult[]): PrevalidatedPatches {
  const out: PrevalidatedPatches = { accepted: [], acceptedIndexes: [], rejectedIndexes: [] };
  for (let i = 0; i < patches.length; i++) {
    const result = results[i];
    if (!result || "error" in result) {
      out.rejectedIndexes.push(i);
      continue;
    }
    out.accepted.push({ ...patches[i]!, value: result.value }); // i < patches.length by loop condition
    out.acceptedIndexes.push(i);
  }
  return out;
}

/** Builds a multi-row insert batch: `rows` spliced into `s.data` at `dataRowIndex`, plus one id-keyed insert op per row (snapshot indices `dataRowIndex + i`, ascending). */
export function computeInsertRowsBatch(
  s: DataGridStoreState,
  dataRowIndex: number,
  rows: readonly unknown[],
): { nextData: readonly unknown[]; ops: DataOp<unknown>[] } {
  const nextData = s.data.slice();
  nextData.splice(dataRowIndex, 0, ...rows);
  const ops: DataOp<unknown>[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    ops.push({ type: "insert", rowId: s.getRowId(row, dataRowIndex + i), row, index: dataRowIndex + i });
  }
  return { nextData, ops };
}

/**
 * Builds a multi-row delete batch: `dataRowIndexes` (deduped, descending so earlier splices don't
 * shift later indexes) removed from `s.data`, plus their id-keyed delete ops in the original
 * (ascending) row order.
 */
export function computeDeleteBatch(
  s: DataGridStoreState,
  dataRowIndexes: readonly number[],
): { nextData: readonly unknown[]; ops: DataOp<unknown>[] } | null {
  const uniqueAscending = Array.from(new Set(dataRowIndexes)).sort((a, b) => a - b);
  if (uniqueAscending.length === 0) return null;

  const ops: DataOp<unknown>[] = [];
  for (const index of uniqueAscending) {
    const row = s.data[index];
    if (row === undefined) continue;
    ops.push({ type: "delete", rowId: s.getRowId(row, index), row, index });
  }

  const nextData = s.data.slice();
  for (let i = uniqueAscending.length - 1; i >= 0; i--) nextData.splice(uniqueAscending[i]!, 1); // i in-bounds by loop condition
  return { nextData, ops };
}

/**
 * Builds a multi-row duplicate batch: each of `dataRowIndexes` (deduped, ascending) is copied via
 * the required `s.duplicateRow` and spliced immediately after its source row. Processed descending
 * so earlier splices don't shift the still-pending source indexes; ops are returned in ascending
 * source order for a stable, predictable id-keyed batch. Caller (`duplicateRows`) guarantees
  * `duplicateRow` is present — a shallow-spread fallback would keep the source's `getRowId()`,
  * colliding two sibling rows' React key.
 */
export function computeDuplicateBatch(
  s: DataGridStoreState,
  dataRowIndexes: readonly number[],
): { nextData: readonly unknown[]; ops: DataOp<unknown>[] } | null {
  const duplicateRow = s.duplicateRow;
  if (!duplicateRow) return null;
  const uniqueAscending = Array.from(new Set(dataRowIndexes)).sort((a, b) => a - b);
  if (uniqueAscending.length === 0) return null;

  const nextData = s.data.slice();
  const opsByIndex = new Map<number, DataOp<unknown>>();
  for (let i = uniqueAscending.length - 1; i >= 0; i--) {
    const sourceIndex = uniqueAscending[i]!; // i in-bounds by loop condition
    const sourceRow = s.data[sourceIndex];
    if (sourceRow === undefined) continue;
    const insertAt = sourceIndex + 1;
    const copy = duplicateRow(sourceRow, insertAt);
    nextData.splice(insertAt, 0, copy);
    opsByIndex.set(sourceIndex, { type: "insert", rowId: s.getRowId(copy, insertAt), row: copy, index: insertAt });
  }
  const ops = uniqueAscending.map((index) => opsByIndex.get(index)).filter((op): op is DataOp<unknown> => op != null);
  return { nextData, ops };
}
