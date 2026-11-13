import { warnDev } from "../store/commit";

const MAX_FORMATTERS = 1000;
const MAX_WARNINGS = 100;

/**
 * Caches `Intl` formatters by key. A key whose constructor threw caches `null`, so the cell falls
 * back without a second construction, and warns once; the warned keys never clear, so a hostile
 * stream of formats stops warning at the bound.
 */
export function createFormatterCache<T>(failureMessage: string) {
  const formatters = new Map<string, T | null>();
  const warned = new Set<string>();
  return (key: string, build: () => T): T | null => {
    const cached = formatters.get(key);
    if (cached !== undefined) return cached;
    if (formatters.size >= MAX_FORMATTERS) formatters.clear();
    let formatter: T | null = null;
    try {
      formatter = build();
    } catch (error) {
      // engines differ on the thrown type (V8/Node: RangeError for a bad locale or timeZone, TypeError for a bad option)
      if ((error instanceof RangeError || error instanceof TypeError) && warned.size < MAX_WARNINGS && !warned.has(key)) {
        warned.add(key);
        warnDev(`${failureMessage}: ${error.message}`);
      }
    }
    formatters.set(key, formatter);
    return formatter;
  };
}
