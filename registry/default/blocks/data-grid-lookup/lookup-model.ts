import { toSafeText } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** One choice a server offers: `value` is the stored key, `label` the text the user sees. */
export type LookupOption = { value: string; label: string };

/** A lookup cell stores the picked option, or `null` when empty. A bare string is a key without a label (unresolved). */
export type LookupValue = LookupOption | string | null;

/** What `fetchOptions` receives. `TData` is the row type of the grid. */
export type LookupFetchRequest<TData = unknown> = {
  /** The text the user typed; `""` asks for the default list. */
  query: string;
  /** Aborted when the user types again, closes the editor, or the cell unmounts. */
  signal: AbortSignal;
  /** The row being edited, so a dependent lookup can narrow its options. The request does not repeat when a push changes the row during the edit. */
  row: TData;
  /** The id of the row being edited. */
  rowId: string;
  /** The id of the lookup column. */
  columnId: string;
};

/** What `resolveLabels` receives. */
export type LookupResolveRequest = {
  /** The distinct pasted texts that no remembered option matches, trimmed. */
  labels: readonly string[];
  /** Aborted when a newer paste supersedes this one. */
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

/** Column `options` of the `lookup` cell type. `TData` is the row type of the grid; it types `request.row`. */
export type LookupOptions<TData = unknown> = {
  /** Resolves the options that match `query`. The labels it lists, and the labels the cells show, paste back to their keys. */
  fetchOptions: (request: LookupFetchRequest<TData>) => Promise<readonly LookupOption[]>;
  /**
   * Resolves pasted labels that no option listed, cell showed, or copy wrote yet: answer the options that match `labels` (exact label, case-insensitive; or key).
   * A paste calls it once with the distinct unknown labels, held as the `resolveTexts` gate. Labels it does not answer follow `unresolvedPaste`.
   */
  resolveLabels?: (request: LookupResolveRequest) => Promise<readonly LookupOption[]>;
  /** Wait after the last keystroke before a request starts. Default: the grid's `inputDebounceMs`. */
  debounceMs?: number;
  /** Fewest typed characters that start a request. Default `0`: the default list loads on open. */
  minQueryLength?: number;
  /** Most options shown; extra options are dropped. Default `50`, at most `200`. */
  maxResults?: number;
  /** A pasted or imported text that matches no known option: `"reject"` keeps the cell value and reports the text to `onValidationError`, `"clear"` empties the cell, `"keep"` stores the trimmed text as `{ value: text, label: "" }`, shown as unresolved. Default `"reject"`. */
  unresolvedPaste?: "reject" | "clear" | "keep";
  /** Remembered labels drop when this value changes (a new tenant, a renamed record set). Default: labels stay for the life of the grid. */
  labelCacheKey?: string | number;
  labels?: Partial<LookupLabels>;
};

export const DEFAULT_MAX_RESULTS = 50;
export const MAX_RESULTS_LIMIT = 200;
export const MAX_LOOKUP_TEXT = 256;
export const MAX_KNOWN_LABELS = 5000;

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
export function sanitizeOptions(answer: unknown, limit: number | undefined, ceiling = MAX_RESULTS_LIMIT): LookupOption[] {
  if (!Array.isArray(answer)) throw new TypeError("fetchOptions must resolve an array of { value, label }");
  const max = Math.min(Math.max(1, Math.floor(limit ?? DEFAULT_MAX_RESULTS) || DEFAULT_MAX_RESULTS), ceiling);
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
  // runs on every render of a shown cell, the scroll hot path
  if (index.byValue.get(option.value)?.label === option.label && index.byLabel.has(labelKey)) return;
  const same = index.byLabel.get(labelKey);
  index.byLabel.delete(labelKey);
  // a label shared by two keys is ambiguous and resolves to nothing
  index.byLabel.set(labelKey, same === null || (same && same.value !== option.value) ? null : option);
  index.byValue.delete(option.value);
  index.byValue.set(option.value, option);
  dropOldest(index.byLabel);
  dropOldest(index.byValue);
}

type ColumnOwner = { owner: object; cacheKey: unknown };
const columnOwners = new WeakMap<object, Map<string, ColumnOwner>>();

/** Carries the options remembered for a column of one grid over to its next `fetchOptions` identity, so an inline function keeps its labels. A changed `cacheKey` drops them instead. */
export function adoptOwner(grid: object, columnId: string, owner: object, cacheKey?: unknown): void {
  let owners = columnOwners.get(grid);
  if (!owners) {
    owners = new Map();
    columnOwners.set(grid, owners);
  }
  const previous = owners.get(columnId);
  if (previous?.owner === owner && Object.is(previous.cacheKey, cacheKey)) return;
  owners.set(columnId, { owner, cacheKey });
  if (previous && !Object.is(previous.cacheKey, cacheKey)) {
    known.delete(previous.owner);
    known.delete(owner);
    return;
  }
  const inherited = previous && known.get(previous.owner);
  if (!inherited) return;
  const own = known.get(owner);
  if (!own) known.set(owner, inherited);
  else if (own !== inherited) for (const option of inherited.byValue.values()) if (!own.byValue.has(option.value)) rememberOption(owner, option);
}

/** The remembered option whose label (case-insensitive) or key equals `text`. */
export function recallOption(owner: object, text: string): LookupOption | undefined {
  const index = known.get(owner);
  const byLabel = index?.byLabel.get(text.toLowerCase());
  return byLabel === null ? index?.byValue.get(text) : (byLabel ?? index?.byValue.get(text));
}
