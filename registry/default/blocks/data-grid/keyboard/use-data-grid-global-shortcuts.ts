"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import type { GlobalShortcutsConfig } from "./global-shortcuts";
import { bareGlobalBindings, enabledGlobalActions, globalShortcutsConfigKey, isMacPlatform, resolveGlobalShortcut } from "./global-shortcuts";
import { isDev } from "../is-dev";
import { GRID_ROLE_SELECTOR } from "../data-attributes";
import { isPrintableKey } from "./is-printable-key";
import { useDataGridContainer } from "../interaction/use-data-grid-container";
import {
  useDataGridKeymap,
  useDataGridStoreApi,
} from "../store";

/** Multi-grid focus owner: the id of the last opted-in grid whose container received `focusin`. */
let lastFocusedGrid: number | null = null;
let nextGridId = 0;
const POPUP_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/**
 * While DOM focus is outside the grid, dispatches the enabled global actions (default: undo/redo)
 * on window keydown, in the capture phase: a page listener, registered before or after the grid, sees `defaultPrevented` once the grid handled the key. Each action runs through `api.runShortcut`, so it behaves exactly like its in-grid binding — same scrolling,
 * same store-side guards. Mount inside `DataGridRoot`; prefer {@link DataGridGlobalShortcuts}.
 */
export function useDataGridGlobalShortcuts(config?: GlobalShortcutsConfig): void {
  const containerRef = useDataGridContainer();
  const storeApi = useDataGridStoreApi();
  const keymap = useDataGridKeymap();

  // content-based dep (not the `config` object) so an inline config doesn't recompute per render;
  // sorted keys since the flag set is open (add-ons augment it) so no fixed list of deps works
  const configKey = globalShortcutsConfigKey(config);
  const enabled = useMemo(
    () => enabledGlobalActions(config),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- deliberate content-based dep (configKey)
    [configKey],
  );

  // the window handler reads fresh values per event without re-attaching on every config change
  const latestRef = useRef({ keymap, enabled });
  latestRef.current = { keymap, enabled };

  // one id per mount: a fresh id on every effect run would drop the grid's focus ownership
  // (lastFocusedGrid would no longer match) whenever the effect re-runs
  const gridIdRef = useRef(0);
  if (gridIdRef.current === 0) gridIdRef.current = ++nextGridId;

  const bareBindings = bareGlobalBindings(keymap, enabled).join(", ");
  const warnedRef = useRef(false);
  useEffect(() => {
    if (!bareBindings || warnedRef.current || !isDev()) return;
    warnedRef.current = true;
    console.warn(
      `[data-grid] global shortcut binding(s) without Ctrl/Cmd never fire outside the grid (${bareBindings}); add mod+ to the binding or handle the key in your own window listener`,
    );
  }, [bareBindings]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const gridId = gridIdRef.current;

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
      const targetInAnyGrid = target instanceof Element ? target.closest(GRID_ROLE_SELECTOR) !== null : false;
      const targetInPopup = target instanceof Element ? target.closest(POPUP_SELECTOR) !== null : false;
      const action = resolveGlobalShortcut(event, {
        keymap: latest.keymap,
        isMac: isMacPlatform(),
        actions: latest.enabled,
        targetIsEditable,
        targetInAnyGrid,
        targetInPopup,
        ownsFocus: lastFocusedGrid === gridId,
        editing: storeApi.getState().editing !== null,
        include: (a) => storeApi.getState().commands?.[a]?.scope !== "editing",
      });
      if (action === null) return;
      storeApi.getState().runShortcutImpl?.(action, {
        triggerKey: isPrintableKey({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey, altGraph: event.getModifierState?.("AltGraph") }, isMacPlatform()) ? event.key : undefined,
        preventDefault: () => event.preventDefault(),
      });
    }

    container.addEventListener("focusin", onFocusIn);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      container.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("keydown", onKeyDown, true);
      if (lastFocusedGrid === gridId) lastFocusedGrid = null;
    };
  }, [containerRef, storeApi]);
}

/** Props for {@link DataGridGlobalShortcuts}: the {@link GlobalShortcutsConfig} flags. `undo` and `redo` default to `true`, every other flag to `false`. */
export type DataGridGlobalShortcutsProps = GlobalShortcutsConfig;

/** Mounts the global-shortcut layer; renders nothing. Must sit inside `DataGridRoot`. The layer acts only after this grid received focus once; with several such grids, the last focused one owns the keys. */
export function DataGridGlobalShortcuts(props: DataGridGlobalShortcutsProps): ReactNode {
  useDataGridGlobalShortcuts(props);
  return null;
}
