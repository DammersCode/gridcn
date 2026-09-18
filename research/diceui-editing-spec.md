# diceui Cell-Editing Spec — the editing UX gridcn adopts (user decision 2026-07-03)

Scope: ONLY cell editing. Selection, fill, scrolling engine stay gridcn's own. Source: references/diceui (docs/components/data-grid/*, docs/hooks/use-data-grid.ts).

## Activation (all variants unless noted)

> **AMENDED 2026-07-03 (user decision, supersedes diceui here):** single click NEVER starts editing — not even on the already-focused cell. diceui's click-on-focused-cell gesture conflicts with Excel-style plain-drag range painting, and the user chose drag-painting. Edit triggers are: double-click, Enter, F2, Space (non-checkbox), typing. Everything else in this spec (caret policy, seamless editors, commit/cancel semantics, popover editors) still applies.

- Single click on an **unfocused** cell → focuses only (never edits).
- ~~Single click on the **already-focused** cell → starts editing.~~ REMOVED — see amendment above.
- Double click → always edits, regardless of prior focus.
- Enter or F2 (focused, not editing) → edit, content preserved.
- Space (focused, not editing) → edit — EXCEPT checkbox (toggles).
- Typing a printable char → edit + **seed value = typed char** (replaces content). gridcn KEEPS its `isComposing` IME guard here (diceui lacks one — known gap we don't copy).
- Grid-level Delete/Backspace (not editing) → quick-clear to the type's empty value WITHOUT entering edit mode.

## Editor rendering

- **Seamless inline for simple types** (text, number): the cell box itself becomes editable — input styled `w-full border-none bg-transparent p-0 outline-none` (number also strips spinners), no extra border/shadow/min-width. The only visual change is the caret.
- **The focus ring is the same whether focused or editing**: wrapper carries `ring-1 ring-ring ring-inset` when focused; there is NO separate heavier "editing" ring.
- **Popover editors for complex types**, all marked `data-grid-cell-editor=""` (outside-click logic checks this attr to distinguish "clicked into the floating editor" from "clicked away"):
  - select: in-place trigger styled identical to the read cell (`size-full border-none p-0 shadow-none [&_svg]:hidden`), only the dropdown pops (`min-w-[calc(var(--radix-select-trigger-width)+16px)]`).
  - date: popover below the cell (`w-auto p-0`) with Calendar.
  - long-text (v2 variant): popover overlaid flush ON the cell (negative sideOffset = cell height), `w-[400px] rounded-none p-0`, textarea `min-h-[150px] border-0 focus-visible:ring-1`.
- Wrapper data attrs: `data-editing`, `data-focused`, `data-selected`; selected bg `bg-primary/10` only when NOT editing.

## Caret policy (the biggest delta)

**Never select-all on entry.** Enter/F2/click-to-edit → focus + caret at END of existing content. Typing-to-edit → seeded char replaces content, caret at end. (Glide-style select-all-on-entry is explicitly NOT wanted.)

## Commit / cancel semantics

- Enter → commit + move DOWN one row (same column).
- Tab / Shift+Tab → commit + move right/left.
- Escape → revert local value, stop editing, STAY on cell (no data write).
- Blur / click-away → commit if changed, stop, STAY (no move). Popover editors: outside-click on `data-grid-cell-editor` content does NOT count as click-away.
- select: picking an option commits + closes + STAYS (no move). Escape reverts.
- date: picking a date commits + closes + STAYS.
- checkbox: NO edit mode at all — click/Space/Enter toggles and writes immediately; Tab just moves.
- Stop-editing contract: `onCellEditingStop({ moveToNextRow?: boolean; direction?: 'left'|'right' })`, no opts = refocus the cell wrapper.
- Invalid input: does not block typing; number parses on commit (NaN → null); validation styling via `data-invalid`, commit-time `validate` per gridcn's own contract.

## gridcn mapping (apply at Phase 4 gate / 4b window)

1. CellEditorProps commit semantics already match (movement param); align editor implementations: caret-to-end instead of select-all; seamless styling (drop any input border/ring inside cells); checkbox loses its pseudo-edit flow if the phase built one (direct toggle on click/Space/Enter).
2. Interaction layer: add click-on-focused-cell → startEditing; Space → startEditing (non-checkbox); grid Delete stays quick-clear (already spec'd).
3. Select/date editors: commit-and-stay (not commit-and-move); mark popover content `data-grid-cell-editor` and teach outside-click logic about it.
4. Keep gridcn improvements diceui lacks: IME `isComposing` guard, validate-blocks-commit (glide-style) with `data-invalid` + editingError.
5. Date editor: Calendar popover per this spec + displayFormat/locale options (see PLAN §3 date specifics).
