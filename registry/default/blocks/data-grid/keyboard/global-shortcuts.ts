import type { GridAction, Keymap } from "../types";
import { matchKeymap } from "./match-keymap";
import { isMacPlatform } from "./platform";

/**
 * Actions safe to run while DOM focus is OUTSIDE the grid. Extension rule: every binding of a
 * new action in `DEFAULT_KEYMAP` must be mod-prefixed (no ctrl-only/alt-only combos — Ctrl+Space
 * is the Windows IME toggle, Ctrl+Q the browser quit, etc.).
 */
export type GlobalShortcutAction = "undo" | "redo";

/**
 * Opt-in global-shortcut config, keyed by action name. An object rather than an array: a
 * duplicate key is a compile error, and IntelliSense stops suggesting a key once it is typed, so
 * the same action can never be registered twice. Omit the whole option to enable every action.
 */
export interface GlobalShortcutsConfig {
  /** Intercept the effective keymap's `undo` binding (default `mod+z`) on window keydown. */
  undo?: true;
  /** Intercept the effective keymap's `redo` bindings (default `mod+y`, `mod+shift+z`) on window keydown. */
  redo?: true;
}

const ALL_ACTIONS: readonly GlobalShortcutAction[] = ["undo", "redo"];

/** The enabled actions of a config (`true` keys); omitting the config or passing no flag enables every action. */
export function enabledGlobalActions(config?: GlobalShortcutsConfig): readonly GlobalShortcutAction[] {
  const enabled = ALL_ACTIONS.filter((action) => config?.[action] === true);
  return enabled.length ? enabled : ALL_ACTIONS;
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
  actions: readonly GlobalShortcutAction[];
  /** The event target is `INPUT`/`TEXTAREA`/`SELECT` or `[contenteditable="true"]`. */
  targetIsEditable: boolean;
  /** The event target is inside ANY `role="grid"` element (including another grid). */
  targetInAnyGrid: boolean;
  /** This grid is the last focused opted-in grid (the multi-grid tie-break). */
  ownsFocus: boolean;
};

function isGlobalShortcutAction(action: GridAction): action is GlobalShortcutAction {
  return action === "undo" || action === "redo";
}

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
  if (action === null || !isGlobalShortcutAction(action)) return null;
  return ctx.actions.includes(action) ? action : null;
}

/** The current platform check, re-exported so consumers/tests never drift from the hook's view. */
export { isMacPlatform };
