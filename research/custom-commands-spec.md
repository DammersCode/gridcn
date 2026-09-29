# Spec: custom keymap commands (W5-10, API-R8)

Motivation: the keymap today only reaches the built-in `GridAction` switch. A consumer who wants
a binding for their own behavior (save-all, duplicate-and-select, app-specific jump) has no
hook — `dispatchGridAction` falls through to nothing. Custom commands add a consumer-owned
dispatch tier: named `run(ctx)` functions, bound through the existing `keymap` prop, listed in
the keybindings dialog.

## Decisions

1. **`GridActions` becomes an interface (mergeable).**
   `GridAction = keyof GridActions`, mirroring the `GridCellTypes` pattern — consumers add
   actions by declaration-merging `GridActions` in their own module. `Keymap =
   Partial<Record<GridAction, KeyBinding[]>>` and `labels.actions` then accept the merged names
   with no other type change. The repo's built-in key set is unchanged, so the exhaustive
   `Record<GridAction, true>` test in `keyboard/index.test.ts` and the global-shortcuts
   type-test compile untouched.

2. **`GridCommand<TData>` / `GridCommandCtx<TData>`** (root `types.ts`, next to `GridAction`):

   | Member | Semantics |
   |---|---|
   | `run(ctx)` | the command body; fires when a bound key resolves. |
   | `when?(ctx)` | gate — return `false` to ignore the key entirely (no `preventDefault`, no run). Default: enabled. |
   | `label?` | keybindings-dialog label; default: `labels.keybindings.actions[name]` or the humanized name. |
   | `group?` | dialog section: a `CommandGroup` (`"navigation" \| "selection" \| "editing" \| "clipboardFill" \| "history" \| "other"`); default: the action's usual category, i.e. `"other"` for custom names. |

   `GridCommandCtx = { actions, cell, row, readOnly }` — the stable actions object, the active
   cell in view space (`null` when none), the active cell's data row (`TData`, `undefined` when
   none), and the grid's effective `readOnly`. `run`/`when` use method syntax so a consumer's
   `GridCommand<TData>` stays assignable to the store's erased `GridCommand<unknown>` field
   (bivariance — the same trick the erased callbacks use).

3. **`CommandGroup`** is defined in core `types.ts` (the six dialog sections, order-agnostic).
   The keybindings add-on's `KeybindingCategory` becomes an alias of it (the `KEYBINDING_CATEGORIES`
   order const stays in the add-on — display order and i18n labels remain add-on-owned).

4. **`commands?: Record<string, GridCommand<TData>>`** — a new sync prop on
   `DataGridSyncProps` (behavior tier, like `createRow`; `DataGridProps` forwards it to the
   provider). Store state gains `commands: Record<string, GridCommand<unknown>> | null`
   (`null` default), written by `_syncProps` (`props.commands ?? null`). Pass a stable reference.

5. **Dispatch** — in `dispatchGridAction`, BEFORE the built-in switch: `state.commands?.[action]`
   hits → build the ctx from the live state, run the `when` gate, then `preventDefault()` +
   `run(ctx)`. This single point covers both the in-grid keydown path and the global-shortcut
   window path (both call `dispatchGridAction`). A command that shadows a built-in action name
   wins (and `_syncProps` dev-warns once per grid, since the shadow silently disables the
   built-in). A keymap-resolved name that is neither a built-in case nor a `commands` entry hits
   the switch's new `default:` and dev-warns once per name — a bound-but-unwired command.

6. **Keybindings dialog** — reads the new `useDataGridCommands()` hook (store field) and applies
   the per-command overrides: label `commands[a]?.label ?? labelForAction(a, labels)`, category
   `commands[a]?.group ?? categoryForAction(a)`. Built-in rows render exactly as today.

7. **Out of scope:**
   - Global shortcuts for custom commands — `DataGridGlobalShortcutActions` stays
     built-in-only (a merged name could be listed, but the six-rule gate + dialog story for
     consumer commands is a separate decision).
   - `commands` on `DataGridRoot` — it is a sync prop; the `keymap` (root prop) carries the
     bindings, the provider prop carries the definitions.
   - Per-command `preventDefault` control — an enabled command always prevents the default;
     veto with `when`.

## Impact

- `registry/default/blocks/data-grid/types.ts` — `GridActions` interface, `GridAction = keyof`,
  `CommandGroup`, `GridCommand`/`GridCommandCtx` (imports `DataGridActions` type-only from
  `./store/types` — type-only cycle, fine).
- `registry/default/blocks/data-grid/store/types.ts` — `commands` sync prop + state field;
  `store/index.ts` — no new exports (state field flows through the existing surface).
- `store/create-store.ts` — `_syncProps` line + shadow dev-warn (once per grid, `DEFAULT_KEYMAP`
  keys).
- `interaction/use-grid-interaction.ts` — `dispatchGridAction` command tier + `default:` warn.
- `store/hooks.ts` + `store/index.ts` — `useDataGridCommands()`.
- `data-grid.tsx` — `commands` on `DataGridProps` + forward; barrel exports `GridCommand`,
  `GridCommandCtx`, `CommandGroup`.
- `registry/default/blocks/data-grid-keybindings/` — `KeybindingCategory` alias, dialog
  overrides, `groupKeymap` gains the commands argument.
- Tests: unit — `dispatchGridAction` command tier (run ctx, `when` gate, preventDefault,
  unknown-name warn), store sync of `commands`, a declaration-merge type-test; browser — the
  keybindings dialog lists a custom command with its label/group.
- Demo: `data-grid-keybindings-demo` gains one custom command (bound key, dialog entry).
- Docs: api-reference (props table picks up `commands`; Other-exported-types entries; a short
  "Custom commands" section with the merge example) + the keybindings add-on page notes the
  `label`/`group` overrides. CHANGELOG `### Added`.

## Execution order

types → store sync + state → dispatch tier → hook → dialog → demo → tests (unit then browser)
→ gates → docs → CHANGELOG → registry pipeline → e2e-install → commit.
