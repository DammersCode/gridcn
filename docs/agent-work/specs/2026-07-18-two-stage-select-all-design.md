# Two-stage Ctrl+A (workplan #38, finding 1)

## Problem

`content/docs/selection-keyboard.mdx` promises Excel-parity two-stage select-all in an explicit
callout: first Ctrl+A selects the active cell's data region, second Ctrl+A selects the whole
grid. The implementation (`selection/select-all-progression.ts`) jumps straight to whole-grid —
its own doc comment admits the PLAN's two-stage behavior "is not implemented here". Docs and
code disagree; the docs describe the better (and originally planned) behavior.

## Decision

Implement the two-stage progression rather than downgrading the docs — it is small, planned,
tested behavior with real Excel-parity value.

## Behavior

1. **First Ctrl+A** (no prior select-all state): select the active cell's *data region* — the
   contiguous block of non-empty cells around the active cell (flood-fill style over rows and
   columns bounded by empty cells, Excel's "current region"). If the active cell is empty or the
   grid has no empty-cell boundaries (fully dense data), this stage already equals the whole
   grid — then stage 2 is a no-op repeat and MUST not toggle anything off.
2. **Second Ctrl+A** (immediately repeated, same active cell, selection unchanged since stage 1):
   select the whole grid (current behavior today).
3. Any intervening selection change, active-cell move, or edit resets the progression to stage 1.

Keep the pure-function shape of `select-all-progression.ts` (input: current selection/active
coord/data emptiness probe; output: next selection + progression stage) so unit tests stay pure.
The emptiness probe must go through the existing cell-value access path (`isEmpty` of the cell
type) without allocating per-cell in a hot loop — the region scan is O(region perimeter × rows
touched), only on explicit Ctrl+A, not a hot path.

## Scope

- `selection/select-all-progression.ts` + its unit tests (extend, keep existing cases green by
  meaning — single-stage cases become the dense-data/stage-2 cases).
- Wiring in the keymap/interaction layer that tracks the progression stage + reset conditions.
- `selection-keyboard.mdx`: the callout stays as-is (it becomes true); adjust any wording that
  hedges.
- Browser test: sparse dataset → Ctrl+A selects region, Ctrl+A again selects all, arrow key
  resets progression.

## Out of scope

Third-stage behaviors (Excel's header-inclusion quirks), Ctrl+Shift+Space variants.
