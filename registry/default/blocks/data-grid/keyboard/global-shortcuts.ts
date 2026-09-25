import type { GridAction, Keymap } from "../types";
import { matchKeymap } from "./match-keymap";
import { isMacPlatform } from "./platform";

/**
 * An action the global-shortcut layer may resolve and dispatch while DOM focus is OUTSIDE the
 * grid. The layer is action-generic (the gate + `matchKeymap` + the grid's own dispatch path);
 * the SAFE DEFAULT is `undo`/`redo` only. Extension rule for anything added to
 * {@link DataGridGlobalShortcutActions}: every binding of the added action must be mod-prefixed
 * (no ctrl-only/alt-only combos — Ctrl+Space is the Windows IME toggle, Ctrl+Q the browser quit,
 * etc.), and the action must make sense without grid focus (a navigation move scrolls the grid's
 * own container, never the page).
 */
export type GlobalShortcutAction = GridAction;

/**
 * Actions the global-shortcut window layer may enable, each keyed `true`. Core lists the
 * actions it ships; an add-on that owns a `GridAction` (undo/redo, fill) augments this
 * interface via `declare module` to offer its own flag — see `data-grid-history`'s and
 * `data-grid-fill`'s barrels for the augmentation.
 */
export interface DataGridGlobalShortcutActions {
  selectAll: true;
  insertRowAbove: true;
  insertRowBelow: true;
  duplicateRow: true;
  deleteRows: true;
}

/**
 * Opt-in global-shortcut config: one `true` flag per enabled action. Keys are constrained to
 * `GridAction` so an add-on's augmentation of {@link DataGridGlobalShortcutActions} can never
 * compile in a key `dispatchGridAction` cannot resolve. No flag set (or the config omitted)
 * enables the safe default — `undo` and `redo` only; any flag set enables exactly the flagged
 * actions.
 */
export type GlobalShortcutsConfig = {
  [K in keyof DataGridGlobalShortcutActions & GridAction]?: true;
};

/** The actions enabled by default: undo/redo only (the safe set — see {@link GlobalShortcutAction}). */
const DEFAULT_GLOBAL_ACTIONS: readonly GridAction[] = ["undo", "redo"];

/** The enabled actions of a config: any `true` flag selects exactly the flagged actions. No flag (or no config) enables the default set. */
export function enabledGlobalActions(config?: GlobalShortcutsConfig): readonly GlobalShortcutAction[] {
  const flagEnabled = Object.keys(config ?? {}).filter(
    (key) => config?.[key as keyof GlobalShortcutsConfig] === true,
  ) as GlobalShortcutAction[];
  return flagEnabled.length > 0 ? flagEnabled : [...DEFAULT_GLOBAL_ACTIONS];
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
