import { isDev } from "../is-dev";

export const DEFAULT_SORT_LOCALE = "en-US";
const MAX_CACHED_LOCALES = 20;

type Collators = { base: Intl.Collator; variant: Intl.Collator };

const cache = new Map<string, Collators>();
const warned = new Set<string>();
let activeLocale = DEFAULT_SORT_LOCALE;

function buildCollators(locale: string): Collators {
  return {
    base: new Intl.Collator([locale, DEFAULT_SORT_LOCALE], { numeric: true, sensitivity: "base" }),
    variant: new Intl.Collator([locale, DEFAULT_SORT_LOCALE]),
  };
}

function warnOnce(locale: string, message: string) {
  if (isDev() && warned.size < MAX_CACHED_LOCALES && !warned.has(locale)) {
    warned.add(locale);
    console.warn(message);
  }
}

function collatorsFor(locale: string): Collators {
  const cached = cache.get(locale);
  if (cached) return cached;
  let built: Collators;
  try {
    built = buildCollators(locale);
    if (Intl.Collator.supportedLocalesOf(locale).length === 0) {
      warnOnce(locale, `[data-grid] sortLocale "${locale}" is not supported by this runtime. The grid sorts with "${DEFAULT_SORT_LOCALE}".`);
    }
  } catch {
    warnOnce(locale, `[data-grid] sortLocale "${locale}" is not a valid language tag. The grid sorts with "${DEFAULT_SORT_LOCALE}".`);
    built = collatorsFor(DEFAULT_SORT_LOCALE);
  }
  if (cache.size >= MAX_CACHED_LOCALES) cache.delete(cache.keys().next().value as string);
  cache.set(locale, built);
  return built;
}

let warnedThenable = false;

/** Runs `run` with `locale` as the sort locale of every built-in text compare. The scope ends when `run` returns, so the callback must be synchronous: work after an `await` sorts with "en-US". Grids with different locales never mix. */
export function withSortLocale<T>(locale: string | undefined, run: () => T): T {
  const previous = activeLocale;
  activeLocale = locale ?? DEFAULT_SORT_LOCALE;
  try {
    const result = run();
    if (isDev() && !warnedThenable && typeof (result as { then?: unknown } | null)?.then === "function") {
      warnedThenable = true;
      console.warn("[data-grid] withSortLocale received a promise. The sort locale scope ends when the callback returns, so work after an await sorts with the default locale. Pass a synchronous callback.");
    }
    return result;
  } finally {
    activeLocale = previous;
  }
}

/** Numeric, case- and accent-insensitive collator for the sort locale in scope. */
export function sortCollator(): Intl.Collator {
  return collatorsFor(activeLocale).base;
}

/** Plain collator (case and accents distinguish) for the sort locale in scope; the `text` cell type uses it. */
export function variantSortCollator(): Intl.Collator {
  return collatorsFor(activeLocale).variant;
}
