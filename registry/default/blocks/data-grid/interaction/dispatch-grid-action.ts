import { type RefObject } from "react";
import type { StoreApi } from "zustand/vanilla";
import { viewIndex, viewIndexes, type ViewCoord, type GridSelection, type CellType, type GridAction, type GridCommandCtx } from "../types";
import type { RowActionName } from "../store/types";
import { getCellValue } from "../columns/column-helpers";
import { safeHref } from "../cell-types/safe-href";
import { getFocusCell, type DataGridActions, type DataGridStoreState } from "../store";
import { GRID_ATTR, gridAttrSelector } from "../data-attributes";
import { isRowRangeLive, selectionIsCursorOnly } from "../selection/row-range-gesture";
import { offersSetFilter } from "../cell-types/capabilities";
import { warnDev } from "../is-dev";
import { allRowsSelectedState } from "../store/hooks";
import { apiHandleOf } from "../store/api";
import { getInternalActions } from "../store/internal-actions";
import { holeRowId } from "../store/compute";
import { reportRowActionSkipped } from "../store/row-action-skip";
import { COLUMN_WIDTH_STEP, shownColumnWidth } from "../columns/column-step";
import { rowOperationTargets } from "../store/row-operation-targets";
import { isReorderMarkerMode } from "../rows/marker-width";

const warnedMissingTriggers = new WeakMap<object, Set<string>>();

function warnMissingTriggerOnce(storeApi: object, slotProp: string, message: string): void {
  const warned = warnedMissingTriggers.get(storeApi) ?? new Set<string>();
  warnedMissingTriggers.set(storeApi, warned);
  if (warned.has(slotProp)) return;
  warned.add(slotProp);
  warnDev(message);
}

/**
 * Executes one already-resolved keymap action against the store — the dispatch shared by the
 * in-grid keydown handler and the global-shortcut window layer, so a globally registered action
 * behaves EXACTLY like its in-grid binding (same scrolling, same store-side guards: `insertRowBelow`
 * without `createRow` no-ops, ...). `preventDefault` is the caller's event handler, invoked only for the
 * actions that would preventDefault in-grid.
 * Not part of the public hook surface.
 */
export function dispatchGridAction(args: {
  action: GridAction;
  actions: DataGridActions;
  storeApi: StoreApi<DataGridStoreState>;
  scrollRef: RefObject<HTMLElement | null>;
  scrollCellIntoView: (coord: ViewCoord) => void;
  /** The grid's resolved data-row height (px) — `pageUp`/`pageDown`'s visible-row math. */
  rowHeight: number;
  /** The printable seed char for `typeToReplace`, when the trigger was a printable key; undefined otherwise. */
  triggerKey?: string;
  preventDefault: () => void;
  /** The column of the focused header button; the column menu and filter actions use it instead of the active cell. */
  headerColumnId?: string;
  /** Holds the pending animation frame of a deferred action so the caller can cancel it on unmount. */
  pendingFrameRef?: RefObject<number | null>;
}): void {
  const { action, actions, storeApi, scrollRef, scrollCellIntoView, rowHeight, triggerKey, preventDefault, headerColumnId, pendingFrameRef } = args;
  const state = storeApi.getState();
  const rowCount = state.viewIndex.length;
  const colCount = state.visibleColumns.length;

  const targetColumnIndex = (): number =>
    headerColumnId === undefined ? (state.activeCell?.col ?? -1) : state.visibleColumns.findIndex((column) => column.id === headerColumnId);

  // A command name shadowing a built-in action wins; callers check the command's scope.
  const command = state.commands?.[action];
  if (command) {
    const api = apiHandleOf<unknown>(storeApi);
    const coord = state.activeCell;
    const dataRowIndex = coord === null ? undefined : state.viewIndex[coord.row];
    const row = dataRowIndex === undefined ? undefined : state.data[dataRowIndex];
    const cell =
      coord === null
        ? null
        : {
            // Every view rebuild clamps the cursor, so an unresolved row id stays a defensive fallback.
            rowId:
              dataRowIndex === undefined
                ? ""
                : row === undefined
                  ? holeRowId(dataRowIndex)
                  : state.getRowId(row, dataRowIndex),
            columnId: state.visibleColumns[coord.col]?.id ?? "",
          };
    const ctx: GridCommandCtx = {
      api,
      cell,
      viewRowIndex: coord === null ? null : coord.row,
      viewColumnIndex: coord === null ? null : coord.col,
      row,
      readOnly: state.readOnly,
    };
    if (command.when?.(ctx) === false) return;
    preventDefault();
    command.run(ctx);
    return;
  }

  const runRowOperation = (name: RowActionName, run: (rows: number[]) => void, { checkedWins = false } = {}) => {
    // a move keeps acting on the checked rows alone, also while a cell click would clear them (until-click)
    const targets = rowOperationTargets(checkedWins ? { ...state, checkedRowsLifetime: "until-cleared" } : state, state.activeCell?.row);
    if (targets.reason) getInternalActions(storeApi)._skipRowAction(name, targets.reason);
    else if (targets.rows.length > 0) run(targets.rows);
  };

  const moveAndScroll = (d: { dx: number; dy: number }, opts?: { extend?: boolean; retain?: boolean }) => {
    getInternalActions(storeApi)._moveActiveCell(d, opts);
    // extend keeps activeCell pinned at the anchor — scroll the growing selection's edge instead.
    const next = getFocusCell(storeApi.getState());
    if (next) scrollCellIntoView(next);
  };

  /** Moves the checked row range edge (and the active cell) to the row `targetOf` names for the current edge; false when no row range gesture is waiting for a key step. */
  const stepCheckedRows = (targetOf: (edge: number) => number): boolean => {
    const s = storeApi.getState();
    const gesture = s.rowRangeGesture;
    if (!s.enableRowSelection || !s.enableRangeSelection || !isRowRangeLive(gesture, s.selection, s.viewIndex)) return false;
    if (gesture.current !== s.selection.current || !selectionIsCursorOnly(s.selection)) return false;
    const target = Math.max(0, Math.min(targetOf(gesture.edge), s.viewIndex.length - 1));
    actions.checkRowRange(target);
    moveAndScroll({ dx: 0, dy: target - (s.activeCell?.row ?? 0) }, { retain: true });
    return true;
  };

  const jumpAndScroll = (direction: JumpDirection, opts?: { extend?: boolean }) => {
    const active = (opts?.extend ? getFocusCell(state) : state.activeCell) ?? { col: 0, row: 0 };
    const target = jumpToDataBoundary(state, active, direction);
    if (opts?.extend) actions.extendToAt(target);
    else actions.selectCellAt(target);
    scrollCellIntoView(target);
  };

  const startEditingAndReveal = (coord: ViewCoord, initialText?: string) => {
    actions.startEditingAt(coord, initialText);
    if (storeApi.getState().editing) scrollCellIntoView(coord);
  };

  const openActiveColumnTrigger = (triggerAttr: "headerMenuTrigger" | "headerFilterTrigger", triggerLabel: string, slotProp: string, offered: (column: (typeof state.visibleColumns)[number]) => boolean = () => true) => {
    preventDefault();
    const active = state.activeCell;
    const column = headerColumnId !== undefined ? state.visibleColumns.find((candidate) => candidate.id === headerColumnId) : active && state.visibleColumns[active.col];
    if (!column || !offered(column)) return;
    const findTrigger = () => scrollRef.current?.querySelector<HTMLElement>(`[data-column-id="${CSS.escape(column.id)}"] ${gridAttrSelector(triggerAttr)}`);
    const open = (trigger: HTMLElement) => {
      trigger.setAttribute(GRID_ATTR.keyboardOpen, "");
      trigger.click();
      trigger.removeAttribute(GRID_ATTR.keyboardOpen);
    };
    if (headerColumnId === undefined && active) scrollCellIntoView(active);
    const mounted = findTrigger();
    if (mounted) {
      open(mounted);
      return;
    }
    // the header is virtualized out until the scroll lands and a frame renders it
    const retry = () => {
      if (!scrollRef.current) return;
      const trigger = findTrigger();
      if (trigger) open(trigger);
      else warnMissingTriggerOnce(storeApi, slotProp, `${action} found no ${triggerLabel} for "${column.id}"; wire ${slotProp} to enable it`);
    };
    const frame = requestAnimationFrame(() => {
      const second = requestAnimationFrame(retry);
      if (pendingFrameRef) pendingFrameRef.current = second;
    });
    if (pendingFrameRef) pendingFrameRef.current = frame;
  };

  switch (action) {
    case "moveUp":
    case "moveDown":
    case "moveLeft":
    case "moveRight": {
      preventDefault();
      moveAndScroll(MOVE_DELTA[action]);
      break;
    }
    case "moveUpKeepSelection":
    case "moveDownKeepSelection":
    case "moveLeftKeepSelection":
    case "moveRightKeepSelection": {
      preventDefault();
      moveAndScroll(MOVE_DELTA[action], { retain: true });
      break;
    }
    case "scrollActiveIntoView": {
      preventDefault();
      const active = storeApi.getState().activeCell;
      if (active) scrollCellIntoView(active);
      break;
    }
    case "extendUp":
    case "extendDown":
    case "extendLeft":
    case "extendRight": {
      preventDefault();
      if (action !== "extendLeft" && action !== "extendRight" && stepCheckedRows((edge) => edge + MOVE_DELTA[action].dy)) break;
      moveAndScroll(MOVE_DELTA[action], { extend: true });
      break;
    }
    case "jumpUp":
    case "jumpDown":
    case "jumpLeft":
    case "jumpRight": {
      preventDefault();
      jumpAndScroll(JUMP_DIRECTION[action]);
      break;
    }
    case "extendJumpUp":
    case "extendJumpDown":
    case "extendJumpLeft":
    case "extendJumpRight": {
      preventDefault();
      jumpAndScroll(JUMP_DIRECTION[action], { extend: true });
      break;
    }
    case "moveRowStart": {
      preventDefault();
      const active = state.activeCell ?? { col: 0, row: 0 };
      const target = { col: 0, row: active.row };
      actions.selectCellAt(target);
      scrollCellIntoView(target);
      break;
    }
    case "moveRowEnd": {
      preventDefault();
      const active = state.activeCell ?? { col: 0, row: 0 };
      const target = { col: Math.max(0, colCount - 1), row: active.row };
      actions.selectCellAt(target);
      scrollCellIntoView(target);
      break;
    }
    case "moveFirstCell": {
      preventDefault();
      const target = { col: 0, row: 0 };
      actions.selectCellAt(target);
      scrollCellIntoView(target);
      break;
    }
    case "moveLastCell": {
      preventDefault();
      const target = { col: Math.max(0, colCount - 1), row: Math.max(0, rowCount - 1) };
      actions.selectCellAt(target);
      scrollCellIntoView(target);
      break;
    }
    case "extendFirstCell": {
      preventDefault();
      actions.extendToAt({ col: 0, row: 0 });
      const focus = getFocusCell(storeApi.getState());
      if (focus) scrollCellIntoView(focus);
      break;
    }
    case "extendLastCell": {
      preventDefault();
      actions.extendToAt({ col: Math.max(0, colCount - 1), row: Math.max(0, rowCount - 1) });
      const focus = getFocusCell(storeApi.getState());
      if (focus) scrollCellIntoView(focus);
      break;
    }
    case "extendRowsToStart":
    case "extendRowsToEnd":
    case "extendRowsPageUp":
    case "extendRowsPageDown": {
      const page = visiblePageRows(scrollRef.current, rowHeight);
      const targetOf: Record<typeof action, (edge: number) => number> = {
        extendRowsToStart: () => 0,
        extendRowsToEnd: () => rowCount - 1,
        extendRowsPageUp: (edge) => edge - page,
        extendRowsPageDown: (edge) => edge + page,
      };
      if (stepCheckedRows(targetOf[action])) preventDefault();
      break;
    }
    case "pageUp":
    case "pageDown": {
      preventDefault();
      const visibleRows = visiblePageRows(scrollRef.current, rowHeight);
      moveAndScroll({ dx: 0, dy: action === "pageUp" ? -visibleRows : visibleRows });
      break;
    }
    case "selectRow": {
      preventDefault();
      const active = state.activeCell;
      if (active) actions.selectRow(active.row, { additive: false });
      break;
    }
    case "selectColumn": {
      preventDefault();
      const active = state.activeCell;
      if (active) actions.selectColumn(active.col, { additive: false });
      break;
    }
    case "selectAll": {
      preventDefault();
      actions.selectAll();
      break;
    }
    case "toggleRow": {
      preventDefault();
      const active = state.activeCell;
      if (active) actions.setRowCheckedAt(viewIndex(active.row), !state.selection.rows.hasIndex(active.row));
      break;
    }
    case "toggleAllRows": {
      preventDefault();
      actions.setAllRowsChecked(allRowsSelectedState(state) !== "checked");
      break;
    }
    case "openColumnMenu":
      openActiveColumnTrigger("headerMenuTrigger", "column menu trigger", "renderHeaderMenu");
      break;
    case "openColumnFilter":
      openActiveColumnTrigger("headerFilterTrigger", "column filter trigger", "renderHeaderFilter", (column) => offersSetFilter(column, state.cellTypes[column.type ?? "text"]));
      break;
    case "edit": {
      preventDefault();
      if (state.readOnly || !state.activeCell) break;
      if (hasActivateCell(state, state.activeCell)) getInternalActions(storeApi)._activateCellAt(state.activeCell);
      else startEditingAndReveal(state.activeCell);
      break;
    }
    case "typeToReplace": {
      if (state.readOnly || !state.activeCell) break;
      preventDefault();
      if (hasActivateCell(state, state.activeCell)) break; // checkbox cells have no edit mode; the edit action toggles them, type-to-replace ignores them
      // printable trigger seeds the typed char (Excel replace mode); a non-printable binding (e.g. F3) starts a plain edit
      startEditingAndReveal(state.activeCell, triggerKey);
      break;
    }
    case "focusSearch": {
      if (!state.focusSearchImpl) break;
      preventDefault();
      state.focusSearchImpl();
      break;
    }
    case "cancel": {
      preventDefault();
      getInternalActions(storeApi)._cancelSelection();
      break;
    }
    case "clearContents": {
      preventDefault();
      if (!state.readOnly) actions.deleteSelection();
      break;
    }
    case "insertRowBelow":
    case "insertRowAbove": {
      preventDefault();
      if (!state.activeCell) break;
      // Without createRow, insertRow warns on every press; report the skip here instead.
      if (state.readOnly) reportRowActionSkipped(state, "insertRows", "readOnly");
      else if (!state.createRow) reportRowActionSkipped(state, "insertRows", "no-factory");
      else actions.insertRow(state.activeCell.row, action === "insertRowBelow" ? "below" : "above");
      break;
    }
    case "duplicateRow": {
      preventDefault();
      runRowOperation("duplicateRows", (rows) => actions.duplicateRowsAt(viewIndexes(rows)));
      break;
    }
    case "moveRowsUp":
    case "moveRowsDown": {
      preventDefault();
      if (!isReorderMarkerMode(state.rowMarkers)) {
        reportRowActionSkipped(state, "moveRows", "disabled");
        break;
      }
      let moved = false;
      runRowOperation("moveRows", (rows) => {
        moved = actions.moveRowsBy(rows, action === "moveRowsUp" ? -1 : 1);
      }, { checkedWins: true });
      const active = storeApi.getState().activeCell;
      if (moved && active) scrollCellIntoView(active);
      break;
    }
    case "deleteRows": {
      preventDefault();
      if (!state.enableRowDelete) {
        reportRowActionSkipped(state, "deleteRows", "disabled");
        break;
      }
      runRowOperation("deleteRows", (rows) => actions.deleteRowsAt(viewIndexes(rows)));
      break;
    }
    case "moveColumnTowardStart":
    case "moveColumnTowardEnd": {
      preventDefault();
      const index = targetColumnIndex();
      const step = action === "moveColumnTowardStart" ? -1 : 1;
      const column = state.visibleColumns[index];
      const neighbor = state.visibleColumns[index + step];
      if (!column || !neighbor || !actions.setColumnOrder(column.id, neighbor.id, step === -1 ? "before" : "after").ok) break;
      const active = storeApi.getState().activeCell;
      if (active) scrollCellIntoView(active);
      break;
    }
    case "widenColumn":
    case "narrowColumn": {
      preventDefault();
      const column = state.visibleColumns[targetColumnIndex()];
      if (!column || column.resizable === false) break;
      const width = shownColumnWidth(scrollRef.current, column, state.columnWidths);
      actions.setColumnWidth(column.id, width + (action === "widenColumn" ? COLUMN_WIDTH_STEP : -COLUMN_WIDTH_STEP));
      break;
    }
    case "openCellMenu": {
      preventDefault();
      if (!state.activeCell) break;
      scrollCellIntoView(state.activeCell);
      const cell = scrollRef.current?.querySelector(gridAttrSelector("active"));
      if (!cell) break;
      const rect = cell.getBoundingClientRect();
      cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
      break;
    }
    case "openLink": {
      // reads data only: runs in a read-only grid; during an edit session the grid's keydown never fires.
      preventDefault();
      const active = state.activeCell;
      if (!active) break;
      const column = state.visibleColumns[active.col];
      const href = cellTypeAt(state, active)?.href;
      if (!column || !href) break;
      const dataRowIndex = state.viewIndex[active.row];
      const row = dataRowIndex === undefined ? undefined : state.data[dataRowIndex];
      if (row === undefined) break; // lazy hole: nothing to link
      const link = href(getCellValue<unknown, typeof column>(row, column), column.options);
      const safe = link ? safeHref(link) : null;
      if (safe) window.open(safe, "_blank", "noopener,noreferrer");
      break;
    }
  }
}

function cellTypeAt(state: DataGridStoreState, coord: ViewCoord): CellType | undefined {
  return state.cellTypes[state.visibleColumns[coord.col]?.type ?? "text"];
}

/** Whether the cell's type declares `activate` — the gesture semantics come from the type, not the name. */
export function hasActivateCell(state: DataGridStoreState, coord: ViewCoord): boolean {
  return cellTypeAt(state, coord)?.activate != null;
}

/** Direction for a data-boundary (Ctrl/Cmd+Arrow) jump. */
export type JumpDirection = "up" | "down" | "left" | "right";

/**
 * Excel-style Ctrl/Cmd+Arrow "jump to data boundary": from `active`, scans view rows/columns in
 * `direction` using the cell type's `isEmpty`. If `active` and the next cell are both non-empty, jumps
 * to the last non-empty cell of the contiguous run; if `active` is empty and the next cell is not,
 * jumps to the next cell; otherwise jumps to the first non-empty cell found (or the grid edge if none).
 * Clamped at the grid edges either way.
 * Exported for direct unit testing of the boundary-scan math; not part of the public hook surface.
 */
export function jumpToDataBoundary(state: DataGridStoreState, active: ViewCoord, direction: JumpDirection): ViewCoord {
  const rowCount = state.viewIndex.length;
  const colCount = state.visibleColumns.length;
  const dx = direction === "left" ? -1 : direction === "right" ? 1 : 0;
  const dy = direction === "up" ? -1 : direction === "down" ? 1 : 0;

  const isEmptyAt = (coord: ViewCoord): boolean => {
    const column = state.visibleColumns[coord.col];
    if (!column) return true;
    const dataRowIndex = state.viewIndex[coord.row];
    const row = dataRowIndex === undefined ? undefined : state.data[dataRowIndex];
    if (row === undefined) return true;
    const cellType = state.cellTypes[column.type ?? "text"];
    if (!cellType) return true;
    // explicit TData=unknown: row's `undefined`-narrowed type ({} | null) would otherwise drive inference instead of column's own already-unknown TData.
    const value = getCellValue<unknown, typeof column>(row, column);
    return cellType.isEmpty(value);
  };

  const inBounds = (coord: ViewCoord): boolean =>
    coord.col >= 0 && coord.col < colCount && coord.row >= 0 && coord.row < rowCount;

  const clampToEdge = (): ViewCoord => {
    // no data at all beyond `active` in this direction: land on the grid edge
    let coord = active;
    while (inBounds({ col: coord.col + dx, row: coord.row + dy })) {
      coord = { col: coord.col + dx, row: coord.row + dy };
    }
    return coord;
  };

  const next = { col: active.col + dx, row: active.row + dy };
  if (!inBounds(next)) return active;

  if (!isEmptyAt(next)) {
    // from an empty cell the first non-empty cell is the target; from a filled one, land on the last cell of the run
    if (isEmptyAt(active)) return next;
    let coord = next;
    while (true) {
      const after = { col: coord.col + dx, row: coord.row + dy };
      if (!inBounds(after) || isEmptyAt(after)) return coord;
      coord = after;
    }
  }

  // next is empty: scan forward for the first non-empty cell; else land on the grid edge
  let coord = next;
  while (inBounds(coord)) {
    if (!isEmptyAt(coord)) return coord;
    const after = { col: coord.col + dx, row: coord.row + dy };
    if (!inBounds(after)) return clampToEdge();
    coord = after;
  }
  return clampToEdge();
}

/** Rows a PageUp or PageDown step moves: the visible rows minus four, 10 before the scroll element mounts. */
function visiblePageRows(scrollElement: HTMLElement | null, rowHeight: number): number {
  return scrollElement ? Math.max(1, Math.floor(scrollElement.clientHeight / rowHeight) - 4) : 10;
}

/** Move/extend actions that resolve through {@link MOVE_DELTA} — kept as its own union so the map is total (no `!` needed at the call site). */
type MoveAction = "moveUp" | "moveDown" | "moveLeft" | "moveRight" | "moveUpKeepSelection" | "moveDownKeepSelection" | "moveLeftKeepSelection" | "moveRightKeepSelection" | "extendUp" | "extendDown" | "extendLeft" | "extendRight";

/** Jump/extend-jump actions that resolve through {@link JUMP_DIRECTION} — kept as its own union so the map is total (no `!` needed at the call site). */
type JumpAction = "jumpUp" | "jumpDown" | "jumpLeft" | "jumpRight" | "extendJumpUp" | "extendJumpDown" | "extendJumpLeft" | "extendJumpRight";

/** Movement deltas for the plain move* / extend* actions. */
const MOVE_DELTA: Record<MoveAction, { dx: number; dy: number }> = {
  moveUp: { dx: 0, dy: -1 },
  moveDown: { dx: 0, dy: 1 },
  moveLeft: { dx: -1, dy: 0 },
  moveRight: { dx: 1, dy: 0 },
  moveUpKeepSelection: { dx: 0, dy: -1 },
  moveDownKeepSelection: { dx: 0, dy: 1 },
  moveLeftKeepSelection: { dx: -1, dy: 0 },
  moveRightKeepSelection: { dx: 1, dy: 0 },
  extendUp: { dx: 0, dy: -1 },
  extendDown: { dx: 0, dy: 1 },
  extendLeft: { dx: -1, dy: 0 },
  extendRight: { dx: 1, dy: 0 },
};

const JUMP_DIRECTION: Record<JumpAction, JumpDirection> = {
  jumpUp: "up",
  jumpDown: "down",
  jumpLeft: "left",
  jumpRight: "right",
  extendJumpUp: "up",
  extendJumpDown: "down",
  extendJumpLeft: "left",
  extendJumpRight: "right",
};

export function hasCellSelection(selection: GridSelection): boolean {
  return selection.current !== null || selection.columns.length > 0;
}
