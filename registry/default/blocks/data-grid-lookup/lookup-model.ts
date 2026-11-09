import { toSafeText } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** One choice a server offers: `value` is the stored key, `label` the text the user sees. */
export type LookupOption = { value: string; label: string };

/** A lookup cell stores the picked option, or `null` when empty. A bare string is a key without a label (unresolved). */
export type LookupValue = LookupOption | string | null;

/** What `fetchOptions` receives. */
export type LookupFetchRequest = {
  /** The text the user typed; `""` asks for the default list. */
  query: string;
  /** Aborted when the user types again, closes the editor, or the cell unmounts. */
  signal: AbortSignal;
};

/** Text the editor shows; each field falls back to English. */
export type LookupLabels = {
  searching: string;
  noResults: string;
  error: string;
  retry: string;
  /** Receives the missing character count. */
  typeMore: (missing: number) => string;
};

/** Column `options` of the `lookup` cell type. */
export type LookupOptions = {
  /** Resolves the options that match `query`. Keep its identity stable: pasted labels resolve through a cache keyed on it. */
  fetchOptions: (request: LookupFetchRequest) => Promise<readonly LookupOption[]>;
  /** Wait after the last keystroke before a request starts. Default: the grid's `inputDebounceMs`. */
  debounceMs?: number;
  /** Fewest typed characters that start a request. Default `0`: the default list loads on open. */
  minQueryLength?: number;
  /** Most options shown; extra options are dropped. Default `50`, at most `200`. */
  maxResults?: number;
  /** A pasted or imported text that matches no known option: `"clear"` empties the cell, `"keep"` stores the trimmed text as `{ value: text, label: "" }`, shown as unresolved. Default `"clear"`. */
  unresolvedPaste?: "clear" | "keep";
  labels?: Partial<LookupLabels>;
};

export const DEFAULT_MAX_RESULTS = 50;
export const MAX_RESULTS_LIMIT = 200;
export const MAX_LOOKUP_TEXT = 256;
const MAX_KNOWN_LABELS = 5000;

export const DEFAULT_LABELS: LookupLabels = {
  searching: "Searching…",
  noResults: "No results",
  error: "Could not load options",
  retry: "Retry",
  typeMore: (missing) => `Type ${missing} more character${missing === 1 ? "" : "s"}`,
};

function clip(text: string): string {
  return text.length > MAX_LOOKUP_TEXT ? text.slice(0, MAX_LOOKUP_TEXT) : text;
}

/** Reads any stored value as an option: a bare key stays visible as its own label (an unresolved value). */
export function readLookup(value: unknown): LookupOption | null {
  if (value == null) return null;
  if (typeof value === "object" && value !== null) {
    const raw = value as { value?: unknown; label?: unknown };
    if (typeof raw.value === "string" && raw.value !== "" && typeof raw.label === "string" && raw.label !== "" && raw.value.length <= MAX_LOOKUP_TEXT && raw.label.length <= MAX_LOOKUP_TEXT) {
      return value as LookupOption;
    }
  }
  if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) {
    const text = clip(toSafeText(value));
    return text === "" ? null : { value: text, label: text };
  }
  if (typeof value !== "object") return null;
  const raw = value as { value?: unknown; label?: unknown };
  if (typeof raw.value !== "string" && !(typeof raw.value === "number" && Number.isFinite(raw.value))) return null;
  const key = clip(toSafeText(raw.value));
  if (key === "") return null;
  const label = typeof raw.label === "string" && raw.label !== "" ? clip(raw.label) : key;
  return { value: key, label };
}

/** True when the stored value carries no label of its own. */
export function isUnresolved(value: unknown): boolean {
  if (readLookup(value) === null) return false;
  if (typeof value !== "object" || value === null) return true;
  const label = (value as { label?: unknown }).label;
  return typeof label !== "string" || label === "";
}

/** Keeps at most `limit` well-formed options from an untrusted answer; the first of a repeated value wins. */
export function sanitizeOptions(answer: unknown, limit: number | undefined): LookupOption[] {
  if (!Array.isArray(answer)) throw new TypeError("fetchOptions must resolve an array of { value, label }");
  const max = Math.min(Math.max(1, Math.floor(limit ?? DEFAULT_MAX_RESULTS) || DEFAULT_MAX_RESULTS), MAX_RESULTS_LIMIT);
  const seen = new Set<string>();
  const out: LookupOption[] = [];
  for (const item of answer) {
    if (out.length >= max) break;
    if (typeof item !== "object" || item === null) continue;
    const { value, label } = item as { value?: unknown; label?: unknown };
    if ((typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) || typeof label !== "string") continue;
    const key = clip(toSafeText(value));
    if (key === "") continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ value: key, label: label === "" ? key : clip(label) });
  }
  return out;
}

type KnownOptions = { byLabel: Map<string, LookupOption | null>; byValue: Map<string, LookupOption> };
const known = new WeakMap<object, KnownOptions>();

function dropOldest<T>(map: Map<string, T>): void {
  if (map.size > MAX_KNOWN_LABELS) map.delete(map.keys().next().value as string);
}

/** Remembers an option so a copied label pastes back to its key. Bounded: the oldest entry leaves first. */
export function rememberOption(owner: object, option: LookupOption): void {
  let index = known.get(owner);
  if (!index) {
    index = { byLabel: new Map(), byValue: new Map() };
    known.set(owner, index);
  }
  const labelKey = option.label.toLowerCase();
  const same = index.byLabel.get(labelKey);
  index.byLabel.delete(labelKey);
  // a label shared by two keys is ambiguous and resolves to nothing
  index.byLabel.set(labelKey, same === null || (same && same.value !== option.value) ? null : option);
  index.byValue.delete(option.value);
  index.byValue.set(option.value, option);
  dropOldest(index.byLabel);
  dropOldest(index.byValue);
}

/** The remembered option whose label (case-insensitive) or key equals `text`. */
export function recallOption(owner: object, text: string): LookupOption | undefined {
  const index = known.get(owner);
  const byLabel = index?.byLabel.get(text.toLowerCase());
  return byLabel === null ? index?.byValue.get(text) : (byLabel ?? index?.byValue.get(text));
}
