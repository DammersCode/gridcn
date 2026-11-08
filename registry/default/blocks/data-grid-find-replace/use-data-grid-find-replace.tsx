"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import type { DataGridPlugin } from "@/registry/default/blocks/data-grid/data-grid";
import { FindReplacePanel, type PanelStore } from "./find-replace-panel";
import type { PanelOptions } from "./find-replace-panel";
import type { ReplaceOptions } from "./plan-replace";

export type UseDataGridFindReplaceOptions = Pick<ReplaceOptions, "scope" | "replaceAllLimit"> & {
  /**
   * Runs after the plan is built and before it is written. Return the plan to write (it may add, drop, or
   * change patches), or `false` to cancel. The returned plan may hold at most `replaceAllLimit` patches;
   * more cancels the replace. Each patch still goes through the column's `fromText` and `validate`.
   * `signal` aborts when a newer replace starts or the panel closes; a late answer is dropped.
   */
  processReplace?: PanelOptions["processReplace"];
  /** Merged into the class list of the panel root. */
  className?: string;
};

export type UseDataGridFindReplaceResult = {
  /** One entry of the grid's `plugins` prop: the panel, the `openFindReplace` and `openFind` commands, and their `ctrl+h` and `mod+f` bindings. */
  plugin: DataGridPlugin<unknown>;
  /** Opens the panel; `"replace"` (default) shows the Replace field, `"find"` hides it until the user expands it. */
  open: (mode?: "find" | "replace") => void;
  close: () => void;
};

function createPanelStore(): PanelStore {
  const listeners = new Set<() => void>();
  let state = { open: false, mode: "replace" as "find" | "replace", openCount: 0 };
  let options: PanelOptions = {};
  return {
    getOptions: () => options,
    setOptions(next) {
      const classNameChanged = options.className !== next.className;
      options = next;
      if (!classNameChanged) return;
      state = { ...state };
      listeners.forEach((listener) => listener());
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open(mode) {
      state = { open: true, mode, openCount: state.openCount + 1 };
      listeners.forEach((listener) => listener());
    },
    setMode(mode) {
      if (!state.open || state.mode === mode) return;
      state = { ...state, mode };
      listeners.forEach((listener) => listener());
    },
    close() {
      if (!state.open) return;
      state = { ...state, open: false };
      listeners.forEach((listener) => listener());
    },
  };
}

/**
 * Find and replace for a grid: a panel with Find and Replace fields that shares the quick search
 * (highlights, next/previous) and writes through each column's text codec as one undoable change.
 * Pass `plugin` in the grid's `plugins`; `ctrl+h` opens it with Replace and `mod+f` opens it with Find only.
 */
export function useDataGridFindReplace(options: UseDataGridFindReplaceOptions = {}): UseDataGridFindReplaceResult {
  const [panelStore] = useState(createPanelStore);
  useEffect(() => {
    panelStore.setOptions(options);
  });

  const plugin = useMemo<DataGridPlugin<unknown>>(() => {
    const Mount: ComponentType = function FindReplaceMount() {
      return <FindReplacePanel panelStore={panelStore} />;
    };
    return {
      name: "find-replace",
      Mount,
      commands: {
        openFindReplace: {
          run: (ctx) => panelStore.open(ctx.readOnly ? "find" : "replace"),
        },
        openFind: {
          run: () => panelStore.open("find"),
        },
      },
      keymap: { openFindReplace: ["ctrl+h"], openFind: ["mod+f"] },
    };
  }, [panelStore]);

  return useMemo(
    () => ({ plugin, open: (mode = "replace") => panelStore.open(mode), close: () => panelStore.close() }),
    [plugin, panelStore],
  );
}
