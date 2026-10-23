"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import type { DataGridPlugin } from "@/registry/default/blocks/data-grid/data-grid";
import { FindReplacePanel, type PanelStore } from "./find-replace-panel";
import type { ReplaceOptions } from "./plan-replace";

export type UseDataGridFindReplaceOptions = Pick<ReplaceOptions, "scope" | "replaceAllLimit">;

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
  let options: ReplaceOptions = {};
  return {
    getOptions: () => options,
    setOptions(next) {
      options = next;
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
          label: "Find and replace",
          group: "other",
          run: (ctx) => panelStore.open(ctx.readOnly ? "find" : "replace"),
        },
        openFind: {
          label: "Find",
          group: "other",
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
