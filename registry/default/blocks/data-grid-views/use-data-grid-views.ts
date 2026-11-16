"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  useDataGridActions,
  useDataGridAllColumns,
  useDataGridFilterState,
  useDataGridSearchText,
  useDataGridSortState,
} from "@/registry/default/blocks/data-grid/data-grid";
import { resolveCustomFilterOperators, setFilterValuesOf, useDataGridSelector, useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import {
  MAX_DOCUMENT_LENGTH,
  MAX_VIEW_FILE_LENGTH,
  MAX_VIEWS,
  captureViewState,
  cleanViewName,
  emptyViewsDocument,
  parseViewDocument,
  parseViewFile,
  sanitizeViewState,
  overLimitPart,
  savableViewState,
  serializeViewFile,
  viewPartKeys,
  viewStateKey,
  type DataGridView,
  type DataGridViewState,
  type DataGridViewsDocument,
  type ViewColumns,
  type OverLimitPart,
} from "./view-state";
import { createLocalStorageViewsStorage, DEFAULT_VIEWS_KEY, type DataGridViewsStorage } from "./view-storage";
import { useWarnSharedViewsKey } from "./shared-key";

/** Options for {@link useDataGridViews}. */
export type UseDataGridViewsOptions = {
  /**
   * Where views persist. A string is the `localStorage` key of the built-in storage (default
   * `"gridcn-views"`); a new key loads again. An object is your own storage: remount the grid with
   * a new `key` to switch to another one, for example another user's. The first load reads it once.
   */
  storage?: string | DataGridViewsStorage;
  /** Id of the active view. Controlled: the hook opens a view when this changes, and picks only call `onValueChange`. */
  value?: string | null;
  /** First active view id when `value` is not set. */
  defaultValue?: string | null;
  onValueChange?: (id: string | null) => void;
  /** Open the default view after load when the grid still holds its start state and `value` and `defaultValue` are unset. Default `true`. */
  enableDefaultView?: boolean;
  /** Called with a load or save failure. */
  onError?: (error: unknown) => void;
};

export type ImportViewResult =
  | { ok: true; view: DataGridView; dropped: number }
  | { ok: false; reason: "too-large" | "invalid" | "limit" | "loading" };

/** Result of {@link useDataGridViews}. */
export type UseDataGridViewsResult = {
  views: readonly DataGridView[];
  activeViewId: string | null;
  activeView: DataGridView | null;
  /** The grid differs from the active view. */
  modified: boolean;
  /**
   * The part of the grid state that exceeds a view limit, or `false`. `saveView` returns `null` and `updateView` returns `false` while it is set.
   * Limits: `"sorts"` 64 sorts; `"filters"` 64 filters, 16 groups, 1,000 characters per value, 1,000 entries per value list; `"search"` 500 characters; `"layout"` a column width over 10,000 px, 1,000 entries per layout list. State of a column the grid lacks is not a limit. A filter value of the wrong shape for its operator, such as a list on `contains`, is over the `"filters"` limit.
   */
  overLimit: false | OverLimitPart;
  defaultViewId: string | null;
  /** The stored views are being read. */
  loading: boolean;
  /** A save is in flight. */
  saving: boolean;
  /** The latest load or save failure, else `null`. */
  error: unknown;
  /** Which request `error` belongs to. */
  failed: "load" | "save" | null;
  /** Repeats the failed load or save. Stable. */
  retry: () => void;
  /** Opens a view (again, to revert changes) and makes it active; `null` only clears the active view. With a controlled `value`, a pick only calls `onValueChange`. */
  selectView: (id: string | null) => void;
  /** Saves the grid state under `name` (trimmed, at most 80 characters) and makes the new view active. `null` for a blank name, the limit of 50 views, a grid state over a view limit (see `overLimit`), or before the load ends. */
  saveView: (name: string) => DataGridView | null;
  /** Replaces a view's state with the grid state. Default: the active view. `false` for an unknown id, no active view, a grid state over a view limit (see `overLimit`), or before the load ends. */
  updateView: (id?: string) => boolean;
  /** Renames a view. `false` for an unknown id, a blank name, or before the load ends. */
  renameView: (id: string, name: string) => boolean;
  /** Deletes a view; deleting the active view clears it, and deleting the default view clears the default. `false` for an unknown id or before the load ends. */
  deleteView: (id: string) => boolean;
  /** Makes a view the one opened after load; `null` clears it. `false` for an unknown id or before the load ends. */
  setDefaultView: (id: string | null) => boolean;
  /** The view as JSON text, or `null` for an unknown id or a view too large to import again. Default: the active view. */
  exportView: (id?: string) => string | null;
  /** Reads JSON from `exportView`, drops what the live columns lack, and saves it as a new active view named `options.name` when the file has none (`"View"` without either). `dropped` counts the removed parts. */
  importView: (text: string, options?: { name?: string }) => ImportViewResult;
};

/** Calls a consumer callback; a throw must not break the hook. */
function callSafely<T>(callback: ((arg: T) => void) | undefined, arg: T): void {
  if (!callback) return;
  try {
    callback(arg);
  } catch (cause) {
    console.error("[data-grid-views] a callback threw", cause);
  }
}

function createViewId(): string {
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Saves and restores named grid views: sort, filters, search, and column layout. Call it inside the
 * grid provider. Opening a view runs the same store actions as a user gesture, only for the parts
 * that differ, so controlled `sortState` and `filterState` receive their change callbacks.
 */
export function useDataGridViews(options: UseDataGridViewsOptions = {}): UseDataGridViewsResult {
  const { value, defaultValue, onValueChange, enableDefaultView = true, onError } = options;
  const storageKey = typeof options.storage === "string" ? options.storage : undefined;
  const defaultStorage = useMemo(() => createLocalStorageViewsStorage(storageKey), [storageKey]);
  const storage = typeof options.storage === "object" ? options.storage : defaultStorage;

  const storeApi = useDataGridStoreApi();
  const actions = useDataGridActions();
  const allColumns = useDataGridAllColumns();
  const sortState = useDataGridSortState();
  const filterState = useDataGridFilterState();
  const searchText = useDataGridSearchText();
  const searchOptions = useDataGridSelector((s) => s.searchOptions);
  const columnLayout = useDataGridSelector((s) => s.columnLayout);

  useWarnSharedViewsKey(typeof options.storage === "object" ? undefined : (storageKey ?? DEFAULT_VIEWS_KEY), allColumns.map((c) => c.id).join("\u0000"));

  const cellTypes = useDataGridSelector((s) => s.cellTypes);
  const registeredOperators = useCallback(
    (column: (typeof allColumns)[number]) => new Map([...resolveCustomFilterOperators(column, column.type ? cellTypes[column.type] : undefined)].map(([id, op]) => [id, op.input ?? "single"] as const)),
    [cellTypes],
  );
  const choiceValues = useCallback((columnId: string) => () => setFilterValuesOf(storeApi.getState())(columnId), [storeApi]);
  const columnMap: ViewColumns = useMemo(() => new Map(allColumns.map((c) => [c.id, { sortable: c.sortable, filterable: c.filterable, operators: registeredOperators(c), choices: choiceValues(c.id) }])), [allColumns, registeredOperators, choiceValues]);
  // opting a column out of sort or filter UI does not stop programmatic specs, so applying a saved view skips those flags
  const knownColumns: ViewColumns = useMemo(() => new Map(allColumns.map((c) => [c.id, { operators: registeredOperators(c), choices: choiceValues(c.id) }])), [allColumns, registeredOperators, choiceValues]);
  const latest = useRef({ columnMap, knownColumns, onValueChange, onError, value, enableDefaultView, defaultValue });
  useLayoutEffect(() => {
    latest.current = { columnMap, knownColumns, onValueChange, onError, value, enableDefaultView, defaultValue };
  });

  const [document, setDocument] = useState<DataGridViewsDocument | null>(null);
  const documentRef = useRef<DataGridViewsDocument | null>(null);
  const loaded = document !== null;
  const [internalActiveId, setInternalActiveId] = useState<string | null>(defaultValue ?? null);
  const activeViewId = value !== undefined ? value : internalActiveId;
  const [appliedKey, setAppliedKey] = useState<string | null>(null);
  const appliedIdRef = useRef<string | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [failed, setFailed] = useState<"load" | "save" | null>(null);
  const failedRef = useRef<"load" | "save" | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const pendingSaveRef = useRef<DataGridViewsDocument | null>(null);
  const savingRef = useRef(false);
  const storageRef = useRef(storage);
  useLayoutEffect(() => {
    storageRef.current = storage;
  });

  const readState = useCallback((): DataGridViewState => {
    const s = storeApi.getState();
    return captureViewState({ sorts: s.sortState, filters: s.filterState, searchText: s.searchText, searchOptions: s.searchOptions, columnLayout: s.columnLayout });
  }, [storeApi]);

  const readSavableState = useCallback(() => savableViewState(readState()), [readState]);

  const reportError = useCallback((kind: "load" | "save", cause: unknown) => {
    failedRef.current = kind;
    setError(cause);
    setFailed(kind);
    callSafely(latest.current.onError, cause);
  }, []);

  const clearError = useCallback(() => {
    failedRef.current = null;
    setError(null);
    setFailed(null);
  }, []);

  const applyState = useCallback(
    (state: DataGridViewState) => {
      const clean = sanitizeViewState(state, latest.current.knownColumns).state;
      const wanted = viewPartKeys(clean);
      const now = viewPartKeys(readState());
      if (wanted.sorts !== now.sorts) actions.setSorts(clean.sorts);
      if (wanted.filters !== now.filters) actions.setFilters(clean.filters);
      if (wanted.search !== now.search) actions.setSearch(clean.searchText, clean.searchOptions);
      if (wanted.layout !== now.layout) actions.setColumnLayout(clean.columnLayout);
      // the store fills in layout parts a view leaves out, so the baseline reads the layout back
      setAppliedKey(viewStateKey({ ...clean, columnLayout: storeApi.getState().columnLayout }));
    },
    [actions, readState, storeApi],
  );

  const notify = useCallback((id: string | null) => callSafely(latest.current.onValueChange, id), []);

  /** Makes `id` active for a state the grid already holds. */
  const setActive = useCallback(
    (id: string | null) => {
      appliedIdRef.current = id;
      if (latest.current.value === undefined) setInternalActiveId(id);
      notify(id);
    },
    [notify],
  );

  const flushSaves = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    while (pendingSaveRef.current) {
      const next = pendingSaveRef.current;
      pendingSaveRef.current = null;
      if (JSON.stringify(next).length > MAX_DOCUMENT_LENGTH) {
        reportError("save", new Error("The saved views are too large to store"));
        continue;
      }
      try {
        await storageRef.current.save(next);
        clearError();
      } catch (cause) {
        reportError("save", cause);
      }
    }
    savingRef.current = false;
    setSaving(false);
  }, [clearError, reportError]);

  const commit = useCallback(
    (next: DataGridViewsDocument) => {
      documentRef.current = next;
      setDocument(next);
      pendingSaveRef.current = next;
      void flushSaves();
    },
    [flushSaves],
  );

  const loadedKeyRef = useRef(storageKey);
  useEffect(() => {
    const controller = new AbortController();
    documentRef.current = null;
    setDocument(null);
    if (loadedKeyRef.current !== storageKey) {
      loadedKeyRef.current = storageKey;
      appliedIdRef.current = undefined;
      if (latest.current.value === undefined) setInternalActiveId(null);
      notify(null);
    }
    void (async () => {
      let raw: unknown;
      try {
        raw = await storageRef.current.load({ signal: controller.signal });
      } catch (cause) {
        if (!controller.signal.aborted) reportError("load", cause);
        return;
      }
      if (controller.signal.aborted) return;
      const parsed = raw == null ? emptyViewsDocument() : parseViewDocument(raw);
      if (!parsed) {
        reportError("load", new Error("The saved views are in an unknown format"));
        return;
      }
      documentRef.current = parsed;
      setDocument(parsed);
      clearError();
      const { value: controlled, defaultValue: seed, enableDefaultView: useDefault } = latest.current;
      const initial = storeApi.getInitialState();
      const untouched =
        viewStateKey(readState()) ===
        viewStateKey(captureViewState({ sorts: initial.sortState, filters: initial.filterState, searchText: initial.searchText, searchOptions: initial.searchOptions, columnLayout: initial.columnLayout }));
      const view = useDefault && controlled === undefined && seed === undefined && untouched ? parsed.views.find((v) => v.id === parsed.defaultViewId) : undefined;
      if (view) {
        applyState(view.state);
        setActive(view.id);
      }
    })();
    return () => controller.abort();
  }, [storageKey, loadAttempt, storeApi, readState, applyState, setActive, notify, reportError, clearError]);

  useEffect(() => {
    if (!loaded) return;
    const controller = new AbortController();
    const unsubscribe = storageRef.current.subscribe?.(() => {
      if (savingRef.current || pendingSaveRef.current) return;
      void (async () => {
        let raw: unknown;
        try {
          raw = await storageRef.current.load({ signal: controller.signal });
        } catch (cause) {
          if (!controller.signal.aborted) reportError("load", cause);
          return;
        }
        if (controller.signal.aborted || savingRef.current || pendingSaveRef.current) return;
        const parsed = raw == null ? emptyViewsDocument() : parseViewDocument(raw);
        if (!parsed) return;
        documentRef.current = parsed;
        setDocument(parsed);
        const activeId = (latest.current.value !== undefined ? latest.current.value : appliedIdRef.current) ?? null;
        if (activeId !== null && !parsed.views.some((view) => view.id === activeId)) setActive(null);
      })();
    });
    return () => {
      controller.abort();
      unsubscribe?.();
    };
  }, [loaded, reportError, setActive]);

  useEffect(() => {
    if (!loaded || appliedIdRef.current === activeViewId) return;
    appliedIdRef.current = activeViewId;
    const view = documentRef.current?.views.find((v) => v.id === activeViewId);
    if (view) applyState(view.state);
  }, [loaded, activeViewId, applyState]);

  const views = document?.views ?? EMPTY_VIEWS;
  const activeView = views.find((v) => v.id === activeViewId) ?? null;

  const currentKey = useMemo(
    () => (activeView ? viewStateKey({ sorts: sortState, filters: filterState, searchText, searchOptions, columnLayout }) : null),
    [activeView, sortState, filterState, searchText, searchOptions, columnLayout],
  );

  const overLimit = useMemo(
    () => overLimitPart(captureViewState({ sorts: sortState, filters: filterState, searchText, searchOptions, columnLayout })),
    [sortState, filterState, searchText, searchOptions, columnLayout],
  );

  const activeIdNow = useCallback(() => (latest.current.value !== undefined ? latest.current.value : appliedIdRef.current) ?? null, []);

  const selectView = useCallback(
    (id: string | null) => {
      const view = id === null ? undefined : documentRef.current?.views.find((v) => v.id === id);
      if (id !== null && !view) return;
      const controlled = latest.current.value !== undefined;
      if (controlled) {
        if (view && latest.current.value === id) applyState(view.state);
        else notify(id);
        return;
      }
      if (view) applyState(view.state);
      setActive(id);
    },
    [applyState, notify, setActive],
  );

  const saveView = useCallback(
    (name: string) => {
      const current = documentRef.current;
      const clean = cleanViewName(name);
      if (!current || clean === "" || current.views.length >= MAX_VIEWS) return null;
      const state = readSavableState();
      if (!state) return null;
      const view: DataGridView = { id: createViewId(), name: clean, state };
      commit({ ...current, views: [...current.views, view] });
      setAppliedKey(viewStateKey(view.state));
      setActive(view.id);
      return view;
    },
    [commit, readSavableState, setActive],
  );

  const updateView = useCallback(
    (id?: string) => {
      const current = documentRef.current;
      const targetId = id ?? activeIdNow();
      if (!current || !targetId || !current.views.some((v) => v.id === targetId)) return false;
      const state = readSavableState();
      if (!state) return false;
      commit({ ...current, views: current.views.map((v) => (v.id === targetId ? { ...v, state } : v)) });
      if (targetId === activeIdNow()) setAppliedKey(viewStateKey(state));
      return true;
    },
    [activeIdNow, commit, readSavableState],
  );

  const renameView = useCallback(
    (id: string, name: string) => {
      const current = documentRef.current;
      const clean = cleanViewName(name);
      if (!current || clean === "" || !current.views.some((v) => v.id === id)) return false;
      commit({ ...current, views: current.views.map((v) => (v.id === id ? { ...v, name: clean } : v)) });
      return true;
    },
    [commit],
  );

  const deleteView = useCallback(
    (id: string) => {
      const current = documentRef.current;
      if (!current || !current.views.some((v) => v.id === id)) return false;
      commit({ ...current, views: current.views.filter((v) => v.id !== id), defaultViewId: current.defaultViewId === id ? null : current.defaultViewId });
      if (activeIdNow() === id) setActive(null);
      return true;
    },
    [activeIdNow, commit, setActive],
  );

  const setDefaultView = useCallback(
    (id: string | null) => {
      const current = documentRef.current;
      if (!current || (id !== null && !current.views.some((v) => v.id === id))) return false;
      commit({ ...current, defaultViewId: id });
      return true;
    },
    [commit],
  );

  const exportView = useCallback(
    (id?: string) => {
      const targetId = id ?? activeIdNow();
      const view = documentRef.current?.views.find((v) => v.id === targetId);
      if (!view) return null;
      const text = serializeViewFile(view);
      return text.length > MAX_VIEW_FILE_LENGTH ? null : text;
    },
    [activeIdNow],
  );

  const importView = useCallback(
    (text: string, importOptions?: { name?: string }): ImportViewResult => {
      const current = documentRef.current;
      if (!current) return { ok: false, reason: "loading" };
      if (current.views.length >= MAX_VIEWS) return { ok: false, reason: "limit" };
      const parsed = parseViewFile(text, latest.current.columnMap);
      if (!parsed.ok) return parsed;
      const view: DataGridView = { id: createViewId(), name: parsed.name || cleanViewName(importOptions?.name) || "View", state: parsed.state };
      commit({ ...current, views: [...current.views, view] });
      applyState(view.state);
      setActive(view.id);
      return { ok: true, view, dropped: parsed.dropped };
    },
    [applyState, commit, setActive],
  );

  const retry = useCallback(() => {
    if (failedRef.current === "load") setLoadAttempt((n) => n + 1);
    else if (failedRef.current === "save" && documentRef.current) {
      pendingSaveRef.current = documentRef.current;
      void flushSaves();
    }
  }, [flushSaves]);

  return {
    views,
    activeViewId,
    activeView,
    modified: currentKey !== null && appliedKey !== null && currentKey !== appliedKey,
    overLimit,
    defaultViewId: document?.defaultViewId ?? null,
    loading: document === null && failed !== "load",
    saving,
    error,
    failed,
    retry,
    selectView,
    saveView,
    updateView,
    renameView,
    deleteView,
    setDefaultView,
    exportView,
    importView,
  };
}

const EMPTY_VIEWS: readonly DataGridView[] = [];
