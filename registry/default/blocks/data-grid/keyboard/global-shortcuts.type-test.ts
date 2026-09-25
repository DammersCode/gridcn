/**
 * Compile-time proof of `GlobalShortcutsConfig`'s add-on-augmented shape. Imports
 * data-grid-history/data-grid-fill for their `declare module` augmentation side effect only
 * (never done in shipped, non-test source — see verify-import-boundaries.mjs's test exemption).
 * tsc gate typechecks this file (named so vitest's *.test.ts glob does not pick it up).
 */
import type { GlobalShortcutsConfig } from "./global-shortcuts";
import "@/registry/default/blocks/data-grid-history/data-grid-history";
import "@/registry/default/blocks/data-grid-fill/data-grid-fill";

// --- accepted: core actions + add-on-augmented actions ----------------------------
const okSelectAll: GlobalShortcutsConfig = { selectAll: true };
const okDeleteRows: GlobalShortcutsConfig = { deleteRows: true };
const okUndo: GlobalShortcutsConfig = { undo: true };
const okRedo: GlobalShortcutsConfig = { redo: true };
const okFillDown: GlobalShortcutsConfig = { fillDown: true };
const okFillRight: GlobalShortcutsConfig = { fillRight: true };
const okInsertRowAbove: GlobalShortcutsConfig = { insertRowAbove: true };
const okInsertRowBelow: GlobalShortcutsConfig = { insertRowBelow: true };
const okDuplicateRow: GlobalShortcutsConfig = { duplicateRow: true };
void okSelectAll;
void okDeleteRows;
void okUndo;
void okRedo;
void okFillDown;
void okFillRight;
void okInsertRowAbove;
void okInsertRowBelow;
void okDuplicateRow;

// --- rejected: a plain GridAction that no DataGridGlobalShortcutActions entry lists ------
// @ts-expect-error moveUp is a GridAction but not a global-shortcut-eligible action
const badMoveUp: GlobalShortcutsConfig = { moveUp: true };
void badMoveUp;

// --- rejected: the removed `actions` array API -------------------------------------------
// @ts-expect-error actions was removed; use per-action `true` flags instead
const badActions: GlobalShortcutsConfig = { actions: ["selectAll"] };
void badActions;

// --- rejected: a key that is not a GridAction at all --------------------------------------
// @ts-expect-error not a GridAction key
const badNonAction: GlobalShortcutsConfig = { notAnAction: true };
void badNonAction;
