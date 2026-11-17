type AnyFn = (...args: never[]) => unknown;
type SaveFn = (change: never, ctx: never) => unknown;

/** What a server hook registers for the `data` array it hands out: its own provider props, and a wrapper that tracks a provider `onSave`. */
export type ServerWiring = {
  props: Readonly<Record<string, unknown>>;
  wrapSave: (save: SaveFn) => SaveFn;
};

/** Each observer joins the hook's while the grid reads the matching state from the hook; `null` means always. */
const OBSERVERS = [
  ["onDataChange", null],
  ["onRenderedRowsChange", null],
  ["onSortChange", "sortState"],
  ["onFilterChange", "filterState"],
  ["onSearchTextChange", "searchText"],
] as const;

const wirings = new WeakMap<object, ServerWiring>();
const bothCache = new WeakMap<AnyFn, WeakMap<AnyFn, AnyFn>>();
const pluginCache = new WeakMap<
  readonly unknown[],
  WeakMap<readonly unknown[], readonly unknown[]>
>();
const savesCache = new WeakMap<ServerWiring, WeakMap<SaveFn, SaveFn>>();

/** Lets `applyServerWiring` find the hook that produced `data`, so a provider prop after the `gridProps` spread joins the hook's handler instead of replacing it. */
export function registerServerWiring(data: object, wiring: ServerWiring) {
  wirings.set(data, wiring);
}

function cached<K extends object, V extends object>(
  outer: WeakMap<K, WeakMap<K, V>>,
  first: K,
  second: K,
  make: () => V,
): V {
  let inner = outer.get(first);
  if (!inner) outer.set(first, (inner = new WeakMap()));
  let value = inner.get(second);
  if (!value) inner.set(second, (value = make()));
  return value;
}

const runBoth = (own: AnyFn, theirs: AnyFn): AnyFn =>
  cached(bothCache, own, theirs, () => (...args: never[]) => {
    try {
      own(...args);
    } finally {
      theirs(...args);
    }
  });

/** The hook's plugins first, then the provider's that the hook does not hold. */
const mergePlugins = (own: readonly unknown[], theirs: readonly unknown[]) =>
  cached(pluginCache, own, theirs, () => [
    ...own,
    ...theirs.filter((plugin) => !own.includes(plugin)),
  ]);

/**
 * Joins the props of a grid whose `data` came from a server hook with the hook's own handlers and plugins.
 * Observers run the hook's handler, then the provider's. `plugins` keeps the hook's first. A provider `onSave` runs in place of
 * the hook's `onSave` option and stays tracked for `refreshAfterSave`.
 */
export function applyServerWiring<T extends object>(props: T): T {
  const data = (props as { data?: unknown }).data;
  const wiring =
    typeof data === "object" && data !== null ? wirings.get(data) : undefined;
  if (!wiring) return props;
  const given = props as Record<string, unknown>;
  const own = wiring.props;
  let next: Record<string, unknown> | null = null;
  const set = (key: string, value: unknown) => {
    if (given[key] === value) return;
    next ??= { ...given };
    next[key] = value;
  };
  for (const [key, state] of OBSERVERS) {
    if (state && given[state] !== own[state]) continue;
    const hook = own[key] as AnyFn | undefined;
    const provider = given[key] as AnyFn | undefined;
    if (hook)
      set(key, provider && provider !== hook ? runBoth(hook, provider) : hook);
  }
  const hookPlugins = own["plugins"] as readonly unknown[] | undefined;
  const providerPlugins = given["plugins"] as readonly unknown[] | undefined;
  if (hookPlugins)
    set(
      "plugins",
      providerPlugins && providerPlugins !== hookPlugins
        ? mergePlugins(hookPlugins, providerPlugins)
        : hookPlugins,
    );
  const hookSave = own["onSave"] as SaveFn | undefined;
  const providerSave = given["onSave"] as SaveFn | undefined;
  if (providerSave && providerSave !== hookSave) {
    let wrapped = savesCache.get(wiring);
    if (!wrapped) savesCache.set(wiring, (wrapped = new WeakMap()));
    let tracked = wrapped.get(providerSave);
    if (!tracked)
      wrapped.set(providerSave, (tracked = wiring.wrapSave(providerSave)));
    set("onSave", tracked);
  } else if (hookSave) set("onSave", hookSave);
  return (next ?? props) as T;
}
