"use client";

import {
  memo,
  useCallback,
  useEffect,
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
import { gridAttrSelector } from "./data-attributes";
import type { CellType, GetCellClassName } from "./types";
import { getCellValue } from "./columns/column-helpers";
import { useDataGridCellTypes, useDataGridStoreApi, type AnyColumnDef } from "./store";
import { useDataGridRootContext } from "./layout-context";
import { pinnedInsetStyle } from "./columns/pinned-inset-style";
import { cellLayer } from "./layers";
import { cellTypes as defaultCellTypes } from "./cell-types/cell-types";
import { resolveColumnValidate } from "./cell-types/capabilities";
import { useAsyncValidate } from "./interaction/use-async-validate";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** The "highlight-what-changed" fade pulse `flashCells` plays on the cells it just wrote; the keyframes `DataGridBody` injects once per grid (self-contained, no app global.css step). Duration reads `--grid-flash-duration` (default 1.2s; `0s` disables the pulse). */
export const FLASH_ANIMATION = "grid-cell-flash var(--grid-flash-duration, 1.2s) ease-out";
/** One-shot pulse: a background fading to the cell's own background, tinted by `--grid-flash-color` (default `--color-primary`) at `--grid-flash-intensity` (default 24%) — the exact visual the `flashCells` consumers (fill, paste, move) promise. */
export const FLASH_KEYFRAMES =
  "@keyframes grid-cell-flash{0%{background-color:color-mix(in oklab, var(--grid-flash-color, var(--color-primary)) var(--grid-flash-intensity, 24%), var(--grid-flash-base, transparent))}}";

// This component is generic-erased (row: unknown, column: AnyColumnDef) since it renders arbitrary
// consumer row shapes through one shared runtime — TData=unknown makes every ColumnDef-API call
// below directly callable with no cast. The two `as unknown as` casts further down are a separate,
// narrower need: a cell type's own `FC<CellRenderProps<TData, TValue>>`/`FC<CellEditorProps<TData, TValue>>`
// is per-cell-type generic, widened once here to this erased prop shape (same invariant, different
// call surface).

export type DataGridCellProps = {
  row: unknown;
  viewRowIndex: number;
  /** The row's stable id: its `getRowId()` value, a placeholder id on an unloaded (lazy) hole, or a band id on a pinned row without one. */
  rowId: string;
  column: AnyColumnDef;
  /** Pure data-column index — drives `ViewCoord.col`, `aria-colindex`, and pin-var lookup. Never touched by the marker column (it lives outside the data index space). */
  viewColumnIndex: number;
  /** Grid-level readOnly (from the store), independent of the column's own `readOnly`. */
  gridReadOnly?: boolean;
  /** 1-based `gridColumnStart` offset added to `viewColumnIndex`; 2 when a marker column occupies track 1, else 1. Presentation-only — never affects `coord`/`aria-colindex`. */
  gridColOffset?: number;
  /** Forwarded from row.tsx (stable identity, root's dev guardrail) rather than read from context here, so this memoized cell's props stay shallow-equal across ticks. */
  getCellClassName?: GetCellClassName<unknown>;
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
  /** The open edit session's id; a new id remounts the editor and drops the old session's draft and pending validation. */
  editSession?: number;
  /** The open edit's live validation error; wins over `cellError` while `isEditing`. A caller that passes `isEditing` forwards it from `useDataGridRowCellState`. */
  editingError?: string | null;
  /** The commit-guard re-arm nonce forwarded to the editor. A caller that passes `isEditing` forwards it from `useDataGridRowCellState`. */
  editingRejectionCount?: number;
  isSearchMatch?: boolean;
  /** True when `row` is a hole in `data` (lazy loading) — renders a static shimmer block instead of cell content and skips every pointer/focus handler. */
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

// True when a cell DOM event originates from the cell's own editor: inline editors' form controls
// bubble through the DOM, and the portaled popovers (date/select/long-text) bubble up the React
// tree from outside the cell's div.
const SEARCH_MATCH_COLOR =
  "data-[search-match]:[--grid-search-color:var(--search-highlight,var(--color-search-highlight,color-mix(in_oklch,var(--color-primary,var(--primary))_var(--grid-search-fallback),var(--color-background,var(--background)))))] data-[search-match]:[--grid-search-fallback:50%] dark:data-[search-match]:[--grid-search-fallback:100%]";

function isEditorEvent(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return el !== null && el.closest(`${gridAttrSelector("cellEditor")}, input, textarea, select, [contenteditable]`) !== null;
}

/** Renders via the column's cell type (`Cell`/`Editor`), or `column.renderCell` for a display-only override. */
function DataGridCellImpl(props: DataGridCellProps): ReactNode {
  const {
    row,
    viewRowIndex,
    rowId,
    column,
    viewColumnIndex,
    gridReadOnly,
    gridColOffset = 1,
    getCellClassName,
    pinnedRow: isPinnedRow,
    isActive = false,
    isSelected = false,
    isEditing = false,
    initialText,
    editSession,
    editingError = null,
    editingRejectionCount = 0,
    isSearchMatch = false,
    isSkeleton = false,
    isFlashing = false,
    cellError = null,
  } = props;
  const { interaction } = useDataGridRootContext();
  const coord = useMemo(() => ({ col: viewColumnIndex, row: viewRowIndex }), [viewColumnIndex, viewRowIndex]);
  const storeApi = useDataGridStoreApi();
  const { actions } = storeApi.getState();
  const cellRef = useRef<HTMLDivElement | null>(null);
  // A live validation rejection on this cell's edit outranks its persisted `cellError`.
  const errorMessage = isEditing ? (editingError ?? cellError) : cellError;

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
  const opaque = pinned || isPinnedRow;

  const style: CSSProperties = {
    gridColumnStart: viewColumnIndex + gridColOffset,
    ...pinnedInsetStyle(pinned, viewColumnIndex),
  };
  // pinned outranks active-unpinned: pinning is a spatial guarantee, active is a focus state.
  style.zIndex = cellLayer(Boolean(pinned), isActive);
  // One-shot pulse on a freshly written cell; the animation overrides `background-color` only while
  // running, so the cell's own bg/hover classes take over again the moment the key lifts.
  if (isFlashing) style.animation = FLASH_ANIMATION;

  // Focus the active cell imperatively (never scrollIntoView — cells live in the transformed
  // canvas layer) once it becomes active, unless the editor owns focus. errorMessage re-triggers
  // because the tooltip mount remounts this div, dropping DOM focus.
  const focusLeftGridRef = useRef(false);
  useEffect(() => {
    if (!isEditing) return;
    const onFocusOut = (event: FocusEvent) => {
      const target = event.relatedTarget;
      focusLeftGridRef.current =
        target instanceof Element && !cellRef.current?.closest('[role="grid"]')?.contains(target) && !target.closest(gridAttrSelector("cellEditor"));
    };
    document.addEventListener("focusout", onFocusOut, true);
    return () => document.removeEventListener("focusout", onFocusOut, true);
  }, [isEditing]);

  // A commit caused by focus moving to a control outside the grid (Tab) must not pull focus back.
  useLayoutEffect(() => {
    const focusLeftGrid = focusLeftGridRef.current;
    focusLeftGridRef.current = false;
    if (isActive && !isEditing && !focusLeftGrid) cellRef.current?.focus({ preventScroll: true });
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
      // never gated on it. Read off the store at click time (no prop threading), so a callback
      // identity change re-renders no cell. Skeleton/pinned-row cells don't reach here (this handler
      // isn't attached for them below), so `row`/`value` are always real by construction.
      const s = storeApi.getState();
      s.onCellClick?.({ value, row, column, rowId, columnId: column.id, viewRowIndex: viewRowIndex, viewColumnIndex: viewColumnIndex }, event.nativeEvent);
    },
    [interaction, coord, storeApi, value, row, column, rowId, viewRowIndex, viewColumnIndex],
  );
  // Pure notifications, read off the store at event time (no prop threading, no re-render
  // sensitivity) — fired regardless of readOnly and of whatever the gesture also does.
  const onDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (isEditorEvent(event.target)) return;
      interaction.onCellDoubleClick(coord, event);
      storeApi.getState().onCellDoubleClick?.({ value, row, column, rowId, columnId: column.id, viewRowIndex: viewRowIndex, viewColumnIndex: viewColumnIndex }, event.nativeEvent);
    },
    [interaction, coord, storeApi, value, row, column, rowId, viewRowIndex, viewColumnIndex],
  );
  const onContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (isEditorEvent(event.target)) return;
      storeApi.getState().onCellContextMenu?.({ value, row, column, rowId, columnId: column.id, viewRowIndex: viewRowIndex, viewColumnIndex: viewColumnIndex }, event.nativeEvent);
    },
    [storeApi, value, row, column, rowId, viewRowIndex, viewColumnIndex],
  );

  const cellTypesRegistry = useDataGridCellTypes();
  const cellType = cellTypesRegistry[column.type ?? "text"] ?? cellTypesRegistry["text"] ?? defaultCellTypes.text;
  const align = cellType.align ?? "left";
  const isNumberOrDate = cellType.numeric === true;

  // Grid-level hook first, then the column's own override — later cn() args win on conflicting
  // utilities, so a per-column override can still beat a grid-wide default.
  const classNameCtx = { value, row, column, rowId, columnId: column.id, viewRowIndex: viewRowIndex };
  const gridCellClassName = row === undefined ? undefined : getCellClassName?.(classNameCtx);
  const columnCellClassName =
    typeof column.cellClassName === "function"
      ? row === undefined
        ? undefined
        : column.cellClassName(classNameCtx)
      : column.cellClassName;

  // The editor contract calls onChange(nextValue) then commit(movement) synchronously (see
  // cell-types/index.ts); commit reads the ref onChange last wrote. Seeding (not editing or a new
  // session) runs in a layout effect, not render — a render-time ref write bails the compiler —
  // and the layout phase flushes before the checkbox editor's on-mount commit; mid-edit
  // re-renders never re-seed, so a typed draft is never reset.
  const pendingValueRef = useRef<unknown>(value);
  const pendingSessionRef = useRef(editSession);
  useLayoutEffect(() => {
    if (!isEditing || pendingSessionRef.current !== editSession) {
      pendingValueRef.current = value;
      pendingSessionRef.current = editSession;
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, editSession]);
  const onChange = useCallback((nextValue: unknown) => {
    pendingValueRef.current = nextValue;
  }, []);
  // Async Standard Schema interception (see use-async-validate.ts doc) — a sync validate/schema
  // forwards to commitCellEdit immediately, zero behavior change from before this hook existed.
  // The type's own `validate` is the fallback the column didn't declare.
  const asyncValidate = useAsyncValidate(actions, column, resolveColumnValidate(column as AnyColumnDef, cellType as CellType | undefined), editSession);
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
      rowId: string;
      columnId: string;
      column: AnyColumnDef;
      options: unknown;
      onChange: (v: unknown) => void;
      commit: (movement?: { dx: number; dy: number }) => void;
      cancel: () => void;
      pending?: boolean;
      rejectionCount?: number;
    }) => ReactNode;
    content = (
      <Editor
        key={editSession}
        value={value}
        initialText={initialText}
        row={row}
        rowId={rowId}
        columnId={column.id}
        column={column}
        options={column.options}
        onChange={onChange}
        commit={commit}
        cancel={cancel}
        pending={asyncValidate.pending}
        rejectionCount={editingRejectionCount}
      />
    );
  } else if (column.renderCell) {
    content = column.renderCell({ value, row, rowId, columnId: column.id, viewRowIndex: viewRowIndex, column, isActive });
  } else {
    const Cell = cellType.Cell as unknown as (p: {
      value: unknown;
      row: unknown;
      rowId: string;
      columnId: string;
      viewRowIndex: number;
      column: AnyColumnDef;
      options: unknown;
      isActive: boolean;
    }) => ReactNode;
    content = <Cell value={value} row={row} rowId={rowId} columnId={column.id} viewRowIndex={viewRowIndex} column={column} options={column.options} isActive={isActive} />;
  }

  const cell = (
    <div
      ref={cellRef}
      role="gridcell"
      aria-colindex={viewColumnIndex + 1}
      aria-selected={isSelected || undefined}
      aria-busy={isSkeleton || undefined}
      aria-invalid={Boolean(errorMessage) || undefined}
      aria-description={errorMessage || undefined}
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
        "relative flex items-center overflow-hidden border-b border-border px-2 outline-none",
        COLUMN_BORDER,
        // Pinned cells sit opaque above the scrolled canvas, so they carry their own hover tint
        // (pre-composited with color-mix). Every other cell stays transparent and shows the row's tint:
        // a hover rule on each cell restyles the whole row on every hover change, which costs a scroll frame.
        opaque && "bg-background [--grid-flash-base:var(--color-background)] group-data-hovered/row:bg-[color-mix(in_oklch,var(--color-muted)_50%,var(--color-background))]",
        // own token, not accent/muted; presets without it fall back to a primary tint stronger than the selection fill.
        SEARCH_MATCH_COLOR,
        "forced-colors:data-[search-match]:outline-1 forced-colors:data-[search-match]:-outline-offset-1 forced-colors:data-[search-match]:outline-solid forced-colors:data-[search-match]:outline-[Mark]",
        opaque
          ? "data-[search-match]:bg-[color-mix(in_oklch,var(--grid-search-color)_60%,var(--color-background))] dark:data-[search-match]:bg-[color-mix(in_oklch,var(--grid-search-color)_25%,var(--color-background))]"
          : "data-[search-match]:bg-[color-mix(in_oklch,var(--grid-search-color)_60%,transparent)] dark:data-[search-match]:bg-[color-mix(in_oklch,var(--grid-search-color)_25%,transparent)]",
        // Pinned-row bands are opaque too; color-mix() keeps their 30% tint opaque.
        isPinnedRow && "bg-[color-mix(in_oklch,var(--color-muted)_30%,var(--color-background))] font-medium",
        align === "left" && "justify-start",
        align === "center" && "justify-center",
        align === "right" && "justify-end",
        isNumberOrDate && !isEditing && "tabular-nums",
        // One visual language for "this value is wrong", whether a live sync/async
        // `validate` rejection or a persisted post-commit `cellErrors` entry set the message — same
        // aria-invalid:ring-destructive/20 convention every shadcn form control in this repo already
        // uses (input.tsx/button.tsx/select.tsx), inset + z-1 so it wins over the search-match tint.
        errorMessage && "z-1 aria-invalid:ring-3 aria-invalid:ring-inset aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 forced-colors:aria-invalid:outline-2 forced-colors:aria-invalid:-outline-offset-2 forced-colors:aria-invalid:outline-dashed forced-colors:aria-invalid:outline-[CanvasText]",
        errorMessage &&
          (opaque
            ? "aria-invalid:bg-[color-mix(in_oklch,var(--color-destructive)_10%,var(--color-background))] dark:aria-invalid:bg-[color-mix(in_oklch,var(--color-destructive)_15%,var(--color-background))]"
            : "aria-invalid:bg-destructive/10 dark:aria-invalid:bg-destructive/15"),
        gridCellClassName,
        columnCellClassName,
      )}
      style={style}
      onPointerDown={isPinnedRow ? undefined : onPointerDown}
      onClick={isPinnedRow || isSkeleton ? undefined : onClick}
      // dblclick opens the editor (startEditing) — pointless on a row with nothing to edit yet,
      // and skipping it avoids the guaranteed no-op round-trip through resolveEditTarget.
      onDoubleClick={isPinnedRow || isSkeleton ? undefined : onDoubleClick}
      onContextMenu={isPinnedRow || isSkeleton ? undefined : onContextMenu}
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
          className="absolute inset-x-0 top-full z-10 mt-0.5 truncate rounded-sm border border-destructive/30 bg-background px-1.5 py-0.5 text-xs text-destructive"
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
