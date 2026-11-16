import { type StoreApi } from "zustand/vanilla";
import {
  type ColumnLayout,
  type DataGridPlugin,
  type GridCommand,
  type GridSelection,
  type SelectionState,
  type CellType,
  type FilterNode,
  type Keymap,
} from "../types";
import { BUILTIN_ACTIONS, keymapContentEqual, validateKeymap, validateSharedBindings } from "../keyboard";
import { CompactSelection } from "../selection/compact-selection";
import { buildColumnGroupModel, columnGroupModelsEqual, type ColumnGroupModel } from "../columns/column-groups";
import { cellTypes as defaultCellTypes } from "../cell-types/cell-types";
import { isSelectionEmpty } from "../selection";
import {
  type ColumnLayoutParts,
  completeColumnOrder as completeColumnOrderBase,
  computeColumnLayout as computeColumnLayoutBase,
  computeSearchMatches,
  computeVisibleColumns as computeVisibleColumnsBase,
  computeViewIndex,
  viewSorts,
  viewFilters,
  carryRuntimePins,
  firstChangedSeedField,
  pinsOf,
  defHiddenColumnIds,
  DEFAULT_LOCALE,
  withGridLocale,
  isColumnLayoutObject,
  layoutSnapshotsEqual,
  memoizedMergeLabels,
  normalizeColumnLayout as normalizeColumnLayoutBase,
  pruneCellErrors,
  resolveSelectionConfig,
  resolveSortMode,
  resolveFilterMode,
  withFilterIds,
} from "./compute";
import { createWarnOnce, isDev, warnDev } from "../is-dev";
import { NO_REMEMBERED_ROWS, hiddenCheckedRowsActive } from "./hidden-checked-rows";
import { forgetDeferredRows, resetDeferredRows } from "./data-write";
import { clearStaleRows, pruneStaleRows, serverSpecChanged, staleStateAfterPrune } from "./server-stale";
import { mergePluginCommands, mergePluginKeymaps, pluginsListEqual, resolvePluginsList, warnPluginComponentRemounts } from "./plugins";
import { resolveSelectionState, selectionStatesEqual, type ResolveWarnFlag } from "./selection-state";
import type { AnyColumnDef, DataGridStoreState, InternalSyncProps, ResolvedPlugins, SyncInputs } from "./types";
import { syncInputsEqual } from "./types";
import { checkSortLocale, DEFAULT_SORT_LOCALE } from "../sort-filter/sort-collator";
import type { DataWriteContext } from "./data-write";
import type { RowValidation } from "./row-validation";
import type { RowIndexCache } from "./row-index";

/**
 * Resolves the `cellTypes` prop against the built-ins: entries merge OVER the built-ins, and a
 * `null` entry removes a built-in (or a previously provided type). Built-ins stay available when
 * the consumer provides only custom types.
 */
export function resolveCellTypes(provided: Record<string, CellType | null> | undefined): Record<string, CellType> {
  if (provided === undefined) return defaultCellTypes as unknown as Record<string, CellType>;
  const out: Record<string, CellType> = { ...(defaultCellTypes as unknown as Record<string, CellType>) };
  for (const [key, value] of Object.entries(provided)) {
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out;
}


/** A filter tree compared by content: the generated `filterId`s change with every controlled re-creation of the same filters. */
export function filterSpecKey(filters: readonly unknown[]): string {
  return JSON.stringify(filters, (key, value: unknown) => (key === "filterId" ? undefined : value));
}

/** A sort list compared by content: a controlled prop re-creates an equal array on every render. */
export function sortSpecKey(sorts: readonly unknown[]): string {
  return JSON.stringify(sorts);
}


export type ProvidedCellTypes = Record<string, CellType | null> | undefined;

/** Whether two `getRowId` functions disagree on the first or the last loaded row (lazy holes are skipped). */
export function sampledRowIdsDiffer(
  data: readonly unknown[],
  before: (row: unknown, index: number) => string,
  after: (row: unknown, index: number) => string,
): boolean {
  const differs = (index: number) => before(data[index], index) !== after(data[index], index);
  const first = data.findIndex((row) => row !== undefined);
  if (first === -1) return false;
  const last = data.findLastIndex((row) => row !== undefined);
  return differs(first) || differs(last);
}

/** True when both `cellTypes` props hold the same keys with `===` entries (an inline literal re-created per render). */
export function sameCellTypeEntries(a: ProvidedCellTypes, b: ProvidedCellTypes): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => key in b && a[key] === b[key]);
}

export function resolveSortLocale(props: { sortLocale?: string; locale?: string }): string {
  const sortLocale = props.sortLocale ?? props.locale ?? DEFAULT_SORT_LOCALE;
  if (sortLocale !== DEFAULT_SORT_LOCALE) checkSortLocale(sortLocale, props.sortLocale === undefined ? "locale" : "sortLocale");
  return sortLocale;
}


/** The add-on command names and the key each add-on binds: a `commands` entry for one of them has no key unless the add-on or the keymap binds it. */
export const ADDON_COMMAND_KEYS = { undo: "mod+z", redo: "mod+shift+z", fillDown: "mod+d", fillRight: "mod+r", openFind: "mod+f", openFindReplace: "shift+alt+Enter", openKeybindings: "?" } as const;


/** The patch that ends "all matching" with the old result: the rows are unchecked and the exclusions forgotten. */
export function endAllMatching(selection: GridSelection): Pick<DataGridStoreState, "selection" | "hiddenCheckedRowIds" | "allMatching"> {
  return { selection: { ...selection, rows: CompactSelection.empty() }, ...NO_REMEMBERED_ROWS };
}

export type SyncMemory = {
  groupModel: ColumnGroupModel | null;
  lastPropsCellTypes: ProvidedCellTypes;
  lastSyncInputs: SyncInputs;
  lastPropsColumnGroups: InternalSyncProps["columnGroups"];
  lastPropsColumns: readonly AnyColumnDef[];
  lastColumnsLocale: string | undefined;
  lastKeymapProp: Keymap | undefined;
  lastCommandsProp: Record<string, GridCommand<unknown>> | null | undefined;
  lastPluginsProp: readonly DataGridPlugin[] | undefined;
  lastPropsFilterState: FilterNode[] | undefined;
  warnedCommandShadow: boolean;
  warnedMovedCommands: boolean;
  claimedPlugins: readonly DataGridPlugin[] | undefined;
  releasePluginClaims: (() => void) | null;
  warnedGetRowIdSwap: boolean;
  warnedSeedChange: boolean;
  selectionControlled: boolean;
  lastKnownSelection: SelectionState;
  selectionEchoQueue: SelectionState[];
  /** The pointer press that drives the selection, and whether it changed the selection. */
  selectionPress: { changed: boolean } | null;
  layoutEchoQueue: Partial<ColumnLayout>[];
};

export type SyncPhaseDeps = {
  dataWrite: DataWriteContext;
  rowIndexCache: RowIndexCache;
  rowValidation: RowValidation;
  followView: FollowView;
  announceChecked: (s: DataGridStoreState, next: Pick<DataGridStoreState, "selection"> & Partial<Pick<DataGridStoreState, "hiddenCheckedRowIds" | "allMatching">>) => Partial<DataGridStoreState>;
  mergeLabels: ReturnType<typeof memoizedMergeLabels>;
  pluginWarnOnce: (key: string, message: string) => void;
  warnStoreOnce: ReturnType<typeof createWarnOnce>;
  warnHiddenCheckedIgnored: (reason: string) => void;
  warnedControlledSelection: ResolveWarnFlag;
  warnGroupIssues: (model: ColumnGroupModel | null) => void;
  completeColumnOrder: (columns: readonly AnyColumnDef[], order: readonly string[] | null) => ReturnType<typeof completeColumnOrderBase>;
  computeColumnLayout: (columns: readonly AnyColumnDef[], order: string[] | null, widths: Record<string, number>, hidden: readonly string[]) => ReturnType<typeof computeColumnLayoutBase>;
  computeVisibleColumns: (columns: readonly AnyColumnDef[], order: string[] | null, hidden: readonly string[]) => ReturnType<typeof computeVisibleColumnsBase>;
  normalizeColumnLayout: (columns: readonly AnyColumnDef[], parts: ColumnLayoutParts, hidden: string[]) => ReturnType<typeof normalizeColumnLayoutBase>;
};

export type FollowView = (
  s: DataGridStoreState,
  viewIndex: readonly number[],
  visibleColumns: readonly AnyColumnDef[],
  data?: readonly unknown[],
  getRowId?: (row: unknown, index: number) => string,
  sameRecords?: boolean,
) => Partial<DataGridStoreState>;

export function createSyncPhase(set: StoreApi<DataGridStoreState>["setState"], get: StoreApi<DataGridStoreState>["getState"], api: StoreApi<DataGridStoreState>, memory: SyncMemory, deps: SyncPhaseDeps) {
  const { dataWrite, rowIndexCache, rowValidation, followView, announceChecked, mergeLabels, pluginWarnOnce, warnStoreOnce, warnHiddenCheckedIgnored, warnedControlledSelection, warnGroupIssues, completeColumnOrder, computeColumnLayout, computeVisibleColumns, normalizeColumnLayout } = deps;
  return {
    syncConfig(props: InternalSyncProps): void {
      if (props.commands && !memory.warnedCommandShadow && isDev()) {
        const shadowed = Object.keys(props.commands).filter((name) => (BUILTIN_ACTIONS as readonly string[]).includes(name));
        if (shadowed.length > 0) {
          memory.warnedCommandShadow = true;
          warnDev(`commands shadows built-in action(s) ${shadowed.join(", ")}; the command wins and the built-in no longer dispatches`);
        }
      }
      // An entry-equal `plugins` re-render (an inline array with stable members) keeps
      // `s.plugins`, `s.commands`, and `s.keymap`'s references (spec decision 7); only a real
      // change re-resolves and re-merges (the keymap then re-runs the dev-only binding validation).
      const pluginsChanged = !pluginsListEqual(props.plugins, memory.lastPluginsProp);
      const keymapChanged = !keymapContentEqual(props.keymap, memory.lastKeymapProp);
      const commandsChanged = props.commands !== memory.lastCommandsProp;
      let nextPlugins: ResolvedPlugins | null = null;
      let nextKeymap: Keymap | null = null;
      let nextCommands: Record<string, GridCommand<unknown>> | null = null;
      let commandsUpdated = false;
      if (pluginsChanged || keymapChanged || commandsChanged) {
        if (pluginsChanged) {
          warnPluginComponentRemounts(get().plugins.list, props.plugins ?? [], pluginWarnOnce);
          nextPlugins = resolvePluginsList(props.plugins, api, pluginWarnOnce);
        }
        if (pluginsChanged || keymapChanged) {
          nextKeymap = mergePluginKeymaps((nextPlugins ?? get().plugins).list, props.keymap, pluginWarnOnce);
          if (isDev()) {
            validateKeymap(nextKeymap);
            validateSharedBindings(nextKeymap);
          }
        }
        if (pluginsChanged || commandsChanged) {
          nextCommands = mergePluginCommands((nextPlugins ?? get().plugins).list, props.commands, pluginWarnOnce);
          commandsUpdated = true;
        }
        memory.lastPluginsProp = props.plugins;
        memory.lastKeymapProp = props.keymap;
        memory.lastCommandsProp = props.commands;
      }
      if (props.commands && !memory.warnedMovedCommands && isDev()) {
        const keymap = (nextKeymap ?? get().keymap) as Record<string, readonly unknown[] | undefined>;
        const unbound = (Object.keys(ADDON_COMMAND_KEYS) as (keyof typeof ADDON_COMMAND_KEYS)[]).filter((name) => props.commands && name in props.commands && !props.keymap?.[name as keyof Keymap] && !keymap[name]?.length);
        if (unbound.length > 0) {
          memory.warnedMovedCommands = true;
          warnDev(`commands ${unbound.join(", ")} have no key: the add-on that binds the key is not mounted; bind the action in the keymap, for example keymap={{ ${unbound[0]}: ["${ADDON_COMMAND_KEYS[unbound[0]!]}"] }}`);
        }
      }
      set((s) => {
        const selectionConfig = resolveSelectionConfig(props);
        if (selectionConfig.checkedRowsLifetime === "across-filters" && selectionConfig.totalRowCount === undefined && (s.sortMode === "server" || s.filterMode === "server")) {
          warnHiddenCheckedIgnored("with sortMode=\"server\" or filterMode=\"server\" (the grid does not hold every row)");
        }
        const forgetsRemembered =
          (s.hiddenCheckedRowIds.size > 0 || s.allMatching) &&
          !hiddenCheckedRowsActive({ ...selectionConfig, sortMode: s.sortMode, filterMode: s.filterMode });
        const endsAllMatching = s.allMatching && selectionConfig.totalRowCount === undefined;
        const rememberedPatch = endsAllMatching ? endAllMatching(s.selection) : forgetsRemembered ? NO_REMEMBERED_ROWS : null;
        return {
          ...selectionConfig,
          ...rememberedPatch,
          ...(rememberedPatch ? announceChecked(s, { selection: s.selection, ...rememberedPatch }) : {}),
          onBeforeDeleteRows: props.onBeforeDeleteRows,
          inputDebounceMs: props.inputDebounceMs,
          onPageChange: props.onPageChange,
          onPageSizeChange: props.onPageSizeChange,
          gateTimeoutMs: props.gateTimeoutMs,
          onRowActionSkipped: props.onRowActionSkipped,
          onGateAborted: props.onGateAborted,
          onSave: props.onSave,
          onSaveRejected: props.onSaveRejected,
          resolveSaveConflict: props.resolveSaveConflict,
          fetchFilterValues: props.fetchFilterValues,
          locale: props.locale ?? DEFAULT_LOCALE,
          labels: mergeLabels(props.labels, props.locale ?? DEFAULT_LOCALE),
          plugins: nextPlugins ?? s.plugins,
          commands: commandsUpdated ? nextCommands : s.commands,
          autosizeOnMount: props.autosizeOnMount,
          onDataChange: props.onDataChange,
          validateRow: props.validateRow,
          processCellForClipboard: props.processCellForClipboard,
          processCellFromClipboard: props.processCellFromClipboard,
          processPaste: props.processPaste,
          sanitizeClipboardFormulas: props.sanitizeClipboardFormulas ?? true,
          createRow: props.createRow,
          duplicateRow: props.duplicateRow,
          onSortChange: props.onSortChange,
          onFilterChange: props.onFilterChange,
          onSearchTextChange: props.onSearchTextChange,
          onColumnLayoutChange: props.onColumnLayoutChange,
          onColumnResizing: props.onColumnResizing,
          onSelectionChange: props.onSelectionChange,
          onActiveCellChange: props.onActiveCellChange,
          onBeforeEditStart: props.onBeforeEditStart,
          onEditEnd: props.onEditEnd,
          onValidationError: props.onValidationError,
          onCellDoubleClick: props.onCellDoubleClick,
          onCellContextMenu: props.onCellContextMenu,
          onCellClick: props.onCellClick,
          onRenderedRowsChange: props.onRenderedRowsChange,
          readOnly: Boolean(props.readOnly),
          announceResults: props.announceResults ?? false,
          keymap: nextKeymap ?? s.keymap,
        };
      });
      // A flip to readOnly cancels an open edit session (so onEditEnd fires with `cancel`); an
      // already-closed session has nothing to cancel.
      if (props.readOnly && get().editing) get().actions.cancelEditing();
    },
    syncProps(props: InternalSyncProps): void {
      set((s) => {
        // A defined controlled prop is the source of truth; otherwise the store keeps its own state.
        const nextSortState = props.sortState === undefined || sortSpecKey(props.sortState) === sortSpecKey(s.sortState) ? s.sortState : props.sortState;
        // A controlled filterState may omit filterId; the same prop reference reuses s.filterState.
        const propsFilterStateChanged = props.filterState !== memory.lastPropsFilterState;
        memory.lastPropsFilterState = props.filterState;
        const nextFilterState =
          props.filterState === undefined || !propsFilterStateChanged || filterSpecKey(props.filterState) === filterSpecKey(s.filterState) ? s.filterState : withFilterIds(props.filterState);
        const nextSortMode = resolveSortMode(props);
        const nextSortLocale = resolveSortLocale(props);
        const nextFilterMode = resolveFilterMode(props);
        const nextViewSorts = viewSorts(nextSortMode, nextSortState);
        const serverRows = nextSortMode === "server" || nextFilterMode === "server";
        if (serverRows && s.checkedRowsLifetime === "across-filters" && s.totalRowCount === undefined) {
          warnHiddenCheckedIgnored("with sortMode=\"server\" or filterMode=\"server\" (the grid does not hold every row)");
        }
        const nextSearchText = props.searchText ?? s.searchText;
        const filterSpecChanged = filterSpecKey(nextFilterState) !== filterSpecKey(s.filterState);
        const nextPageSize = props.pageSize !== undefined ? props.pageSize : s.pageSize;
        const nextPage = props.page ?? (filterSpecChanged ? 1 : s.page);
        if (filterSpecChanged && s.pageSize !== null && s.page !== 1) queueMicrotask(() => s.onPageChange?.(1));
        // Controlled data mirrors the prop; uncontrolled keeps the store's array, and `defaultData` is init-only.
        const nextData = s.dataControlled && props.data !== undefined ? props.data : s.data;
        // Our own onDataChange array fed back is an echo; skipping its view rebuild saves ~56 ms at 100k sorted rows.
        // A foreign sync in between replaced s.data, so a late-adopted emitted array is foreign too.
        const isEcho = nextData === dataWrite.lastEmittedData && nextData === s.data;
        const foreignData = nextData !== s.data;
        // An inline `getRowId` is a new function every render; keep the old one unless the ids differ or the data is foreign.
        const idsSwapped = !foreignData && props.getRowId !== s.getRowId && sampledRowIdsDiffer(nextData, s.getRowId, props.getRowId);
        const nextGetRowId = foreignData || idsSwapped ? props.getRowId : s.getRowId;
        if (idsSwapped && !memory.warnedGetRowIdSwap && isDev()) {
          memory.warnedGetRowIdSwap = true;
          warnDev(
            s.dataControlled
              ? "getRowId returns other ids but data kept its array; pass a new data array together with a new getRowId"
              : "getRowId returns other ids but the grid keeps its seeded rows; remount the grid with a new `key` to apply a new getRowId",
          );
        }
        // A foreign array may move or drop rows, so prune errors and rebuild the id map; our own echo keeps both.
        const nextCellErrors = foreignData ? pruneCellErrors(s.cellErrors, nextData, props.getRowId) : s.cellErrors;
        if (foreignData) {
          rowIndexCache.invalidate();
          forgetDeferredRows(dataWrite);
          rowValidation.prune(nextData, props.getRowId);
        }
        const propsColumnsChanged = props.columns !== memory.lastPropsColumns;
        const previousPropsColumns = memory.lastPropsColumns;
        memory.lastPropsColumns = props.columns;
        if (propsColumnsChanged && !memory.warnedSeedChange && props.columnLayout === undefined && isDev()) {
          const changed = firstChangedSeedField(previousPropsColumns, props.columns, s);
          if (changed) {
            memory.warnedSeedChange = true;
            const action = changed.field === "pin" ? "setColumnPin" : "setColumnHidden";
            warnDev(`the ${changed.field} of column "${changed.id}" changed in a new columns array, and a known column id keeps its runtime ${changed.field}; call ${action}, or control the layout with columnLayout`);
          }
        }
        // A def's `pin` and `hidden` seed when its id first appears; a known id keeps its runtime pin and visibility.
        const knownColumns = propsColumnsChanged ? new Map(s.columns.map((c) => [c.id, c])) : null;
        const nextLocale = props.locale ?? DEFAULT_LOCALE;
        const localeChanged = nextLocale !== memory.lastColumnsLocale;
        memory.lastColumnsLocale = nextLocale;
        const nextColumns = knownColumns ? withGridLocale(carryRuntimePins(props.columns, knownColumns), nextLocale, warnStoreOnce) : localeChanged ? withGridLocale(s.columns, nextLocale, warnStoreOnce) : s.columns;
        const reseededHidden = knownColumns ? defHiddenColumnIds(props.columns.filter((c) => !knownColumns.has(c.id))) : [];
        const nextHiddenColumns = reseededHidden.length > 0 ? [...s.hiddenColumns, ...reseededHidden] : s.hiddenColumns;
        // An inline `columnGroups` literal rebuilds the model; the old model stays while structure and headers are equal.
        if (props.columnGroups !== memory.lastPropsColumnGroups || propsColumnsChanged) {
          memory.lastPropsColumnGroups = props.columnGroups;
          const candidate = buildColumnGroupModel(props.columnGroups, nextColumns.map((c) => c.id));
          if (!columnGroupModelsEqual(candidate, memory.groupModel)) {
            memory.groupModel = candidate;
            warnGroupIssues(candidate);
          }
        }
        const groupsChanged = memory.groupModel !== s.columnGroupModel;
        // Widens each typed CellType to the untyped registry shape.
        const propsCellTypes = props.cellTypes as unknown as ProvidedCellTypes;
        const nextCellTypes = sameCellTypeEntries(propsCellTypes, memory.lastPropsCellTypes) ? s.cellTypes : resolveCellTypes(propsCellTypes);
        memory.lastPropsCellTypes = propsCellTypes;
        const nextSyncInputs: SyncInputs = {
          data: nextData,
          cellTypes: nextCellTypes,
          columns: nextColumns,
          sortState: nextViewSorts,
          filterState: viewFilters(nextFilterMode, nextFilterState),
          searchText: nextSearchText,
          columnOrder: s.columnOrder,
          hiddenColumns: nextHiddenColumns,
          columnGroupModel: memory.groupModel,
          pageKey: `${nextPage}|${nextPageSize}`,
          sortLocale: nextSortLocale,
        };
        // An echo skips the recompute only when `data` is the only input that moved.
        const echoOnly =
          isEcho && syncInputsEqual({ ...nextSyncInputs, data: memory.lastSyncInputs.data }, memory.lastSyncInputs);
        const unchanged = syncInputsEqual(nextSyncInputs, memory.lastSyncInputs) || echoOnly;
        memory.lastSyncInputs = nextSyncInputs;

        const nextVisibleColumns = unchanged ? s.visibleColumns : computeVisibleColumns(nextColumns, s.columnOrder, nextHiddenColumns);
        const nextViewIndex = unchanged
          ? s.viewIndex
          : computeViewIndex(nextData, nextColumns, nextViewSorts, viewFilters(nextFilterMode, nextFilterState), s.viewIndex, nextCellTypes, nextPageSize === null ? null : { page: nextPage, pageSize: nextPageSize }, nextSortLocale);
        // Controlled columnLayout (decision 8): the same echo/structural-equal rule as selection,
        // merged over the incoming column state; a new `columns` array re-applies the controlled
        // parts over the new defs (normalize re-seeds def-hidden and ignores pins on `pinnable: false` columns).
        if (!isColumnLayoutObject(props.columnLayout)) memory.layoutEchoQueue = [];
        let layoutApply: Partial<DataGridStoreState> | null = null;
        if (isColumnLayoutObject(props.columnLayout)) {
          const echoIndex = memory.layoutEchoQueue.indexOf(props.columnLayout);
          if (echoIndex !== -1) {
            // The echo and every older entry leave the queue (decision 4); newer entries stay.
            memory.layoutEchoQueue.splice(0, echoIndex + 1);
          } else {
            const pins = pinsOf(nextColumns);
            const normalized = normalizeColumnLayout(
              nextColumns,
              {
                widths: props.columnLayout.widths ?? s.columnWidths,
                order: props.columnLayout.order !== undefined ? props.columnLayout.order : s.columnOrder,
                pins: props.columnLayout.pins ?? pins,
                hidden: props.columnLayout.hidden ?? nextHiddenColumns,
              },
              defHiddenColumnIds(nextColumns),
            );
            const snapshot = computeColumnLayout(normalized.columns, normalized.columnOrder, normalized.columnWidths, normalized.hiddenColumns);
            if (!layoutSnapshotsEqual(snapshot, s.columnLayout)) {
              layoutApply = {
                columns: normalized.columns,
                columnWidths: normalized.columnWidths,
                columnOrder: normalized.columnOrder,
                hiddenColumns: normalized.hiddenColumns,
                visibleColumns: computeVisibleColumns(normalized.columns, normalized.columnOrder, normalized.hiddenColumns),
                columnLayout: snapshot,
              };
            }
          }
        }
        // Controlled selection (decision 4): an echo or a structurally-equal value applies
        // nothing; any other new identity resolves against the incoming view and overrides the
        // store. Resolving against the incoming view (not `s`) keeps an applied value positional
        // when a foreign data swap lands in the same sync.
        if (props.selection !== undefined) memory.selectionControlled = true;
        else {
          memory.selectionControlled = false;
          memory.selectionEchoQueue = [];
        }
        const finalColumns = layoutApply?.columns ?? nextColumns;
        const finalVisibleColumns = layoutApply?.visibleColumns ?? nextVisibleColumns;
        let selectionApply: Partial<DataGridStoreState> | null = null;
        if (props.selection !== undefined) {
          const echoIndex = memory.selectionEchoQueue.indexOf(props.selection);
          if (echoIndex !== -1) {
            // The echo and every older entry leave the queue (decision 4); newer entries stay.
            memory.selectionEchoQueue.splice(0, echoIndex + 1);
            memory.lastKnownSelection = props.selection;
          } else if (selectionStatesEqual(props.selection, memory.lastKnownSelection)) {
            memory.lastKnownSelection = props.selection;
          } else {
            const resolved = resolveSelectionState(
              { data: nextData, getRowId: nextGetRowId, viewIndex: nextViewIndex, visibleColumns: finalVisibleColumns, selection: s.selection },
              rowIndexCache,
              props.selection,
              warnedControlledSelection,
            );
            memory.lastKnownSelection = resolved.selection;
            if (resolved.grid !== s.selection) {
              selectionApply = {
                selection: resolved.grid,
                ...(isSelectionEmpty(resolved.grid) ? NO_REMEMBERED_ROWS : {}),
                ...(resolved.activeCell !== undefined ? { activeCell: resolved.activeCell } : {}),
              };
            }
          }
        }
        // A full rebuild leaves nothing pending for the incremental path to replay.
        if (!unchanged) resetDeferredRows(dataWrite);
        let nextStaleRowIds = s.staleRowIds;
        if (dataWrite.staleRows.size > 0) {
          if (serverSpecChanged(s, { sortState: nextSortState, filterState: nextFilterState, searchText: nextSearchText })) nextStaleRowIds = clearStaleRows(dataWrite).staleRowIds;
          else if (foreignData) nextStaleRowIds = staleStateAfterPrune(dataWrite, s.staleRowIds, pruneStaleRows(dataWrite, nextData, nextGetRowId as (row: unknown, index: number) => string));
        }
        const staleChanged = nextStaleRowIds !== s.staleRowIds;
        const clientViewActive = viewSorts(nextSortMode, nextSortState).length > 0 || viewFilters(nextFilterMode, nextFilterState).length > 0;
        // An echo-only sync (every recompute input unchanged, selection/layout no-ops, flags
        // stable) returns the same state so zustand skips every listener: the controlled loop
        // pays zero store work per drag step (decision 4).
        const flagsChanged =
          s.sortControlled !== (props.sortState !== undefined) ||
          s.sortMode !== nextSortMode ||
          s.filterMode !== nextFilterMode ||
          s.filterState !== nextFilterState ||
          s.sortState !== nextSortState ||
          s.filterControlled !== (props.filterState !== undefined) ||
          s.searchControlled !== (props.searchText !== undefined);
        if (unchanged && nextGetRowId === s.getRowId && layoutApply === null && selectionApply === null && !flagsChanged) return s;
        // A layout-only apply still remaps the selection's column channel (its visible columns
        // moved), so the remap runs whenever a layout apply is in flight.
        const followed =
          unchanged && layoutApply === null
            ? {}
            : followView(s, nextViewIndex, finalVisibleColumns, nextData, nextGetRowId, !foreignData);
        // Only the recompute slice is written here: the config slice (callbacks, enable* flags,
        // readOnly, keymap, …) is owned by _syncConfig, so a data/sort/filter sync never rewrites it.
        return {
          data: nextData,
          getRowId: nextGetRowId,
          cellErrors: nextCellErrors,
          columns: finalColumns,
          hiddenColumns: layoutApply?.hiddenColumns ?? nextHiddenColumns,
          cellTypes: nextCellTypes,
          visibleColumns: finalVisibleColumns,
          columnWidths: layoutApply?.columnWidths ?? s.columnWidths,
          columnOrder: layoutApply?.columnOrder ?? (groupsChanged && s.columnOrder ? completeColumnOrder(nextColumns, s.columnOrder) : s.columnOrder),
          columnGroupModel: memory.groupModel,
          // A `columns` or group swap re-seeds the snapshot even uncontrolled.
          columnLayout:
            layoutApply?.columnLayout ??
            (propsColumnsChanged || groupsChanged ? computeColumnLayout(nextColumns, s.columnOrder, s.columnWidths, nextHiddenColumns) : s.columnLayout),
          sortState: nextSortState,
          sortMode: nextSortMode,
          sortLocale: nextSortLocale,
          filterMode: nextFilterMode,
          filterState: nextFilterState,
          searchText: nextSearchText,
          sortControlled: props.sortState !== undefined,
          filterControlled: props.filterState !== undefined,
          searchControlled: props.searchText !== undefined,
          page: nextPage,
          pageSize: nextPageSize,
          pageControlled: props.page !== undefined,
          pageSizeControlled: props.pageSize !== undefined,
          viewIndex: nextViewIndex,
          // A real recompute reconciles a deferred updateCells; an echo or unchanged sync keeps the flag. Stale rows stay until the server delivers them.
          viewStale: !staleChanged && unchanged ? s.viewStale : nextStaleRowIds.size > 0 || (unchanged && s.viewStale && clientViewActive),
          staleRowIds: nextStaleRowIds,
          // Rows move only on a foreign data replacement, never on our own echo.
          rowIdentityVersion: foreignData ? s.rowIdentityVersion + 1 : s.rowIdentityVersion,
          ...followed,
          ...(serverRows && s.hiddenCheckedRowIds.size > 0 && !hiddenCheckedRowsActive({ ...s, sortMode: nextSortMode, filterMode: nextFilterMode }) ? NO_REMEMBERED_ROWS : {}),
          // A layout-only apply moves visible columns, so the search-match row map re-runs with it.
          ...(unchanged && layoutApply === null
            ? { searchMatches: s.searchMatches, searchMatchSet: s.searchMatchSet, searchMatchRows: s.searchMatchRows, searchMatchesCapped: s.searchMatchesCapped }
            : computeSearchMatches(nextData, finalColumns, nextViewIndex, finalVisibleColumns, nextSearchText, nextCellTypes, s.searchOptions)),
          ...(s.allMatching && (nextSearchText !== s.searchText || filterSpecKey(nextFilterState) !== filterSpecKey(s.filterState))
            ? endAllMatching(followed.selection ?? s.selection)
            : {}),
          // The controlled values win over the remapped ones.
          ...selectionApply,
        };
      });
    },
  };
}
