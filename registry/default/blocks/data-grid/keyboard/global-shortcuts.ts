import type { GridAction, Keymap } from "../types";
import { isComposingKey } from "../interaction/is-composing-key";
import { matchKeymap, parseBinding } from "./match-keymap";
import { isMacPlatform } from "./platform";

/**
 * An action the global-shortcut layer may resolve and dispatch while DOM focus is OUTSIDE the
 * grid. The layer is action-generic (the gate + `matchKeymap` + the grid's own dispatch path);
 * the default is `undo`/`redo` only. Extension rule for anything added to
 * {@link DataGridGlobalShortcutActions}: every binding of the added action must be mod-prefixed
 * (no ctrl-only/alt-only combos — Ctrl+Space is the Windows IME toggle, Ctrl+Q the browser quit,
 * etc.), and the action must make sense without grid focus (a navigation move scrolls the grid's
 * own container, never the page).
 */
export type GlobalShortcutAction = GridAction;

/**
 * Actions the global-shortcut window layer may enable, each a boolean flag. Core lists the
 * actions it ships; an add-on that owns a `GridAction` (undo/redo, fill) augments this
 * interface via `declare module` to offer its own flag — see `data-grid-history`'s and
 * `data-grid-fill`'s barrels for the augmentation.
 */
export interface DataGridGlobalShortcutActions {
  selectAll: boolean;
  insertRowAbove: boolean;
  insertRowBelow: boolean;
  duplicateRow: boolean;
  deleteRows: boolean;
}

/**
 * Global-shortcut config: one boolean flag per action. `undo` and `redo` default to `true`, every
 * other flag to `false`; `undo={false}` removes one. Keys are constrained to `GridAction` so an
 * add-on's augmentation of {@link DataGridGlobalShortcutActions} can never compile in a key
 * `dispatchGridAction` cannot resolve.
 */
export type GlobalShortcutsConfig = {
  [K in keyof DataGridGlobalShortcutActions & GridAction]?: boolean;
};

/** The actions enabled by default: undo/redo only (the safe set — see {@link GlobalShortcutAction}). */
const DEFAULT_GLOBAL_ACTIONS = ["undo", "redo"] as readonly string[] as readonly GridAction[];

/** The enabled actions of a config: the default set minus every `false` flag, plus every `true` flag. */
export function enabledGlobalActions(config?: GlobalShortcutsConfig): readonly GlobalShortcutAction[] {
  const flags = (config ?? {}) as Partial<Record<GlobalShortcutAction, boolean>>;
  const kept = DEFAULT_GLOBAL_ACTIONS.filter((action) => flags[action] !== false);
  const added = (Object.keys(flags) as GlobalShortcutAction[]).filter((action) => flags[action] === true && !kept.includes(action));
  return [...kept, ...added];
}

/** Minimal event shape for {@link resolveGlobalShortcut} — the matcher's `KeymapEvent` plus `isComposing`, `keyCode`, and `defaultPrevented`. */
export type GlobalShortcutEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  keyCode: number;
  defaultPrevented: boolean;
};

/** DOM-derived facts the hook computes per event; keeps the gate pure. */
export type GlobalShortcutContext = {
  keymap: Keymap;
  isMac: boolean;
  actions: readonly GridAction[];
  /** The event target is `INPUT`/`TEXTAREA`/`SELECT` or `[contenteditable="true"]`. */
  targetIsEditable: boolean;
  /** The event target is inside ANY `role="grid"` element (including another grid). */
  targetInAnyGrid: boolean;
  /** This grid is the last focused opted-in grid (the multi-grid tie-break). */
  ownsFocus: boolean;
  /** An edit session is open; its editor, including a portaled popup, owns the keys. */
  editing?: boolean;
  /** Limits the keymap match to the actions it accepts. */
  include?: (action: GridAction) => boolean;
};

/**
 * The gate for global shortcuts, pure and unit-tested (same posture as {@link matchKeymap}).
 * Rules run in order, any hit returns `null`:
 * 1. `isComposing` — IME composition owns the keys.
 * 2. `defaultPrevented` — the in-grid handler (earlier in the bubble) or the page already handled it.
 * 3. `targetIsEditable` — the field's native undo/redo wins; never hijack it.
 * 4. `targetInAnyGrid` — a grid's in-grid handler owns the key (this also excludes other grids).
 * 5. `ownsFocus` — multi-grid: only the last focused opted-in grid proceeds.
 * 6. `editing` — an open edit session owns the keys, even from a popup outside the grid.
 * 7. The keymap resolves to one of the enabled actions.
 * 8. The event carries `ctrlKey` or `metaKey`; a bare key never fires page-wide.
 */
export function resolveGlobalShortcut(
  event: GlobalShortcutEvent,
  ctx: GlobalShortcutContext,
): GlobalShortcutAction | null {
  if (isComposingKey(event)) return null;
  if (event.defaultPrevented) return null;
  if (ctx.targetIsEditable) return null;
  if (ctx.targetInAnyGrid) return null;
  if (!ctx.ownsFocus) return null;
  if (ctx.editing) return null;
  const action = matchKeymap(event, ctx.keymap, ctx.isMac, ctx.include);
  if (action === null) return null;
  if (!ctx.actions.includes(action)) return null;
  return event.ctrlKey || event.metaKey ? action : null;
}

/** The enabled actions that have a binding without Ctrl/Cmd; the global layer never fires those. */
export function bareGlobalBindings(keymap: Keymap, actions: readonly GridAction[]): string[] {
  return actions.flatMap((action) =>
    (keymap[action] ?? []).filter((binding) => {
      const parsed = parseBinding(binding);
      return !parsed.mod && !parsed.ctrl;
    }).map((binding) => `${action}: ${binding}`),
  );
}

/** The current platform check, re-exported so consumers/tests never drift from the hook's view. */
export { isMacPlatform };
