"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import type { GlobalShortcutsConfig } from "./global-shortcuts";
import { enabledGlobalActions, isMacPlatform, resolveGlobalShortcut } from "./global-shortcuts";
import { isPrintableKey } from "./is-printable-key";
import { useDataGridContainer } from "../interaction/use-data-grid-container";
import { dispatchGridAction } from "../interaction/use-grid-interaction";
import { useDataGridRootContext } from "../layout-context";
import {
  useDataGridActions,
  useDataGridFillHandlers,
  useDataGridKeymap,
  useDataGridReadOnly,
  useDataGridStoreApi,
} from "../store";

/** Multi-grid focus owner: the id of the last opted-in grid whose container received `focusin`. */
let lastFocusedGrid: number | null = null;
let nextGridId = 0;

/**
 * While DOM focus is outside the grid, dispatches the enabled global actions (default: undo/redo)
 * on window keydown. Each action runs through the grid's own keymap-dispatch path
 * ({@link dispatchGridAction}), so it behaves exactly like its in-grid binding — same scrolling,
 * same store-side guards. Mount inside `DataGridRoot`; prefer {@link DataGridGlobalShortcuts}.
 */
export function useDataGridGlobalShortcuts(config?: GlobalShortcutsConfig): void {
  const containerRef = useDataGridContainer();
  const storeApi = useDataGridStoreApi();
  const keymap = useDataGridKeymap();
  const actions = useDataGridActions();
  const readOnly = useDataGridReadOnly();
  const fillHandlers = useDataGridFillHandlers();
  const { rowHeight, interaction } = useDataGridRootContext();

  // content-based dep (not the `config` object) so an inline config doesn't recompute per render;
  // sorted keys since the flag set is open (add-ons augment it) so no fixed list of deps works
  const configKey = config ? Object.keys(config).filter((k) => config[k as keyof GlobalShortcutsConfig]).sort().join("|") : "";
  const enabled = useMemo(
    () => enabledGlobalActions(config),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- deliberate content-based dep (configKey)
    [configKey],
  );

  // the window handler reads fresh values per event without re-attaching on every config change
  const latestRef = useRef({ keymap, enabled, actions, readOnly, fillHandlers, scrollCellIntoView: interaction.scrollCellIntoView, rowHeight });
  latestRef.current = { keymap, enabled, actions, readOnly, fillHandlers, scrollCellIntoView: interaction.scrollCellIntoView, rowHeight };

  // one id per mount: a fresh id on every effect run would drop the grid's focus ownership
  // (lastFocusedGrid would no longer match) whenever the effect re-runs
  const gridIdRef = useRef(0);
  if (gridIdRef.current === 0) gridIdRef.current = ++nextGridId;

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
      const fill = latest.fillHandlers;
      dispatchGridAction({
        action,
        actions: latest.actions,
        storeApi,
        scrollRef: containerRef,
        scrollCellIntoView: latest.scrollCellIntoView,
        rowHeight: latest.rowHeight,
        readOnly: latest.readOnly,
        triggerKey: isPrintableKey(event) ? event.key : undefined,
        preventDefault: () => event.preventDefault(),
        fillDown: fill?.fillDown,
        fillRight: fill?.fillRight,
        cancelFillDrag: fill?.cancelFillDrag,
      });
    }

    container.addEventListener("focusin", onFocusIn);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("keydown", onKeyDown);
      if (lastFocusedGrid === gridId) lastFocusedGrid = null;
    };
  }, [containerRef, storeApi]);
}

/** Props for {@link DataGridGlobalShortcuts}: the {@link GlobalShortcutsConfig} flags. Omit them all to keep the safe default (undo/redo only). */
export type DataGridGlobalShortcutsProps = GlobalShortcutsConfig;

/** Mounts the global-shortcut layer; renders nothing. Must sit inside `DataGridRoot`. */
export function DataGridGlobalShortcuts(props: DataGridGlobalShortcutsProps): ReactNode {
  useDataGridGlobalShortcuts(props);
  return null;
}
