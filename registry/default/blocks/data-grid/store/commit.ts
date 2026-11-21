import { validateContextsFor, type CellValidateContext } from "../validation/validate-context";
import type { ViewCoord, CellType, DataChange, DataOp } from "../types";
import { getCellValue, setCellValue } from "../columns/column-helpers";
import { isDev, warnDev } from "../is-dev";
import { isStandardSchema, runValidateSync, type ValidateResult } from "../validation/validate-cell";
import { runValidateBatch, type ValidateBatchItem } from "../validation/validate-batch";
import { cellErrorKey, isColumnReadOnly } from "./compute";
import { resolveColumnValidate } from "../cell-types/capabilities";
import type { GateContext } from "./gate-signal";
import type { AnyColumnDef, CellErrorEntry, CellPatch, DataGridStoreState, InternalSyncProps, UpdateCellsSkip } from "./types";
import { dataIndexAt } from "./view-rows";

/**
 * `warnings` (only on the success/noop arms) carries `validationMode: "warn"` rejections that committed
 * anyway — the store merges them into `cellErrors` AFTER the gesture's auto-clear and `validateRow`
 * verdict, so the freshest per-cell signal wins.
 */
export type CommitResult =
  | { data: readonly unknown[]; change: DataChange<unknown>; warnings?: readonly CellErrorEntry[] }
  | { error: string }
  | { noop: true; warnings?: readonly CellErrorEntry[] };

/** Per-row accumulator: the row as edited so far, plus its per-column cell deltas (columnId -> entry). */
export type RowEdit = { row: unknown; cells: Map<string, { columnId: string; value: unknown; prev: unknown }> };

/**
 * Warns once per instance (per passed Set) for every column whose `type` resolves to nothing in
 * `registry`, the store's resolved (built-ins merged with the `cellTypes` prop) registry — a typo
 * or a `null` removal silently degrades the column to text rendering, and its edit/paste/delete
 * paths go dead (see `resolveEditTarget`). The single warn site for it; do not add a second one.
 */
export function checkUnresolvableColumnTypes(
  columns: readonly AnyColumnDef[],
  registry: Readonly<Record<string, unknown>>,
  warned: Set<string>,
): void {
  if (!isDev()) return;
  for (const column of columns) {
    if (column.type === undefined || registry[column.type] !== undefined) continue;
    const key = `${column.id}:${column.type}`;
    if (warned.has(key)) continue;
    warned.add(key);
    warnDev(`column "${column.id}" has type "${column.type}" which resolves to nothing in the cellTypes registry (a typo, or a null entry removed it); it renders as text and its edits, pastes, and deletes are dropped`);
  }
}

/** Per-grid set of the guardrail warnings already shown; a guardrail whose cause does not change across re-renders warns once per grid, not once per render. */
export type GuardrailWarnings = Set<string>;

/** `data` + `defaultData` are mutually exclusive (React value/defaultValue semantics); `data` wins. */
export function warnBothDataPropsOnce(warned: GuardrailWarnings): void {
  if (warned.has("both data props") || !isDev()) return;
  warned.add("both data props");
  warnDev("both `data` and `defaultData` were provided; `data` wins (controlled) and `defaultData` is ignored");
}

/** `store` next to a sync prop is a type error for typed callers; this catches a cast/untyped one. */
export function warnExternalStoreSyncPropsOnce(warned: GuardrailWarnings): void {
  if (warned.has("external store sync props") || !isDev()) return;
  warned.add("external store sync props");
  warnDev("<DataGridProvider store={…}> ignores the sync props next to it; pass them to useDataGridStoreProps instead");
}

/**
 * Warns once per instance (per passed Set) for every duplicated column id — the dev guardrails
 * run on every render, so without dedup a static duplicate id would warn on every render.
 */
export function checkDuplicateColumnIds(columns: readonly AnyColumnDef[], warned: Set<string>): void {
  if (!isDev()) return;
  const seen = new Set<string>();
  for (const column of columns) {
    if (seen.has(column.id)) {
      if (warned.has(column.id)) continue;
      warned.add(column.id);
      warnDev(`duplicate column id "${column.id}"`);
    }
    seen.add(column.id);
  }
}

const MAX_COLUMN_COMPARE_DEPTH = 4;

function isPlainContainer(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === Array.prototype;
}

// Functions compare by identity: a rebuilt closure may capture new state, so only a proven churn warns. Plain objects, arrays, and JSX elements compare by content up to a depth cap (a deeper difference reads as unequal, so no false warning).
function sameColumnValue(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true;
  if (depth >= MAX_COLUMN_COMPARE_DEPTH || !isPlainContainer(a) || !isPlainContainer(b)) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => sameColumnValue(a[key], b[key], depth + 1));
}

function columnsStructurallyEqual(a: readonly AnyColumnDef[], b: readonly AnyColumnDef[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as Record<string, unknown>;
    const y = b[i] as Record<string, unknown>;
    const keys = Object.keys(x);
    if (keys.length !== Object.keys(y).length) return false;
    for (const key of keys) if (!sameColumnValue(x[key], y[key])) return false;
  }
  return true;
}

/**
 * Dev-only guardrails for the recompute-slice props (the `_syncProps` inputs): missing getRowId,
 * the data/defaultData combo, unstable columns/data identity across renders. The config-slice
 * identity warnings (overlayPlugins, rowBands) live in the provider's config-phase effect.
 */
export function checkDevGuardrails(
  props: InternalSyncProps,
  prevColumns: readonly AnyColumnDef[] | undefined,
  prevData: readonly unknown[] | undefined,
  warned: GuardrailWarnings = new Set(),
): void {
  if (!isDev()) return;

  if (props.data !== undefined && props.defaultData !== undefined) {
    warnBothDataPropsOnce(warned);
  }

  if (props.data === undefined) {
    const seeded = (props.defaultData?.length ?? 0) > 0;
    if (!warned.has("seed:empty") && !warned.has("seed:filled")) warned.add(seeded ? "seed:filled" : "seed:empty");
    else if (seeded && warned.has("seed:empty") && !warned.has("seed:late")) {
      warned.add("seed:late");
      warnDev("defaultData seeds the grid once and ignores later changes, so these rows do not show; pass them in `data` with `onDataChange`, or remount the grid with a new `key`");
    }
  }

  if (!warned.has("columns identity") && prevColumns !== undefined && prevColumns !== props.columns && columnsStructurallyEqual(prevColumns, props.columns)) {
    warned.add("columns identity");
    warnDev(
      "columns array identity changed since the last render; pass a stable reference (e.g. useMemo) or every row re-renders",
    );
  }
  // Controlled mode only: in uncontrolled mode props.data is undefined (data lives in the store),
  // and the store's own array legitimately gets a new reference on every mutation — not a bug.
  if (!warned.has("data identity") && props.data !== undefined && prevData !== undefined && prevData !== props.data && prevData.length === props.data.length) {
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
      warned.add("data identity");
      warnDev("data array identity changed with no row changes; pass a stable reference (rebuilding it every render defeats row memoization)");
    }
  }
}

/** Flags for the cells of `update` and `insert` operations that a `validationMode: "warn"` column's sync validator rejects: one validator call per such cell, with one validate context per column for the whole change over `nextData`. */
export function warnFlagsForOps(s: DataGridStoreState, ops: readonly DataOp<unknown>[], nextData: readonly unknown[]): CellErrorEntry[] {
  const flags: CellErrorEntry[] = [];
  const warnColumns = s.columns.filter((column) => column.validationMode === "warn");
  if (warnColumns.length === 0) return flags;
  const byId = new Map(warnColumns.map((column) => [column.id, column] as const));
  const cells: { rowId: string; column: AnyColumnDef; columnId: string; row: unknown; value: unknown }[] = [];
  for (const op of ops) {
    if (op.type === "insert") {
      for (const column of warnColumns) cells.push({ rowId: op.rowId, column, columnId: column.id, row: op.row, value: getCellValue(op.row, column) });
    } else if (op.type === "update" && op.cells) {
      for (const cell of op.cells) {
        const column = byId.get(cell.columnId);
        if (column) cells.push({ rowId: op.rowId, column, columnId: column.id, row: op.row, value: cell.value });
      }
    }
  }
  const contexts = validateContextsFor(nextData, s.columns, cells);
  for (const { rowId, column, row, value } of cells) {
    const result = runValidateSync(resolveColumnValidate(column, s.cellTypes[column.type ?? "text"]), value, row, contexts.get(column.id));
    if ("error" in result && !result.thrown) flags.push({ rowId, columnId: column.id, message: result.error });
  }
  return flags;
}

/**
 * Shared value-write path for both `commitCellEdit` (editing session) and `commitCellValue` (direct
 * write, e.g. checkbox toggle). `value` may already be schema-validated+transformed (the async
 * editor-commit layer passes `result.value`, having awaited the schema itself) — this still
 * re-runs `validate` (cheap, idempotent for a well-behaved schema) so the sync/function-form path
 * is unchanged and a direct `commitCellValue` call always gets checked.
 *
 * `validationMode: "warn"` columns commit a rejected value (raw — a rejection carries no transformed
 * value) and report it in `warnings` so the store can flag the cell in `cellErrors`; a validator
 * that threw blocks there too. `rejection` is the async layer's awaited schema rejection, which the
 * sync re-run here cannot see (a schema Promise passes `runValidateSync` untouched).
 */
export function computeCommit(s: DataGridStoreState, coord: ViewCoord, value: unknown, rejection?: string): CommitResult {
  const target = resolveEditTarget(s, coord);
  if (!target) return { noop: true };
  const { column, dataRowIndex, row, cellType } = target;
  if (isColumnReadOnly(column, row)) return { noop: true };
  const validated = runValidateSync(resolveColumnValidate(column, cellType), value, row, validateContextsFor(s.data, s.columns, [{ columnId: column.id, row, value }]).get(column.id));
  let nextValue: unknown;
  let warning: string | undefined;
  if ("error" in validated) {
    if (column.validationMode !== "warn" || validated.thrown) return { error: validated.error };
    nextValue = value;
    warning = validated.error;
  } else {
    nextValue = validated.value;
    if (rejection !== undefined && column.validationMode === "warn") warning = rejection;
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
  coord: ViewCoord,
): { column: AnyColumnDef; dataRowIndex: number; row: unknown; cellType: CellType } | null {
  const column = s.visibleColumns[coord.col];
  if (!column) return null;
  const dataRowIndex = dataIndexAt(s, coord.row);
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
 * `applyCellUpdates` so both funnel through one row-edit accumulation + operation-building path.
 */
export function computeRowEditsBatch(
  s: DataGridStoreState,
  writes: { viewRowIndex: number; columnId: string; value: unknown }[],
): { nextData: readonly unknown[]; ops: DataOp<unknown>[] } | null {
  const rowEdits = new Map<number, RowEdit>();
  const columnById = new Map(s.visibleColumns.map((column) => [column.id, column] as const));

  for (const write of writes) {
    const dataRowIndex = dataIndexAt(s, write.viewRowIndex);
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
 * Applies row-id-based {@link CellPatch}es against `s` — the direct-update path's counterpart to
 * {@link computeRowEditsBatch}. Differences, all deliberate: rows are addressed by STABLE ROW ID
 * through the caller-supplied `rowIndex` map (never a view index, so a patch survives an active
 * sort), and every column is resolvable, not only visible ones (a streaming producer must be able
 * to write a column the user has hidden). Unknown rows, unknown columns, unloaded rows (`"hole"`),
 * read-only cells, and `Object.is`-equal no-op writes are dropped. Under `source: "stream"` only a
 * column with no `accessorKey` and no `setValue` counts as read-only, and a row whose save is in
 * flight is held with reason `"saving"`. Duplicate patches to one cell dedupe last-write-wins with `prev` held
 * at the pre-batch value.
 *
 * `skipValidation` bypasses the per-column `validate` a 200-cell tick would otherwise re-run for a
 * producer that already validated; otherwise a cell whose value fails validation is skipped,
 * matching {@link computeRowEditsBatch}'s bulk contract (a stream has no UI surface to reject a
 * batch on and must never drop a whole batch for one bad value). Every skipped patch is named in
 * the returned `skipped` list for the action's verdict, and every rejected value in `rejected`
 * with its validator's message.
 */
export function computeCellPatchBatch(
  s: DataGridStoreState,
  patches: readonly CellPatch[],
  rowIndex: ReadonlyMap<string, number>,
  skipValidation: boolean,
  source: DataChange<unknown>["source"] = "stream",
): {
  nextData: readonly unknown[] | null;
  ops: DataOp<unknown>[];
  touchedRows: number[];
  skipped: UpdateCellsSkip[];
  rejected: PatchRejection[];
  warnings: CellErrorEntry[];
} {
  const columnsById = new Map(s.columns.map((c) => [c.id, c] as const));
  const rowEdits = new Map<number, RowEdit>();
  const skipped: UpdateCellsSkip[] = [];
  const rejected: PatchRejection[] = [];
  const warnings = new Map<string, CellErrorEntry>();
  let contexts: Map<string, CellValidateContext> | null = null;
  const contextOf = (columnId: string) =>
    (contexts ??= validateContextsFor(s.data, s.columns, patches.map((p) => ({ columnId: p.columnId, row: s.data[rowIndex.get(p.rowId) ?? -1], value: p.value })))).get(columnId);

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
    if (source === "stream" ? !column.setValue && !column.accessorKey : isColumnReadOnly(column, baseRow)) {
      skipped.push({ patchIndex, reason: "readonly" });
      continue;
    }
    if (source === "stream" && s.saveStatus.get(patch.rowId) === "saving") {
      skipped.push({ patchIndex, reason: "saving" });
      continue;
    }

    let value = patch.value;
    let warning: string | undefined;
    if (!skipValidation) {
      const validate = resolveColumnValidate(column, s.cellTypes[column.type ?? "text"]);
      const validated = runValidateSync(validate, value, baseRow, typeof validate === "function" ? contextOf(column.id) : undefined);
      if ("error" in validated) {
        if (column.validationMode !== "warn" || validated.thrown) {
          skipped.push({ patchIndex, reason: "invalid" });
          rejected.push({ patchIndex, message: validated.error });
          continue;
        }
        warning = validated.error;
      } else value = validated.value;
    }

    const prevValue = getCellValue<unknown, typeof column>(baseRow, column);
    if (Object.is(prevValue, value)) {
      skipped.push({ patchIndex, reason: "no-op" });
      continue;
    }
    const warningKey = cellErrorKey(patch.rowId, column.id);
    if (warning === undefined) warnings.delete(warningKey);
    else warnings.set(warningKey, { rowId: patch.rowId, columnId: column.id, message: warning });

    const row = setCellValue<unknown, typeof column>(baseRow, column, value);
    const cells = entry?.cells ?? new Map<string, { columnId: string; value: unknown; prev: unknown }>();
    const existingPrev = cells.get(column.id)?.prev ?? prevValue;
    cells.set(column.id, { columnId: column.id, value, prev: existingPrev });
    rowEdits.set(dataRowIndex, { row, cells });
  }

  const flagged = Array.from(warnings.values());
  if (rowEdits.size === 0) return { nextData: null, ops: [], touchedRows: [], skipped, rejected, warnings: flagged };

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
  return { nextData, ops, touchedRows, skipped, rejected, warnings: flagged };
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
    const column = columnsById.get(patch.columnId);
    if (!column) continue;
    if (isStandardSchema(resolveColumnValidate(column, s.cellTypes[column.type ?? "text"]))) return true;
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
  const warnByPatch: boolean[] = [];
  const items: ValidateBatchItem[] = patches.map((patch) => {
    const dataRowIndex = rowIndex.get(patch.rowId);
    const column = columnsById.get(patch.columnId);
    warnByPatch.push(column?.validationMode === "warn");
    return {
      validate: column ? resolveColumnValidate(column, s.cellTypes[column.type ?? "text"]) : undefined,
      value: patch.value,
      row: dataRowIndex === undefined ? undefined : s.data[dataRowIndex],
    };
  });

  const contexts = validateContextsFor(s.data, s.columns, patches.map((patch, i) => ({ columnId: patch.columnId, row: items[i]!.row, value: patch.value })));
  for (let i = 0; i < items.length; i++) items[i]!.ctx = contexts.get(patches[i]!.columnId);
  const results = runValidateBatch(items);
  if (results instanceof Promise) return results.then((resolved) => keepAccepted(patches, resolved, warnByPatch));
  return keepAccepted(patches, results, warnByPatch);
}

/** A patch the column's validator refused: its index in the caller's array and the validator's message. */
export type PatchRejection = { patchIndex: number; message: string };

/** Accepted patches with their index in the caller's array, and the rejected ones. */
export type PrevalidatedPatches = { accepted: CellPatch[]; acceptedIndexes: number[]; rejected: PatchRejection[]; warnings: CellErrorEntry[] };

function keepAccepted(patches: readonly CellPatch[], results: readonly ValidateResult[], warnByPatch: readonly boolean[]): PrevalidatedPatches {
  const out: PrevalidatedPatches = { accepted: [], acceptedIndexes: [], rejected: [], warnings: [] };
  const warned = new Map<string, CellErrorEntry>();
  for (let i = 0; i < patches.length; i++) {
    const result = results[i];
    const cellKey = cellErrorKey(patches[i]!.rowId, patches[i]!.columnId);
    if (result && "error" in result && warnByPatch[i] && !result.thrown) {
      warned.set(cellKey, { rowId: patches[i]!.rowId, columnId: patches[i]!.columnId, message: result.error });
      out.accepted.push(patches[i]!);
      out.acceptedIndexes.push(i);
      continue;
    }
    if (result && !("error" in result)) warned.delete(cellKey);
    if (!result || "error" in result) {
      out.rejected.push({ patchIndex: i, message: result?.error ?? "" });
      continue;
    }
    out.accepted.push({ ...patches[i]!, value: result.value }); // i < patches.length by loop condition
    out.acceptedIndexes.push(i);
  }
  out.warnings.push(...warned.values());
  return out;
}

/** Builds a multi-row insert batch: `rows` spliced into `s.data` at `dataRowIndex`, plus one row-id-based insert operation per row (`index` is the row's final slot, `dataRowIndex + i`, ascending). */
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
 * shift later indexes) removed from `s.data`, plus their row-id-based delete operations in the original
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
 * Calls `duplicateRow` once per source row (descending, like {@link computeDuplicateBatch}) and keys
 * each result, a copy or a promise of one, by its source data index. `null` when nothing resolves.
 */
export function startDuplicateCopies(s: DataGridStoreState, dataRowIndexes: readonly number[], gate: GateContext): Map<number, unknown> | null {
  const duplicateRow = s.duplicateRow;
  const uniqueAscending = Array.from(new Set(dataRowIndexes)).sort((a, b) => a - b);
  if (!duplicateRow || uniqueAscending.length === 0) return null;
  const copies = new Map<number, unknown>();
  for (let i = uniqueAscending.length - 1; i >= 0; i--) {
    const sourceIndex = uniqueAscending[i]!; // i in-bounds by loop condition
    const sourceRow = s.data[sourceIndex];
    if (sourceRow === undefined) continue;
    copies.set(sourceIndex, duplicateRow(sourceRow, sourceIndex + 1 + i, gate));
  }
  return copies.size > 0 ? copies : null;
}

/**
 * Builds a multi-row duplicate batch: each of `dataRowIndexes` (deduped, ascending) is copied via
 * the required `s.duplicateRow` and spliced immediately after its source row. Processed descending
 * so earlier splices don't shift the still-pending source indexes; operations are returned in ascending
 * source order for a stable, predictable row-id-based batch. Caller (`duplicateRows`) guarantees
  * `duplicateRow` is present — a shallow-spread fallback would keep the source's `getRowId()`,
  * colliding two sibling rows' React key.
 */
export function computeDuplicateBatch(
  s: DataGridStoreState,
  dataRowIndexes: readonly number[],
  copies: ReadonlyMap<number, unknown>,
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
    const finalIndex = insertAt + i;
    const copy = copies.get(sourceIndex);
    if (copy === undefined) continue;
    nextData.splice(insertAt, 0, copy);
    opsByIndex.set(sourceIndex, { type: "insert", rowId: s.getRowId(copy, finalIndex), row: copy, index: finalIndex });
  }
  const ops = uniqueAscending.map((index) => opsByIndex.get(index)).filter((op): op is DataOp<unknown> => op != null);
  return { nextData, ops };
}
