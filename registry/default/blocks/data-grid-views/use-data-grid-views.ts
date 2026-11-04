"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useDataGridActions,
  useDataGridAllColumns,
  useDataGridFilterState,
  useDataGridSearchText,
  useDataGridSortState,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridSelector, useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import {
  MAX_VIEWS,
  captureViewState,
  cleanViewName,
  parseViewDocument,
  parseViewFile,
  sanitizeViewState,
  serializeViewFile,
  viewStateKey,
  type DataGridView,
  type DataGridViewState,
  type DataGridViewsDocument,
  type ViewColumns,
} from "./view-state";
import { createLocalStorageViewsStorage, type DataGridViewsStorage } from "./view-storage";

/** Options for {@link useDataGridViews}. */
export type UseDataGridViewsOptions = {
  /** Where views persist. Default: `localStorage` under `storageKey`, with an in-memory fallback. The first load reads it once; a new `storageKey` loads again. */
  storage?: DataGridViewsStorage;
  /** `localStorage` key of the default storage; ignored when `storage` is set. Default `"gridcn-views"`. */
  storageKey?: string;
  /** Id of the active view. Controlled: the hook applies a view when this changes and reports picks through `onValueChange`. */
  value?: string | null;
  /** First active view id when `value` is not set. */
  defaultValue?: string | null;
  onValueChange?: (id: string | null) => void;
  /** Apply the default view after load when the grid still holds its start state and `value` and `defaultValue` are unset. Default `true`. */
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
  defaultViewId: string | null;
  /** The stored views are being read. */
  loading: boolean;
  /** A save is in flight. */
  saving: boolean;
  /** The latest load or save failure, else `null`. */
  error: unknown;
  /** Repeats the failed load or save. */
  retry: () => void;
  /** Applies a view (again, to revert changes) and makes it active; `null` only clears the active view. */
  selectView: (id: string | null) => void;
  /** Saves the grid state under `name` and makes the new view active. `null` for a blank name, the view limit, or before the load ends. */
  saveView: (name: string) => DataGridView | null;
  /** Replaces a view's state with the grid state. Default: the active view. */
  updateView: (id?: string) => boolean;
  renameView: (id: string, name: string) => boolean;
  deleteView: (id: string) => boolean;
  setDefaultView: (id: string | null) => boolean;
  /** The view as JSON text, or `null` for an unknown id. Default: the active view. */
  exportView: (id?: string) => string | null;
  /** Reads JSON from `exportView`, drops what the live columns lack, and saves it as a new active view. */
  importView: (text: string) => ImportViewResult;
};

function createViewId(): string {
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Saves and restores named grid views: sort, filters, search, and column layout. Call it inside the
 * grid provider. Applying a view runs the same store actions as a user gesture, so controlled
 * `sortState` and `filterState` receive their change callbacks.
 */
export function useDataGridViews(options: UseDataGridViewsOptions = {}): UseDataGridViewsResult {
  const { storageKey, value, defaultValue, onValueChange, enableDefaultView = true, onError } = options;
  const defaultStorage = useMemo(() => createLocalStorageViewsStorage(storageKey), [storageKey]);
  const storage = options.storage ?? defaultStorage;

  const storeApi = useDataGridStoreApi();
  const actions = useDataGridActions();
  const allColumns = useDataGridAllColumns();
  const sortState = useDataGridSortState();
  const filterState = useDataGridFilterState();
  const searchText = useDataGridSearchText();
  const searchOptions = useDataGridSelector((s) => s.searchOptions);
  const columnLayout = useDataGridSelector((s) => s.columnLayout);

  const columnMap: ViewColumns = useMemo(() => new Map(allColumns.map((c) => [c.id, { sortable: c.sortable, filterable: c.filterable }])), [allColumns]);
  const latest = useRef({ columnMap, onValueChange, onError, value, enableDefaultView, defaultValue });
  latest.current = { columnMap, onValueChange, onError, value, enableDefaultView, defaultValue };

  const [document, setDocument] = useState<DataGridViewsDocument | null>(null);
  const documentRef = useRef<DataGridViewsDocument | null>(null);
  const [internalActiveId, setInternalActiveId] = useState<string | null>(defaultValue ?? null);
  const activeViewId = value !== undefined ? value : internalActiveId;
  const [appliedKey, setAppliedKey] = useState<string | null>(null);
  const appliedIdRef = useRef<string | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [failed, setFailed] = useState<"load" | "save" | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const pendingSaveRef = useRef<DataGridViewsDocument | null>(null);
  const savingRef = useRef(false);
  const storageRef = useRef(storage);
  storageRef.current = storage;

  const readState = useCallback((): DataGridViewState => {
    const s = storeApi.getState();
    return captureViewState({ sorts: s.sortState, filters: s.filterState, searchText: s.searchText, searchOptions: s.searchOptions, columnLayout: s.columnLayout });
  }, [storeApi]);

  const reportError = useCallback((kind: "load" | "save", cause: unknown) => {
    setError(cause);
    setFailed(kind);
    try {
      latest.current.onError?.(cause);
    } catch {
      // a throwing consumer callback must not break the hook
    }
  }, []);

  const applyState = useCallback(
    (state: DataGridViewState) => {
      const clean = sanitizeViewState(state, latest.current.columnMap).state;
      actions.setSorts(clean.sorts);
      actions.setFilters(clean.filters);
      actions.setSearch(clean.searchText, clean.searchOptions);
      actions.setColumnLayout(clean.columnLayout);
      // the store fills in layout parts a view leaves out, so the baseline reads the layout back
      setAppliedKey(viewStateKey({ ...clean, columnLayout: storeApi.getState().columnLayout }));
    },
    [actions, storeApi],
  );

  const setActive = useCallback((id: string | null) => {
    appliedIdRef.current = id;
    if (latest.current.value === undefined) setInternalActiveId(id);
    try {
      latest.current.onValueChange?.(id);
    } catch {
      // a throwing consumer callback must not break the hook
    }
  }, []);

  const flushSaves = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      while (pendingSaveRef.current) {
        const next = pendingSaveRef.current;
        pendingSaveRef.current = null;
        try {
          await storageRef.current.save(next);
          setError(null);
          setFailed(null);
        } catch (cause) {
          reportError("save", cause);
        }
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [reportError]);

  const commit = useCallback(
    (next: DataGridViewsDocument) => {
      documentRef.current = next;
      setDocument(next);
      pendingSaveRef.current = next;
      void flushSaves();
    },
    [flushSaves],
  );

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const loaded = parseViewDocument(await storageRef.current.load({ signal: controller.signal }));
        if (controller.signal.aborted) return;
        documentRef.current = loaded;
        setDocument(loaded);
        setError(null);
        setFailed(null);
        const { value: controlled, defaultValue: seed, enableDefaultView: useDefault } = latest.current;
        const initial = storeApi.getInitialState();
        const untouched =
          viewStateKey(readState()) ===
          viewStateKey(captureViewState({ sorts: initial.sortState, filters: initial.filterState, searchText: initial.searchText, searchOptions: initial.searchOptions, columnLayout: initial.columnLayout }));
        const view = useDefault && controlled === undefined && seed === undefined && untouched ? loaded.views.find((v) => v.id === loaded.defaultViewId) : undefined;
        if (view) {
          applyState(view.state);
          setActive(view.id);
        }
      } catch (cause) {
        if (!controller.signal.aborted) reportError("load", cause);
      }
    })();
    return () => controller.abort();
  }, [storageKey, loadAttempt, storeApi, readState, applyState, setActive, reportError]);

  useEffect(() => {
    if (!document || appliedIdRef.current === activeViewId) return;
    appliedIdRef.current = activeViewId;
    const view = document.views.find((v) => v.id === activeViewId);
    if (view) applyState(view.state);
  }, [document, activeViewId, applyState]);

  const currentKey = useMemo(
    () => viewStateKey({ sorts: sortState, filters: filterState, searchText, searchOptions, columnLayout }),
    [sortState, filterState, searchText, searchOptions, columnLayout],
  );

  const views = document?.views ?? EMPTY_VIEWS;
  const activeView = views.find((v) => v.id === activeViewId) ?? null;

  const selectView = useCallback(
    (id: string | null) => {
      const view = id === null ? undefined : documentRef.current?.views.find((v) => v.id === id);
      if (id !== null && !view) return;
      if (view) applyState(view.state);
      setActive(id);
    },
    [applyState, setActive],
  );

  const saveView = useCallback(
    (name: string) => {
      const current = documentRef.current;
      const clean = cleanViewName(name);
      if (!current || clean === "" || current.views.length >= MAX_VIEWS) return null;
      const view: DataGridView = { id: createViewId(), name: clean, state: readState() };
      commit({ ...current, views: [...current.views, view] });
      setAppliedKey(viewStateKey(view.state));
      setActive(view.id);
      return view;
    },
    [commit, readState, setActive],
  );

  const updateView = useCallback(
    (id?: string) => {
      const current = documentRef.current;
      const targetId = id ?? appliedIdRef.current;
      if (!current || !targetId || !current.views.some((v) => v.id === targetId)) return false;
      const state = readState();
      commit({ ...current, views: current.views.map((v) => (v.id === targetId ? { ...v, state } : v)) });
      if (targetId === appliedIdRef.current) setAppliedKey(viewStateKey(state));
      return true;
    },
    [commit, readState],
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
      if (appliedIdRef.current === id) setActive(null);
      return true;
    },
    [commit, setActive],
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

  const exportView = useCallback((id?: string) => {
    const targetId = id ?? appliedIdRef.current ?? undefined;
    const view = documentRef.current?.views.find((v) => v.id === targetId);
    return view ? serializeViewFile(view) : null;
  }, []);

  const importView = useCallback(
    (text: string): ImportViewResult => {
      const current = documentRef.current;
      if (!current) return { ok: false, reason: "loading" };
      if (current.views.length >= MAX_VIEWS) return { ok: false, reason: "limit" };
      const parsed = parseViewFile(text, latest.current.columnMap);
      if (!parsed.ok) return parsed;
      const view: DataGridView = { id: createViewId(), name: parsed.name || "Imported view", state: parsed.state };
      commit({ ...current, views: [...current.views, view] });
      applyState(view.state);
      setActive(view.id);
      return { ok: true, view, dropped: parsed.dropped };
    },
    [applyState, commit, setActive],
  );

  const retry = useCallback(() => {
    if (failed === "load") setLoadAttempt((n) => n + 1);
    else if (failed === "save" && documentRef.current) {
      pendingSaveRef.current = documentRef.current;
      void flushSaves();
    }
  }, [failed, flushSaves]);

  return {
    views,
    activeViewId,
    activeView,
    modified: activeView !== null && appliedKey !== null && currentKey !== appliedKey,
    defaultViewId: document?.defaultViewId ?? null,
    loading: document === null && failed !== "load",
    saving,
    error,
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
