import { useEffect } from "react";
import { isDev } from "@/registry/default/blocks/data-grid/data-grid-sdk";

const mounted = new Map<string, Map<symbol, string>>();
const warned = new Set<string>();

/** Warns once per key in development when mounted grids with other columns share one `localStorage` key of the built-in storage. */
export function useWarnSharedViewsKey(key: string | undefined, columnIds: string): void {
  useEffect(() => {
    if (key === undefined || !isDev()) return;
    const token = Symbol(key);
    const instances = mounted.get(key) ?? new Map<symbol, string>();
    mounted.set(key, instances);
    instances.set(token, columnIds);
    if (!warned.has(key) && new Set(instances.values()).size > 1) {
      warned.add(key);
      console.warn(`[data-grid-views] two mounted grids with other columns share the views storage key "${key}", so each loads and overwrites the views of the other; pass each grid its own \`storage\` key`);
    }
    return () => {
      instances.delete(token);
      if (instances.size === 0) mounted.delete(key);
    };
  }, [key, columnIds]);
}
