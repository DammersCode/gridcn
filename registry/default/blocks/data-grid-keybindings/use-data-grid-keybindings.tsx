"use client";

import { useMemo, useState, useSyncExternalStore, type ComponentType } from "react";
import type { DataGridPlugin } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridKeybindingsDialog } from "./keybindings-dialog";

export type UseDataGridKeybindingsOptions = {
  /** Merged into the root of the dialog. */
  className?: string;
};

export type UseDataGridKeybindingsResult = {
  /** One entry of the grid's `plugins`: the dialog, the `openKeybindings` command, and its `?` binding. */
  plugin: DataGridPlugin<unknown>;
  open: () => void;
  close: () => void;
};

type OpenStore = {
  get: () => boolean;
  set: (open: boolean) => void;
  subscribe: (listener: () => void) => () => void;
};

function createOpenStore(): OpenStore {
  const listeners = new Set<() => void>();
  let isOpen = false;
  return {
    get: () => isOpen,
    set(next) {
      if (next === isOpen) return;
      isOpen = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function KeybindingsMount({ store, className }: { store: OpenStore; className?: string }) {
  const open = useSyncExternalStore(store.subscribe, store.get, store.get);
  return <DataGridKeybindingsDialog open={open} onOpenChange={store.set} className={className} />;
}

/**
 * A dialog that lists the grid's effective keymap. Pass `plugin` in the grid's `plugins`; `?`
 * opens the dialog, and `keymap={{ openKeybindings: [...] }}` rebinds or (with `[]`) removes the key.
 */
export function useDataGridKeybindings(options: UseDataGridKeybindingsOptions = {}): UseDataGridKeybindingsResult {
  const [store] = useState(createOpenStore);
  const { className } = options;

  const plugin = useMemo<DataGridPlugin<unknown>>(() => {
    const Mount: ComponentType = () => <KeybindingsMount store={store} className={className} />;
    return {
      name: "keybindings",
      Mount,
      commands: { openKeybindings: { run: () => store.set(true), group: "other" } },
      keymap: { openKeybindings: ["?"] },
    };
  }, [store, className]);

  return useMemo(() => ({ plugin, open: () => store.set(true), close: () => store.set(false) }), [plugin, store]);
}
