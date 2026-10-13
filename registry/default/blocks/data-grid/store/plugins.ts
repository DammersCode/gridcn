import type { GridAction, Keymap } from "../types";
import type { DataGridPlugin, GridCommand } from "../types";
import { BUILTIN_ACTIONS, DEFAULT_KEYMAP, PLUGGABLE_ACTIONS } from "../keyboard";
import type {
  ResolvedBandSegment,
  ResolvedPluginMount,
  ResolvedPluginOverlay,
  ResolvedPlugins,
  PluginDataChangeObserver,
} from "./types";

/** The shared empty identity: a grid with no plugins never allocates a fresh resolved object per config sync. */
export const EMPTY_PLUGINS: ResolvedPlugins = {
  list: [],
  overlays: [],
  bands: { top: [], bottom: [] },
  mounts: [],
  observers: [],
};

/** A dev warning that fires at most once per key per store (resolution re-runs on list changes; a static conflict must not re-warn per change). */
export type PluginWarnOnce = (key: string, message: string) => void;

/**
 * Whether two `plugins` props resolve to the same plugins: same length, the same `name` per entry,
 * and every member (`Overlay`, `rowBands`, `onDataChange`, `commands`, `keymap`, `Mount`) kept its
 * identity. An equal list reuses `state.plugins` (and the merged `commands`/`keymap`), so an
 * inline `plugins={[fill.plugin, …]}` array with stable members changes nothing.
 */
export function pluginsListEqual(a: readonly DataGridPlugin[] | undefined, b: readonly DataGridPlugin[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const pa = a[i]!;
    const pb = b[i]!;
    if (pa.name !== pb.name || pa.Overlay !== pb.Overlay || pa.rowBands !== pb.rowBands || pa.onDataChange !== pb.onDataChange) {
      return false;
    }
    if (pa.commands !== pb.commands || pa.keymap !== pb.keymap || pa.Mount !== pb.Mount) return false;
  }
  return true;
}

/** plugin object -> the store that resolved it first; a plugin instance attaches to ONE grid. */
const pluginAttachments = new WeakMap<object, object>();

/**
 * Records which store owns each plugin object and drops the ones another live grid already
 * resolved (the first grid keeps them; the second grid's resolution skips them, dev-errored).
 * Returns the input list unchanged when nothing was dropped.
 */
export function claimPluginAttachments(list: readonly DataGridPlugin[], store: object, warn: PluginWarnOnce): readonly DataGridPlugin[] {
  let claimed: DataGridPlugin[] | null = null;
  for (const plugin of list) {
    const owner = pluginAttachments.get(plugin);
    if (owner === undefined) {
      pluginAttachments.set(plugin, store);
    } else if (owner !== store) {
      if (!claimed) claimed = list.slice(0, list.indexOf(plugin));
      warn(
        `attach:${plugin.name}`,
        `plugin "${plugin.name}" is already attached to another grid; a plugin instance attaches to one grid — pass a fresh plugin object (the add-on hook's result) to each grid`,
      );
      continue;
    }
  }
  return claimed ?? list;
}

/**
 * Dev-warns once per plugin whose `Overlay` or `Mount` identity changed between `oldList` and
 * `newList` (same `name`): the new component identity remounts the component and loses its state.
 */
export function warnPluginComponentRemounts(
  oldList: readonly DataGridPlugin[],
  newList: readonly DataGridPlugin[],
  warn: PluginWarnOnce,
): void {
  for (const next of newList) {
    const prev = oldList.find((p) => p.name === next.name);
    if (!prev) continue;
    if (prev.Overlay !== undefined && prev.Overlay !== next.Overlay) {
      warn(`remount-overlay:${next.name}`, `plugin "${next.name}"'s Overlay component identity changed; the overlay remounts and loses its state`);
    }
    if (prev.Mount !== undefined && prev.Mount !== next.Mount) {
      warn(`remount-mount:${next.name}`, `plugin "${next.name}"'s Mount component identity changed; the mount remounts and loses its state`);
    }
  }
}

/**
 * Builds the resolved plugin members from the claimed list (duplicate `name`s dev-error and the
 * later plugin is ignored; members keep array order). Runs only when the list actually changes, so
 * the conflict warnings below do not re-fire on every render of an unchanged inline array.
 */
export function resolvePlugins(list: readonly DataGridPlugin[], warn: PluginWarnOnce): ResolvedPlugins {
  if (list.length === 0) return EMPTY_PLUGINS;
  const seen = new Set<string>();
  const unique: DataGridPlugin[] = [];
  for (const plugin of list) {
    if (seen.has(plugin.name)) {
      warn(
        `name:${plugin.name}`,
        `two plugins named "${plugin.name}"; the later one is ignored — the name is the plugin's React key and its identity`,
      );
      continue;
    }
    seen.add(plugin.name);
    unique.push(plugin);
  }
  const overlays: ResolvedPluginOverlay[] = [];
  const mounts: ResolvedPluginMount[] = [];
  const observers: PluginDataChangeObserver[] = [];
  const bands = { top: [] as ResolvedBandSegment[], bottom: [] as ResolvedBandSegment[] };
  for (const plugin of unique) {
    if (plugin.Overlay) overlays.push({ name: plugin.name, Overlay: plugin.Overlay });
    if (plugin.Mount) mounts.push({ name: plugin.name, Mount: plugin.Mount });
    if (plugin.onDataChange) observers.push(plugin.onDataChange);
    if (plugin.rowBands) {
      const { top, bottom, render } = plugin.rowBands;
      if (top && top.length > 0) bands.top.push({ name: plugin.name, rows: top, render });
      if (bottom && bottom.length > 0) bands.bottom.push({ name: plugin.name, rows: bottom, render });
    }
  }
  return { list, overlays, bands, mounts, observers };
}

/**
 * The merged command map: the plugins' commands in array order (the later plugin wins a name
 * conflict, dev-warned; a built-in action name is dropped, dev-warned, unless pluggable), then the
 * consumer's `commands` over everything (the app owner's explicit choice, silently). `null` when
 * nothing lands.
 */
export function mergePluginCommands(
  plugins: readonly DataGridPlugin[],
  consumerCommands: Record<string, GridCommand<unknown>> | null | undefined,
  warn: PluginWarnOnce,
): Record<string, GridCommand<unknown>> | null {
  const merged: Record<string, GridCommand<unknown>> = {};
  const sourceOf: Record<string, string> = {};
  for (const plugin of plugins) {
    if (!plugin.commands) continue;
    for (const [name, command] of Object.entries(plugin.commands)) {
      const builtin = (BUILTIN_ACTIONS as readonly string[]).includes(name);
      if (builtin && !PLUGGABLE_ACTIONS.includes(name)) {
        warn(
          `cmd-builtin:${plugin.name}:${name}`,
          `plugin "${plugin.name}"'s command "${name}" names a built-in action and is dropped — plugins cannot replace core behavior (undo, redo, fillDown, fillRight are the pluggable exceptions)`,
        );
        continue;
      }
      const prior = sourceOf[name];
      if (prior !== undefined) {
        warn(`cmd-conflict:${name}:${prior}:${plugin.name}`, `plugins "${prior}" and "${plugin.name}" both define command "${name}"; the later plugin wins`);
      }
      merged[name] = command;
      sourceOf[name] = plugin.name;
    }
  }
  if (consumerCommands) Object.assign(merged, consumerCommands);
  return Object.keys(merged).length > 0 ? merged : null;
}

/**
 * The merged keymap: `DEFAULT_KEYMAP` <- the plugins' keymaps (array order; an entry naming a
 * command the plugin does not define, or naming no built-in action, is dropped, dev-warned; a
 * binding the default keymap or the consumer's `keymap` already uses is dropped, dev-warned) <- the
 * consumer's `keymap` (always last, and wins).
 */
export function mergePluginKeymaps(
  plugins: readonly DataGridPlugin[],
  consumerKeymap: Keymap | undefined,
  warn: PluginWarnOnce,
): Keymap {
  const merged: Keymap = { ...DEFAULT_KEYMAP };
  for (const plugin of plugins) {
    if (!plugin.keymap) continue;
    for (const [name, bindings] of Object.entries(plugin.keymap)) {
      const pluginOwnsIt = Boolean(plugin.commands) && name in (plugin.commands as Record<string, GridCommand<unknown>>);
      if (!(BUILTIN_ACTIONS as readonly string[]).includes(name) || !pluginOwnsIt) {
        warn(
          `keymap-unknown:${plugin.name}:${name}`,
          `plugin "${plugin.name}"'s keymap binds "${name}" but the plugin defines no such command; the entry is dropped — a plugin keymap binds the plugin's own commands only`,
        );
        continue;
      }
      const taken = [...(DEFAULT_KEYMAP[name as GridAction] ?? []), ...(consumerKeymap?.[name as GridAction] ?? [])];
      const kept = (bindings ?? []).filter((binding) => !taken.includes(binding));
      if (kept.length < (bindings ?? []).length) {
        warn(
          `keymap-collide:${plugin.name}:${name}`,
          `plugin "${plugin.name}"'s binding for "${name}" uses a key the grid's default keymap or the consumer's keymap already owns; the colliding binding is dropped — a plugin never takes a key the grid or the app already uses`,
        );
      }
      if (kept.length > 0) merged[name as GridAction] = kept;
    }
  }
  if (consumerKeymap) Object.assign(merged, consumerKeymap);
  return merged;
}

/** Claim + resolve one grid's plugin list; an absent list is the shared empty identity. */
export function resolvePluginsList(
  list: readonly DataGridPlugin[] | undefined,
  store: object,
  warn: PluginWarnOnce,
): ResolvedPlugins {
  if (!list || list.length === 0) return EMPTY_PLUGINS;
  return resolvePlugins(claimPluginAttachments(list, store, warn), warn);
}
