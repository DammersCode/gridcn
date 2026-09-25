# Global-shortcut config: flags, not an array

## Decision

`GlobalShortcutsConfig` becomes `{ [K in keyof DataGridGlobalShortcutActions & GridAction]?: true }`.
Core declares `DataGridGlobalShortcutActions` (selectAll, insertRowAbove, insertRowBelow,
duplicateRow, deleteRows) in `keyboard/global-shortcuts.ts`. The `actions?: readonly GridAction[]`
field is removed.

## Augmentation mechanism

`data-grid-history` and `data-grid-fill` each add a `declare module
"@/registry/default/blocks/data-grid/keyboard/global-shortcuts" { interface
DataGridGlobalShortcutActions { ... } }` block to their barrel (`data-grid-history.ts`,
`data-grid-fill.ts` — both already listed in registry.json, so no manifest change). The payload
rewrite (`fix-registry-imports.mjs`) matches this path textually (not import-statement-gated) and
maps it to the consumer's alias, the same as any other cross-item import, so the augmentation
targets the installed core file post-install too. `verify-import-boundaries.mjs`'s `IMPORT_RE`
only matches `import`/`from` keywords, so a `declare module` string does not trip the
core-never-imports-add-on rule; no change to that script was needed.

## Why flags, not an array

An array accepted duplicates and any `GridAction`, including non-mod-prefixed ones (arrow moves)
that break the "must make sense with no grid focus" invariant. A mapped-type object makes a
duplicate key a compile error and constrains keys to actions add-ons actually declared, narrowed
again by `& GridAction` so a bogus augmentation can never reach `dispatchGridAction`.

## Why add-ons own undo/redo/fill keys

`undo`/`redo` and `fillDown`/`fillRight` are no-ops without their add-on installed (today's
behavior, unchanged). Letting the owning add-on augment the interface means the flag only exists
in a consumer's IntelliSense once the feature it drives is actually installed — the type system
mirrors the runtime dependency instead of exposing a flag that silently does nothing.
