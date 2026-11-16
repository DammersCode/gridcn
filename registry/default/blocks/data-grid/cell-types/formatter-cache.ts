import { warnDev } from "../store/commit";

const MAX_FORMATTERS = 1000;
const MAX_WARNINGS = 100;

const serialized = new WeakMap<object, string>();
const UNSERIALIZABLE_KEY = "<unserializable>";

/** Content key of an options object, serialized once per object so a stable options object costs a lookup per call. An object JSON cannot serialize (cyclic, `BigInt`) gets a sentinel key that the cache resolves to `null`. */
export function formatKey(options: object): string {
  if (typeof options !== "object" || options === null) return JSON.stringify(options);
  let key = serialized.get(options);
  if (key === undefined) {
    try {
      key = JSON.stringify(options);
    } catch {
      key = UNSERIALIZABLE_KEY;
    }
    serialized.set(options, key);
  }
  return key;
}

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
    let reason: string | null = null;
    if (key.endsWith(UNSERIALIZABLE_KEY)) reason = "the format cannot be serialized to JSON";
    else {
      try {
        formatter = build();
      } catch (error) {
        // engines differ on the thrown type (V8/Node: RangeError for a bad locale or timeZone, TypeError for a bad option)
        if (error instanceof RangeError || error instanceof TypeError) reason = error.message;
      }
    }
    if (reason !== null && warned.size < MAX_WARNINGS && !warned.has(key)) {
      warned.add(key);
      warnDev(`${failureMessage}: ${reason}`);
    }
    formatters.set(key, formatter);
    return formatter;
  };
}

const warnedLocaleOnly = new Set<string>();

/** Dev-warns once per type and locale when `locale` is set but the format option that gives it effect is not. */
export function warnLocaleWithoutFormat(type: "number" | "date", locale: string): void {
  const key = `${type}|${locale}`;
  if (warnedLocaleOnly.size >= MAX_WARNINGS || warnedLocaleOnly.has(key)) return;
  warnedLocaleOnly.add(key);
  const [formatOption, example] = type === "number" ? ["format", "format: {}"] : ["displayFormat", "displayFormat: { dateStyle: \"medium\" }"];
  warnDev(`${type} column sets locale "${locale}" without ${formatOption}, so the locale has no effect; set ${example}`);
}
