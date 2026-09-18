/** Namespaces a URL param key for multi-grid pages, e.g. `prefixedKey("orders", "sort")` => `"orders_sort"`. */
export function prefixedKey(prefix: string | undefined, key: string): string {
  return prefix ? `${prefix}_${key}` : key;
}
