import type { GridAction, Keymap } from "../types";
import { matchKeymap } from "./match-keymap";
import { isMacPlatform } from "./platform";

/**
 * An action the global-shortcut layer may resolve and dispatch while DOM focus is OUTSIDE the
 * grid. The layer is action-generic (the gate + `matchKeymap` + the grid's own dispatch path);
 * the SAFE DEFAULT is `undo`/`redo` only. Extension rule for anything added through
 * `GlobalShortcutsConfig.actions`: every binding of the added action must be mod-prefixed (no
 * ctrl-only/alt-only combos — Ctrl+Space is the Windows IME toggle, Ctrl+Q the browser quit,
 * etc.), and the action must make sense without grid focus (a navigation move scrolls the grid's
 * own container, never the page).
 */
export type GlobalShortcutAction = GridAction;

/**
 * Opt-in global-shortcut config. An object rather than an array: a duplicate key is a compile
 * error, and IntelliSense stops suggesting a key once it is typed, so the same action can never
 * be registered twice. Omit the whole option (or pass no flag) to enable the safe default —
 * `undo` and `redo` only.
 */
export interface GlobalShortcutsConfig {
  /** Intercept the effective keymap's `undo` binding (default `mod+z`) on window keydown. */
  undo?: true;
  /** Intercept the effective keymap's `redo` bindings (default `mod+y`, `mod+shift+z`) on window keydown. */
  redo?: true;
  /**
   * Additional actions the window layer resolves and dispatches, beyond `undo`/`redo` (e.g.
   * `"selectAll"`). The flags above still narrow the flag-derived set; `actions` only EXTENDS it
   * (deduped). Each added action runs the grid's own keymap-dispatch path, so it behaves exactly
   * like its in-grid binding — including that binding's store-side guards (`insertRowBelow`
   * without `createRow` is a no-op, `fillDown` without the fill add-on is a no-op, ...). Extension
   * rule: every binding of an added action must be mod-prefixed (see {@link GlobalShortcutAction}).
   */
  actions?: readonly GridAction[];
}

/** The actions enabled by default: undo/redo only (the safe set — see {@link GlobalShortcutAction}). */
const DEFAULT_GLOBAL_ACTIONS: readonly GridAction[] = ["undo", "redo"];

/** The enabled actions of a config: the `true` flags narrow the default set, `actions` extends it. Omitting the config or passing no flag enables every default action. */
export function enabledGlobalActions(config?: GlobalShortcutsConfig): readonly GlobalShortcutAction[] {
  const flagEnabled: GridAction[] = [];
  if (config?.undo === true) flagEnabled.push("undo");
  if (config?.redo === true) flagEnabled.push("redo");
  const enabled: GridAction[] = flagEnabled.length > 0 ? flagEnabled : [...DEFAULT_GLOBAL_ACTIONS];
  for (const action of config?.actions ?? []) {
    if (!enabled.includes(action)) enabled.push(action);
  }
  return enabled;
}

/** Minimal event shape for {@link resolveGlobalShortcut} — the matcher's `KeymapEvent` plus the two DOM flags the gate needs. */
export type GlobalShortcutEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing: boolean;
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
};

/**
 * The gate for global shortcuts, pure and unit-tested (same posture as {@link matchKeymap}).
 * Rules run in order, any hit returns `null`:
 * 1. `isComposing` — IME composition owns the keys.
 * 2. `defaultPrevented` — the in-grid handler (earlier in the bubble) or the page already handled it.
 * 3. `targetIsEditable` — the field's native undo/redo wins; never hijack it.
 * 4. `targetInAnyGrid` — a grid's in-grid handler owns the key (this also excludes other grids).
 * 5. `ownsFocus` — multi-grid: only the last focused opted-in grid proceeds.
 * 6. The keymap resolves to one of the enabled actions.
 */
export function resolveGlobalShortcut(
  event: GlobalShortcutEvent,
  ctx: GlobalShortcutContext,
): GlobalShortcutAction | null {
  if (event.isComposing) return null;
  if (event.defaultPrevented) return null;
  if (ctx.targetIsEditable) return null;
  if (ctx.targetInAnyGrid) return null;
  if (!ctx.ownsFocus) return null;
  const action = matchKeymap(event, ctx.keymap, ctx.isMac);
  if (action === null) return null;
  return ctx.actions.includes(action) ? action : null;
}

/** The current platform check, re-exported so consumers/tests never drift from the hook's view. */
export { isMacPlatform };
