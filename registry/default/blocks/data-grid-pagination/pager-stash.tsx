"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { DataGridPlugin } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { DataGridPaginationControls } from "./use-data-grid-pagination";

type PagerBox = {
  pager: DataGridPaginationControls;
  listeners: Set<() => void>;
  onRead: () => void;
};

/** A server hook sets a function under this key on the stash plugin to learn that a bar read the pager. */
const PAGER_READ = Symbol.for("gridcn.pager-read");

const boxes = new WeakMap<object, PagerBox>();
const registryListeners = new Set<() => void>();

const notify = (listeners: Set<() => void>) => listeners.forEach((listener) => listener());

const subscribeRegistry = (listener: () => void) => {
  registryListeners.add(listener);
  return () => void registryListeners.delete(listener);
};

function publish(box: PagerBox, pager: DataGridPaginationControls) {
  if (box.pager === pager) return;
  box.pager = pager;
  notify(box.listeners);
}

function StashMount({ box }: { box: PagerBox }): null {
  const store = useDataGridStoreApi();
  useEffect(() => {
    boxes.set(store, box);
    notify(registryListeners);
    return () => {
      if (boxes.get(store) === box) boxes.delete(store);
      notify(registryListeners);
    };
  }, [store, box]);
  return null;
}

/** A plugin that hands `pager` to every bare `DataGridPaginationBar` under the grid that mounts it. */
export function usePagerStashPlugin(pager: DataGridPaginationControls): DataGridPlugin {
  const [{ box, plugin }] = useState(() => {
    const box: PagerBox = { pager, listeners: new Set(), onRead: () => (plugin as Record<symbol, (() => void) | undefined>)[PAGER_READ]?.() };
    const plugin: DataGridPlugin = { name: "server-pager", Mount: () => <StashMount box={box} /> };
    return { box, plugin };
  });
  useEffect(() => publish(box, pager), [box, pager]);
  return plugin;
}

/** The pager that a server hook stashed for the enclosing grid, or `null`. */
export function useStashedPager(): DataGridPaginationControls | null {
  const store = useDataGridStoreApi();
  const box = useSyncExternalStore(
    subscribeRegistry,
    () => boxes.get(store) ?? null,
    () => null,
  );
  const pager = useSyncExternalStore(
    (listener) => {
      box?.listeners.add(listener);
      return () => void box?.listeners.delete(listener);
    },
    () => box?.pager ?? null,
    () => null,
  );
  useEffect(() => box?.onRead(), [box]);
  return pager;
}
