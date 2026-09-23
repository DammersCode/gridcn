"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import type { GlobalShortcutsConfig } from "./global-shortcuts";
import { enabledGlobalActions, isMacPlatform, resolveGlobalShortcut } from "./global-shortcuts";
import { useDataGridContainer } from "../interaction/use-data-grid-container";
import { useDataGridKeymap, useDataGridStoreApi } from "../store";

/** Multi-grid focus owner: the id of the last opted-in grid whose container received `focusin`. */
let lastFocusedGrid: number | null = null;
let nextGridId = 0;

/**
 * Opt-in: while DOM focus is OUTSIDE the grid, intercept the effective keymap's undo/redo
 * bindings on `window` keydown and dispatch the grid's `onUndo`/`onRedo` seam — the same seam the
 * in-grid keymap runs, so with the `data-grid-history` add-on it undoes grid edits and without it
 * it is a no-op (identical parity to in-grid undo/redo).
 *
 * Keys are NOT configured as strings: the hook reads the effective keymap from the store, so a
 * consumer's `keymap` prop overrides apply — remapping `undo` remaps the global binding too, no
 * second source of truth. The config is an object by design: registering the same action twice
 * is a compile error (see {@link GlobalShortcutsConfig}).
 *
 * Gating (see {@link resolveGlobalShortcut}): skipped while composing, when `defaultPrevented`,
 * when the target is an editable element or inside any grid, and for grids that are not the last
 * focused opted-in one (multi-grid tie-break — last DOM focus wins). Must be mounted inside
 * `DataGridRoot` (reads the root's container element, like `DataGridKeybindingsShortcut`); it
 * renders nothing.
 *
 * Prefer {@link DataGridGlobalShortcuts} — the component that mounts this hook.
 */
export function useDataGridGlobalShortcuts(config?: GlobalShortcutsConfig): void {
  const containerRef = useDataGridContainer();
  const storeApi = useDataGridStoreApi();
  const keymap = useDataGridKeymap();

  const enabled = useMemo(() => enabledGlobalActions(config), [config?.undo, config?.redo]);

  // the window handler reads fresh values per event without re-attaching on every keymap change
  const latestRef = useRef({ keymap, enabled });
  latestRef.current = { keymap, enabled };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const gridId = ++nextGridId;

    function onFocusIn() {
      lastFocusedGrid = gridId;
    }

    function onKeyDown(event: KeyboardEvent) {
      const latest = latestRef.current;
      const target = event.target;
      const targetIsEditable =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      const targetInAnyGrid = target instanceof Element ? target.closest('[role="grid"]') !== null : false;
      const action = resolveGlobalShortcut(event, {
        keymap: latest.keymap,
        isMac: isMacPlatform(),
        actions: latest.enabled,
        targetIsEditable,
        targetInAnyGrid,
        ownsFocus: lastFocusedGrid === gridId,
      });
      if (action === null) return;
      event.preventDefault();
      const state = storeApi.getState();
      if (action === "undo") state.onUndo?.();
      else state.onRedo?.();
    }

    container.addEventListener("focusin", onFocusIn);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("keydown", onKeyDown);
      if (lastFocusedGrid === gridId) lastFocusedGrid = null;
    };
  }, [containerRef, enabled, storeApi]);
}

/** Props for {@link DataGridGlobalShortcuts}: the action flags of {@link GlobalShortcutsConfig}. Omit both to enable every action. */
export type DataGridGlobalShortcutsProps = GlobalShortcutsConfig;

/**
 * Mounts the opt-in global-shortcut layer; renders nothing. Must sit inside `DataGridRoot`
 * (the hook reads the root's container element).
 */
export function DataGridGlobalShortcuts(props: DataGridGlobalShortcutsProps): ReactNode {
  useDataGridGlobalShortcuts(props);
  return null;
}
