"use client";

import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { COLUMN_BORDER } from "./columns/column-border";
import type { GetCellClassName, OnCellClick, OnRowClick } from "./types";
import { getCellValue } from "./columns/column-helpers";
import { useDataGridActions, useDataGridCellTypes, useDataGridCellEditingError, useDataGridCellRejectionCount, type AnyColumnDef } from "./store";
import { useDataGridRootContext } from "./layout-context";
import { pinnedInsetStyle } from "./columns/pinned-inset-style";
import { cellLayer } from "./layers";
import { cellTypes as defaultCellTypes } from "./cell-types/cell-types";
import { useAsyncValidate } from "./interaction/use-async-validate";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** The "highlight-what-changed" fade pulse `flashCells` plays on the cells it just wrote; the keyframes `DataGridBody` injects once per grid (self-contained, no app global.css step). Duration reads `--grid-flash-duration` (default 1.2s; `0s` disables the pulse). */
export const FLASH_ANIMATION = "grid-cell-flash var(--grid-flash-duration, 1.2s) ease-out";
/** One-shot pulse: a background fading to transparent, tinted by `--grid-flash-color` (default `--color-primary`) at `--grid-flash-intensity` (default 24%) — the exact visual the `flashCells` consumers (fill, paste, move) promise. */
export const FLASH_KEYFRAMES =
  "@keyframes grid-cell-flash{0%{background-color:color-mix(in oklab, var(--grid-flash-color, var(--color-primary)) var(--grid-flash-intensity, 24%), transparent)}100%{background-color:transparent}}";

// This component is generic-erased (row: unknown, column: AnyColumnDef) since it renders arbitrary
// consumer row shapes through one shared runtime — see store.tsx's InternalSyncProps comment for why
// TData=unknown makes every ColumnDef-API call below directly callable with no cast. The two
// `as unknown as` casts further down are a separate, narrower need: a cell type's own
// `FC<CellRenderProps<TData, TValue>>`/`FC<CellEditorProps<TData, TValue>>` is per-cell-type generic,
// widened once here to this erased prop shape (same invariant, different call surface).

export type DataGridCellProps = {
  row: unknown;
  rowIndex: number;
  column: AnyColumnDef;
  /** Pure data-column index — drives `CellCoord.col`, `aria-colindex`, and pin-var lookup. Never touched by the marker column (it lives outside the data index space). */
  columnIndex: number;
  /** Grid-level readOnly (from `DataGridRoot`), independent of the column's own `readOnly`. */
  gridReadOnly?: boolean;
  /** 1-based `gridColumnStart` offset added to `columnIndex`; 2 when a marker column occupies track 1, else 1. Presentation-only — never affects `coord`/`aria-colindex`. */
  gridColOffset?: number;
  /** Forwarded from row.tsx (stable identity, root's dev guardrail) rather than read from context here, so this memoized cell's props stay shallow-equal across ticks. */
  getCellClassName?: GetCellClassName<unknown>;
  /** Forwarded from row.tsx, same stable-identity guidance as `getCellClassName`. Fired from this cell's own existing click handler — see {@link OnCellClick}. */
  onCellClick?: OnCellClick<unknown>;
  /** Forwarded alongside `onCellClick`, fired from the same click — see {@link OnRowClick}. */
  onRowClick?: OnRowClick<unknown>;
  /**
   * True for a pinned top/bottom row cell (the `data-grid-pinned-rows` add-on's row-bands):
   * display-only, so this skips every pointer/focus handler — pinned rows aren't part of
   * `data`/`viewIndex` and aren't navigable in v1 (documented). A prop on the same component
   * (not a fork) keeps cell rendering single-sourced.
   */
   pinnedRow?: boolean;
  /**
   * Interactive cell state, derived by the row (`useDataGridRowCellState`) from ONE per-row store
   * subscription. Primitives (not the row's whole derived object) keep `memo`'s shallow compare
   * effective: a cell re-renders only when its own flags change.
   */
  isActive?: boolean;
  isSelected?: boolean;
  isEditing?: boolean;
  /** Only meaningful when `isEditing` is true. */
  initialText?: string;
  isSearchMatch?: boolean;
  /** True when `row` is a hole in `data` (lazy loading) — renders a static shimmer block instead of cell content and skips every pointer/focus handler, same as a pinned-row cell. */
  isSkeleton?: boolean;
  /**
   * True while this cell is inside the transient `flashCells` write-pulse (a fill/paste/move just
   * committed a new value here) — plays the one-shot fade pulse {@link FLASH_ANIMATION} (keyframes
   * injected once per grid by `DataGridBody`).
   */
  isFlashing?: boolean;
  /**
   * This cell's post-commit server-error message (`cellErrors`), or null/undefined
   * when it has none. Painted with the SAME ring/tint/`aria-invalid` treatment as a live `editingError`
   * rejection below — one visual language for "this value is wrong", regardless of who said so.
   */
  cellError?: string | null;
};

/** Renders via the column's cell type (`Cell`/`Editor`), or `column.renderCell` for a display-only override. */
function DataGridCellImpl(props: DataGridCellProps): ReactNode {
  const {
    row,
    rowIndex,
    column,
    columnIndex,
    gridReadOnly,
    gridColOffset = 1,
    getCellClassName,
    onCellClick,
    onRowClick,
    pinnedRow: isPinnedRow,
    isActive = false,
    isSelected = false,
    isEditing = false,
    initialText,
    isSearchMatch = false,
    isSkeleton = false,
    isFlashing = false,
    cellError = null,
  } = props;
  const { interaction } = useDataGridRootContext();
  const coord = useMemo(() => ({ col: columnIndex, row: rowIndex }), [columnIndex, rowIndex]);
  const actions = useDataGridActions();
  const cellRef = useRef<HTMLDivElement | null>(null);
  // Atomic per-cell read (see its doc comment) — a live sync/async `validate` rejection on THIS
  // cell's in-progress edit takes priority over its persisted `cellError` (more current: the user
  // is actively looking at why the fresh value they typed was rejected). Opening the editor on an
  // ALREADY-errored cell falls back to `cellError` until a rejection of its own supersedes it, so
  // the message stays visible the instant the editor opens (spec: "editor open on an errored cell
  // shows the message like editingError"). A non-editing cell's `liveEditingError` is always null,
  // so `errorMessage` there is exactly `cellError`, unaffected by any OTHER cell's edit session.
  const liveEditingError = useDataGridCellEditingError(coord);
  const rejectionCount = useDataGridCellRejectionCount(coord);
  const errorMessage = isEditing ? (liveEditingError ?? cellError) : cellError;

  const pinned = column.pin;
  // no setValue/accessorKey = no write path (accessorFn-only, display computed) → readOnly by construction, matching the store's write-skip rule.
  // row === undefined marks a lazy-loading hole (skeleton row): never passed to consumer callbacks, which may read row fields.
  const columnReadOnly =
    (!column.setValue && !column.accessorKey) ||
    (typeof column.readOnly === "function"
      ? row === undefined
        ? undefined
        : column.readOnly(row)
      : column.readOnly);
  // Pinned top/bottom rows are readOnly by default — they're usually derived aggregates,
  // not editable data — unless the column's own readOnly explicitly says otherwise.
  const readOnly = isPinnedRow ? (columnReadOnly ?? true) : Boolean(gridReadOnly || columnReadOnly);
  const isNumberOrDate = column.type === "number" || column.type === "date";

  const style: CSSProperties = {
    gridColumnStart: columnIndex + gridColOffset,
    ...pinnedInsetStyle(pinned, columnIndex),
  };
  // pinned outranks active-unpinned: pinning is a spatial guarantee, active is a focus state.
  style.zIndex = cellLayer(Boolean(pinned), isActive);
  // One-shot pulse on a freshly written cell; the animation overrides `background-color` only while
  // running, so the cell's own bg/hover classes take over again the moment the key lifts.
  if (isFlashing) style.animation = FLASH_ANIMATION;

  // Focus the active cell imperatively (never scrollIntoView — cells live in the transformed
  // canvas layer) once it becomes active, unless the editor owns focus. errorMessage re-triggers
  // because the tooltip mount remounts this div, dropping DOM focus.
  useLayoutEffect(() => {
    if (isActive && !isEditing) cellRef.current?.focus({ preventScroll: true });
  }, [isActive, isEditing, errorMessage]);

  // Pinned rows are not navigable in v1 (documented) — no selection/edit gestures, so no handlers.
  // Skeleton cells (row is a hole, lazy loading) are click/dblclick-inert too: the
  // store's own edit/commit entry points (startEditing, applyCellUpdates, commitCellValue) already
  // no-op on an unresolvable row (resolveEditTarget/computeRowEditsBatch both bail on `row ===
  // undefined`), so pointerdown-driven selection is harmless to leave wired — only click/dblclick
  // (which can open an editor with nothing to edit) are skipped here.
  // explicit TData=unknown: row's `undefined`-narrowed type ({} | null) would otherwise drive inference instead of column's own already-unknown TData.
  const value = row === undefined ? undefined : getCellValue<unknown, typeof column>(row, column);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => interaction.onCellPointerDown(coord, event),
    [interaction, coord],
  );
  const onClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      interaction.onCellClick(coord, event);
      // Pure notification, fired alongside whatever the click already resolved to (select/toggle) —
      // never gated on it. Skeleton/pinned-row cells don't reach here (this handler isn't attached
      // for them below), so `row`/`value` are always real by construction.
      if (onCellClick || onRowClick) {
        onCellClick?.({ value, row, column, rowIndex, columnIndex }, event.nativeEvent);
        onRowClick?.({ row, rowIndex }, event.nativeEvent);
      }
    },
    [interaction, coord, onCellClick, onRowClick, value, row, column, rowIndex, columnIndex],
  );
  const onDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => interaction.onCellDoubleClick(coord, event),
    [interaction, coord],
  );

  const cellTypesRegistry = useDataGridCellTypes();
  const cellType = cellTypesRegistry[column.type ?? "text"] ?? cellTypesRegistry["text"] ?? defaultCellTypes.text;
  const align = cellType.align ?? "left";

  // Grid-level hook first, then the column's own override — later cn() args win on conflicting
  // utilities, so a per-column override can still beat a grid-wide default.
  const classNameCtx = { value, row, column, viewRowIndex: rowIndex };
  const gridCellClassName = row === undefined ? undefined : getCellClassName?.(classNameCtx);
  const columnCellClassName =
    typeof column.cellClassName === "function"
      ? row === undefined
        ? undefined
        : column.cellClassName(classNameCtx)
      : column.cellClassName;

  // The editor contract calls onChange(nextValue) then commit(movement) synchronously (see
  // cell-types/index.ts); stash the pending value in a ref for commit, re-seeding only while
  // not editing so a mid-edit re-render (stream tick, cellError) never resets the typed draft.
  const pendingValueRef = useRef<unknown>(value);
  if (!isEditing) pendingValueRef.current = value;
  const onChange = useCallback((nextValue: unknown) => {
    pendingValueRef.current = nextValue;
  }, []);
  // Async Standard Schema interception (see use-async-validate.ts doc) — a sync validate/schema
  // forwards to commitCellEdit immediately, zero behavior change from before this hook existed.
  const asyncValidate = useAsyncValidate(actions, column);
  const commit = useCallback(
    (movement?: { dx: number; dy: number }) => asyncValidate.commit(pendingValueRef.current, movement),
    [asyncValidate],
  );
  const cancel = useCallback(() => {
    asyncValidate.cancelPending();
    actions.cancelEditing();
  }, [actions, asyncValidate]);

  let content: ReactNode;
  if (isSkeleton) {
    // Static shimmer block (CSS animate-pulse only, no per-frame JS) sized to roughly a text line;
    // never rendered for checkbox/select cells specially — one shape covers every column type since
    // there's no real value to shape it around yet.
    content = <div className="h-4 w-3/4 motion-safe:animate-pulse rounded bg-muted" />;
  } else if (isEditing) {
    const Editor = cellType.Editor as unknown as (p: {
      value: unknown;
      initialText?: string;
      row: unknown;
      column: AnyColumnDef;
      onChange: (v: unknown) => void;
      commit: (movement?: { dx: number; dy: number }) => void;
      cancel: () => void;
      pending?: boolean;
      rejectionCount?: number;
    }) => ReactNode;
    content = (
      <Editor
        value={value}
        initialText={initialText}
        row={row}
        column={column}
        onChange={onChange}
        commit={commit}
        cancel={cancel}
        pending={asyncValidate.pending}
        rejectionCount={rejectionCount}
      />
    );
  } else if (column.renderCell) {
    content = column.renderCell({ value, row, rowIndex, column, isActive });
  } else {
    const Cell = cellType.Cell as unknown as (p: {
      value: unknown;
      row: unknown;
      rowIndex: number;
      column: AnyColumnDef;
      isActive: boolean;
    }) => ReactNode;
    content = <Cell value={value} row={row} rowIndex={rowIndex} column={column} isActive={isActive} />;
  }

  const cell = (
    <div
      ref={cellRef}
      role="gridcell"
      aria-colindex={columnIndex + 1}
      aria-selected={isSelected || undefined}
      aria-busy={isSkeleton || undefined}
      aria-invalid={Boolean(errorMessage) || undefined}
      tabIndex={isPinnedRow || isSkeleton ? undefined : isActive ? 0 : -1}
      data-column-id={column.id}
      data-pinned={pinned || undefined}
      data-grid-pinned-row={isPinnedRow || undefined}
      data-skeleton={isSkeleton || undefined}
      data-readonly={readOnly || undefined}
      data-type={column.type ?? "text"}
      data-active={isActive || undefined}
      data-editing={isEditing || undefined}
      data-search-match={isSearchMatch || undefined}
      data-flash={isFlashing || undefined}
      data-invalid={Boolean(errorMessage) || undefined}
      className={cn(
        "relative flex items-center overflow-hidden border-b border-border bg-background px-2 outline-none group-hover/row:bg-muted/50 transition-colors group-hover/row:transition-none",
        COLUMN_BORDER,
        // Pinned-column cells and pinned-row cells both sit opaque above the scrolled canvas
        // (z-index 1 / 3) — a translucent bg-muted/50 hover tint would let the scrolled content
        // underneath show through. color-mix() pre-composites the same tint as an OPAQUE color (same
        // visual result, no transparency) so both stay fully opaque on hover in both themes;
        // unpinned, non-banded cells keep the plain translucent utility.
        "data-pinned:group-hover/row:bg-[color-mix(in_oklch,var(--color-muted)_50%,var(--color-background))]",
        "data-grid-pinned-row:group-hover/row:bg-[color-mix(in_oklch,var(--color-muted)_50%,var(--color-background))]",
        // own token, not accent/muted: search-highlight is a distinct convention from selection/active colors.
        "data-[search-match]:bg-search-highlight/60 dark:data-[search-match]:bg-search-highlight/25",
        // Same reasoning as the pinned-cell hover tint above: pinned-row bands sit opaque (z-index 3)
        // above the scrolled rows canvas, so a translucent bg-muted/30 would let scrolled content
        // bleed through — color-mix() pre-composites the same tint as an opaque color instead.
        isPinnedRow && "bg-[color-mix(in_oklch,var(--color-muted)_30%,var(--color-background))] font-medium",
        align === "left" && "justify-start",
        align === "center" && "justify-center",
        align === "right" && "justify-end",
        isNumberOrDate && !isEditing && "tabular-nums",
        // One visual language for "this value is wrong" (design spec), whether a live sync/async
        // `validate` rejection or a persisted post-commit `cellErrors` entry set the message — same
        // aria-invalid:ring-destructive/20 convention every shadcn form control in this repo already
        // uses (input.tsx/button.tsx/select.tsx), inset + z-1 so it wins over the search-match tint.
        errorMessage && "z-1 aria-invalid:bg-destructive/10 aria-invalid:ring-3 aria-invalid:ring-inset aria-invalid:ring-destructive/20 dark:aria-invalid:bg-destructive/15 dark:aria-invalid:ring-destructive/40",
        gridCellClassName,
        columnCellClassName,
      )}
      style={style}
      onPointerDown={isPinnedRow ? undefined : onPointerDown}
      onClick={isPinnedRow ? undefined : onClick}
      // dblclick opens the editor (startEditing) — pointless on a row with nothing to edit yet,
      // and skipping it avoids the guaranteed no-op round-trip through resolveEditTarget.
      onDoubleClick={isPinnedRow || isSkeleton ? undefined : onDoubleClick}
    >
      {isEditing ? (
        content
      ) : (
        <span
          className={cn(
            "w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
            align === "center" && "text-center",
            align === "right" && "text-end",
          )}
        >
          {content}
        </span>
      )}
      {errorMessage && isEditing && (
        // Visible without a hover (editing needs the message evident immediately, not just on
        // the error tooltip) — positioned below the cell so it never clips the editor input.
        <span
          role="alert"
          className="absolute inset-x-0 top-full z-10 mt-0.5 truncate rounded-sm border border-destructive/20 bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive dark:bg-destructive/20"
        >
          {errorMessage}
        </span>
      )}
    </div>
  );

  // While editing the message is already visible without a hover (the inline role="alert" below),
  // and wrapping mid-edit would remount the editor when a live rejection lands.
  if (errorMessage && !isEditing) {
    return (
      <Tooltip>
        <TooltipTrigger render={cell} />
        <TooltipContent>{errorMessage}</TooltipContent>
      </Tooltip>
    );
  }
  return cell;
}

// Default shallow compare suffices: `row` and `column` keep stable identity, and the state flags
// are primitives the row derives from its own per-row subscription — so only a cell whose own
// flags changed re-renders, even though the whole row re-rendered to recompute them.
export const DataGridCell = memo(DataGridCellImpl);
