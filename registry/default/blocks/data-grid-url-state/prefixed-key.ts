import { useEffect, useRef } from "react";
import { isDev } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** Namespaces a URL param key for multi-grid pages, e.g. `prefixedKey("orders", "sort")` => `"orders_sort"`. */
export function prefixedKey(prefix: string | undefined, key: string): string {
  return prefix ? `${prefix}_${key}` : key;
}

const mountedByScope = new Map<string, number>();

/** Warns once in development when a second mounted hook of the same kind uses the prefix: each instance applies the URL once on mount, so two grids on one key never stay linked. */
export function useWarnSharedPrefix(hook: "useDataGridUrlState" | "useDataGridUrlPagination", prefix: string | undefined): void {
  const warned = useRef(false);
  useEffect(() => {
    const scope = `${hook}:${prefix ?? ""}`;
    const others = mountedByScope.get(scope) ?? 0;
    mountedByScope.set(scope, others + 1);
    if (others > 0 && !warned.current && isDev()) {
      warned.current = true;
      console.warn(`[data-grid-url-state] two ${hook} instances use ${prefix ? `the prefix "${prefix}"` : "no prefix"}; give each grid its own prefix`);
    }
    return () => {
      const left = (mountedByScope.get(scope) ?? 1) - 1;
      if (left > 0) mountedByScope.set(scope, left);
      else mountedByScope.delete(scope);
    };
  }, [hook, prefix]);
}
