# Plan 006: Implement the three spec'd-but-missing behaviors (Alt+Arrow, mod+Enter, outside-click clear + `onSelectionCleared`)

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If anything
> in the "STOP conditions" section occurs, stop and report — do not improvise. When
> done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 037d895..HEAD -- registry/default/blocks/data-grid/types.ts registry/default/blocks/data-grid/keyboard/default-keymap.ts registry/default/blocks/data-grid/interaction/use-grid-interaction.ts registry/default/blocks/data-grid/store/create-store.ts registry/default/blocks/data-grid/store/provider.tsx registry/default/blocks/data-grid/data-grid.tsx`
> If any changed, compare against the "Current state" excerpts; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW-MED (additive API + one new document-level listener; no existing behavior changes)
- **Depends on**: none
- **Category**: feature (spec conformance)
- **Planned at**: commit `037d895`, 2026-09-03

## Why this matters

`research/glide-behavior-spec.md` is the behavior contract (PLAN.md §3: "Full
keyboard map per research/glide-behavior-spec.md §2"). The 2026-09-03 bugs audit found
three specified behaviors absent:

- **N2** — spec :41 "Alt+Arrow: move active cell but **retain selection**" — no action,
  no binding. The key matcher already supports `alt` (`keyboard/match-keymap.ts:47`,
  tested in `keyboard/index.test.ts:246-269`). Today Alt+Arrow falls through to plain
  move, which collapses the selection to 1×1.
- **N3** — spec :46 "primary+Enter: scroll active cell into view without moving" —
  the capability exists and is registered (`interaction/use-grid-interaction.ts`
  `scrollCellIntoView`, wired at `root.tsx:227-228` via `actions._registerScrollToCell`)
  but no keymap action binds it.
- **N4** — spec :108 "Click outside grid → clear selection, fire onSelectionCleared" —
  half-implemented: the clear fires only when the pointerdown target is the grid root
  element ITSELF (its gutter/empty strip; `use-grid-interaction.ts:876-887` bails on
  `event.target !== event.currentTarget`), and `onSelectionCleared` does not exist
  anywhere in `registry/` (zero grep hits). A page-area click keeps a stale selection.

Note (audit correction): `onSelectionChange` DOES fire on clear — it fires on every
selection-identity change, clear included (`store.test.tsx:2120-2126` asserts exactly
that, with `current: null`). The missing piece is the DEDICATED callback the spec
names (a consumer resetting an "N cells selected" chip should not have to diff
selections), plus the widened outside-click.

## Current state

- `registry/default/blocks/data-grid/types.ts:396-410` — `GridAction` union (the four
  `move*` actions at :397, `Keymap = Partial<Record<GridAction, string[]>>` at :416).
- `registry/default/blocks/data-grid/keyboard/default-keymap.ts:10-54` —
  `DEFAULT_KEYMAP` (see the `moveUp`/`extendUp` naming pattern; the :50-51 comment
  documents the key-availability reasoning for row-op bindings).
- `registry/default/blocks/data-grid/interaction/use-grid-interaction.ts`:
  - :575-586 — `moveAndScroll(d, {extend?})` → `actions._moveActiveCell(d, opts)` +
    `scrollActiveCellIntoView(getFocusCell(...))` — the pattern to extend.
  - :578+ — the action `switch` (add cases next to the `move*` block at :579-586).
  - :876-887 — `onRootPointerDown` (the current, gutter-only clear; the
    `data-grid-cell-editor` closest-check at :882-883 is the portaled-editor guard to
    reuse).
- `registry/default/blocks/data-grid/store/create-store.ts:823-846` —
  `_moveActiveCell(d, opts)`: extend mode (829-841) / plain mode (842-845, the plain
  mode does `set({ activeCell: next, selection: selectCellPure(next), ... })` — the
  selection collapse Alt+Arrow must NOT do).
- `registry/default/blocks/data-grid/store/provider.tsx:14-30` —
  `subscribeSelectionChange`: one `storeApi.subscribe` on `state.selection` identity,
  reads the callback fresh off the store each fire. THE PATTERN for the new
  `onSelectionCleared` subscription.
- `registry/default/blocks/data-grid/store/create-store.ts:375-377` — `clearSelection()`
  (`set({ selection: emptySelection() })`).
- Provider prop plumbing exemplar: `onSelectionChange` (declared `types.ts:161`,
  provider prop at `data-grid.tsx:335`, forwarded at `:464`, synced by `_syncProps`,
  wired by `subscribeSelectionChange` — follow this path exactly for
  `onSelectionCleared`).
- `content/docs/selection-keyboard.mdx` (keyboard table) and the events-state docs
  page — both need one-line additions.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Tests (filter) | `pnpm test -- keyboard` | exit 0 |
| Tests (filter) | `pnpm test -- store` | exit 0 |
| Tests (filter) | `pnpm test -- interaction` | exit 0 |
| Tests (full) | `pnpm test` | exit 0 |
| Typecheck | `pnpm types:check` | exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Registry rebuild | `pnpm registry:build && pnpm registry:verify` | exit 0 |

## Scope

**In scope:**
- `registry/default/blocks/data-grid/types.ts` (GridAction union, `onSelectionCleared` prop type)
- `registry/default/blocks/data-grid/keyboard/default-keymap.ts`
- `registry/default/blocks/data-grid/interaction/use-grid-interaction.ts` (switch cases, `moveAndScroll` opts, outside-click listener)
- `registry/default/blocks/data-grid/store/create-store.ts` (`_moveActiveCell` retain mode only)
- `registry/default/blocks/data-grid/store/provider.tsx` (the cleared subscription, mirroring `subscribeSelectionChange`)
- `registry/default/blocks/data-grid/data-grid.tsx` (prop forwarding) + `store/types.ts` (sync-prop plumbing — follow `onSelectionChange`'s)
- Colocated/colocatable tests + `content/docs/selection-keyboard.mdx` + the events-state mdx page
- `PLAN.md` §4.6 (the listener-rule line — one clause)

**Out of scope:**
- `extend*`/`jump*`/`selectAll` semantics, `growSelection`/`selectCellPure`
- the two-stage select-all progression, `onSelectionChange` (unchanged — it keeps
  firing on every identity change, clear included)
- any change to `emptySelection()`

## Git workflow

- Branch `feat/006-spec-gap-bindings` or `dev`; conventional commits per behavior
  (`feat(keyboard): alt+arrow moves the active cell retaining the selection`,
  `feat(keyboard): mod+enter scrolls the active cell into view`,
  `feat(selection): outside-click clear + onSelectionCleared`). No co-author trailer.
  Do not push.

## Steps

### Step 1: Alt+Arrow — retain-selection move

1. `types.ts:396-410` — add `"retainMoveUp" | "retainMoveDown" | "retainMoveLeft" | "retainMoveRight"` to `GridAction`.
2. `default-keymap.ts` — add `retainMoveUp: ["alt+ArrowUp"]`, `retainMoveDown: ["alt+ArrowDown"]`, `retainMoveLeft: ["alt+ArrowLeft"]`, `retainMoveRight: ["alt+ArrowRight"]` (place next to the `move*` family; one-line comment citing glide spec :41).
3. `create-store.ts:823` — `_moveActiveCell(d, opts)`: add `retain?: boolean` to opts. In the plain branch (when NOT extend): if `opts.retain`, do `set({ activeCell: next, lastHighlightedRow: next.row, lastHighlightedCol: next.col })` — NO `selection: selectCellPure(next)` (the selection, whatever it is, is retained exactly; a 1×1 selection retained is a 1×1, a multi-range stays multi-range). Interpretation note: the spec's "retain selection as secondary range" reads as "the selection is kept while the active cell moves" — implement KEEP-IN-PLACE (the range does not follow the cell). If the user's QA later wants the range to TRANSLATE with the cell, that is a follow-up, not a silent change.
4. `use-grid-interaction.ts` — extend `moveAndScroll`'s opts with `retain?` (forward it to `_moveActiveCell`), and add the four switch cases mirroring :579-586 (reuse `MOVE_DELTA` — verify the table covers all four directions; it does for the move family).
5. Unit tests: `store.test.tsx` (or the interaction test file — use wherever `_moveActiveCell` cases live): from a 3×2 range selection, `retain`-move down → `activeCell` moved, `selection` reference/content UNCHANGED (assert `toEqual` against the pre-move selection); from no selection, retain-move = plain move. `keyboard/index.test.ts`: the four bindings match (pattern: the existing alt-modifier matcher tests at :246-269).

**Verify**: `pnpm test -- keyboard` and `pnpm test -- store` → green.

### Step 2: mod+Enter — scroll active cell into view

1. `types.ts` — add `"scrollActiveIntoView"` to `GridAction`.
2. `default-keymap.ts` — `scrollActiveIntoView: ["mod+Enter"]` (comment: glide spec :46; mod+Enter is unreserved browser-chrome-wise — verify on Chrome/Edge/Firefox/Safari by trying it in a scratch page before shipping; if any platform eats it, bind nothing and report).
3. `use-grid-interaction.ts` — new switch case: `event.preventDefault(); scrollActiveCellIntoView(state.activeCell);` (the function already exists — `moveAndScroll` uses it at :585; verify its null-activeCell behavior first — if it no-ops on null, that is the correct behavior here too).
4. Unit test: with the active cell off-screen (a 100k-row fixture scrolled away, or the existing scroll test setup in `test/*.browser.test.tsx`), dispatch `mod+Enter` → the container's scrollTop moves and `activeCell` is UNCHANGED.

**Verify**: `pnpm test -- keyboard` + the browser test → green.

### Step 3: `onSelectionCleared` callback

1. `types.ts` — add `onSelectionCleared?: () => void;` next to `onSelectionChange` (:161) with JSDoc: "Fired exactly once when the selection transitions from non-empty to empty, from ANY path (outside-click, clearSelection, a cleared range, etc.). `onSelectionChange` also fires on that transition (with an empty selection) — this is the dedicated signal for UI resets. Does not fire when the selection is already empty."
2. Sync-prop plumbing: follow `onSelectionChange`'s path exactly (provider props type in `store/types.ts`, `_syncProps`, `data-grid.tsx` prop + forward at :335/:464).
3. `provider.tsx` — a second subscription, mirroring `subscribeSelectionChange` (:23-30): fire `state.onSelectionCleared?.()` when `state.selection !== prevState.selection` AND the NEW selection is empty AND the PREVIOUS was non-empty. Empty predicate (reuse the existing one — `hooks.ts:526` computes `selectionEmpty` inline; extract a tiny exported `isSelectionEmpty(selection)` helper in `selection/` if the predicate is not already exported, and use it in both places):

```ts
function subscribeSelectionCleared(store: StoreApi<DataGridStoreState>): () => void {
  let wasEmpty = isSelectionEmpty(store.getState().selection);
  return store.subscribe((state, prevState) => {
    if (state.selection === prevState.selection) return;
    const empty = isSelectionEmpty(state.selection);
    if (empty && !wasEmpty) state.onSelectionCleared?.();
    wasEmpty = empty;
  });
}
```

   (Mount it where `subscribeSelectionChange` is mounted — read provider.tsx to the
   end first and mirror its lifecycle exactly.)
4. Tests (store.test.tsx, the `makeConfigWrapper` pattern at :2038-2138): clear from a
   selection → `onSelectionCleared` fires exactly once; `onSelectionChange` also fired
   (both, in the same act); a second `clearSelection()` on the already-empty
   selection → `onSelectionCleared` does NOT fire again; an unrelated store write →
   neither fires.

**Verify**: `pnpm test -- store` → green, existing onSelectionChange tests untouched.

### Step 4: Outside-click clear (page-wide)

1. `use-grid-interaction.ts` — a document-level `pointerdown` (capture phase)
   listener, ACTIVE ONLY WHILE A SELECTION EXISTS: subscribe to the selection identity
   (same store-subscription pattern as Step 3), and attach/detach the document
   listener when emptiness flips. Handler:
   - ignore if `event.target` is inside the grid's own subtree (the container ref —
     the hook has one; `use-data-grid-container.ts` if you need to find it),
   - ignore if `(event.target as HTMLElement).closest?.(gridAttrSelector("cellEditor"))`
     (the portaled-editor guard from :882-883 — a select/date popover lives outside
     the grid subtree but is the grid's own editing surface),
   - else `actions.clearSelection()` (which fires `onSelectionCleared` via Step 3).
2. Document the listener-rule extension in the code comment AND in `PLAN.md` §4.6
   (the "no document-level listeners except during an active drag" line gains: "or
   while a non-empty selection exists — the outside-click clear, 2026-09-03 audit N4").
3. Browser test: render the grid in a page with an outside element; select a range;
   `pointerdown` on the outside element → selection empty + `onSelectionCleared` fired
   once; `pointerdown` on the grid's own gutter → unchanged (the existing
   `onRootPointerDown` path still owns it); a portaled editor open (select editor) +
   click inside the popover → selection NOT cleared; after the selection is empty the
   document listener is DETACHED (assert via the existing listener-count probe if
   one exists, otherwise by behavior: outside clicks no longer have any effect and —
   if the repo has a "no document listeners at rest" guard, extend it to assert the
   listener count is 0 at rest and 1 while selected).

**Verify**: `pnpm test` (full) → green; `pnpm types:check` → exit 0.

### Step 5: Keybindings dialog + docs

1. The keybindings dialog is generated from the effective keymap (PLAN §8 item 7 —
   "single source of truth, never a hardcoded list"). Check `data-grid-keybindings/`
   (`binding-label.tsx`, `keybindings-shortcut.tsx`) for any ACTION-NAME → label
   table: if labels are derived from action names, the five new actions appear
   automatically (verify by reading `keybindings.browser.test.tsx` and the label
   logic); if a table exists, add the five entries (retained move ×4, scroll-into-view)
   with wording matching the table's style.
2. `content/docs/selection-keyboard.mdx` — add Alt+Arrow (retain selection) and
   mod+Enter (scroll into view) to the shortcut table.
3. The events-state docs page — one line for `onSelectionCleared` (pattern: the
   `onSelectionChange` entry).
4. `research/glide-behavior-spec.md:52` — while here, fix the audit's N6 note: line 52
   "grow to grid edge" contradicts line 43's data-boundary mandate; gridcn implements
   data-boundary (correct per Excel). One-line correction so the spec stops
   contradicting itself.

**Verify**: `pnpm test` → green (the keybindings browser test); `pnpm lint` → exit 0.

### Step 6: Full gate

**Verify**: `pnpm test` exit 0; `pnpm lint` exit 0; `pnpm types:check` exit 0;
`pnpm registry:build && pnpm registry:verify` exit 0 (core payload changed — the
gate catches alias drift).

## Test plan

- New: retain-mode store cases (Step 1), mod+Enter browser case (Step 2),
  `onSelectionCleared` lifecycle cases (Step 3), outside-click browser cases incl.
  the portaled-editor guard and listener lifecycle (Step 4), keymap binding
  assertions (Step 1/2).
- Must stay green untouched: the `onSelectionChange` describe block
  (store.test.tsx:2038-2139), all existing keyboard tests, the a11y browser test.

## Done criteria

- [ ] `pnpm test` exits 0 incl. all new cases
- [ ] Alt+Arrow moves the active cell and leaves the selection byte-identical
- [ ] mod+Enter scrolls the active cell into view without moving it
- [ ] Page-area pointerdown clears the selection and fires `onSelectionCleared` exactly once; the document listener is attached only while a selection exists
- [ ] `pnpm registry:build && pnpm registry:verify` exit 0
- [ ] Docs (keyboard table, events page, glide spec line 52) updated
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated to DONE + commit SHA

## STOP conditions

- `mod+Enter` is consumed by a browser on an evergreen platform (the scratch-page
  check fails) — bind nothing, keep the action unbound, and report (do not pick a
  different key unilaterally).
- The retain-move semantics conflict with an existing test (a test asserts
  selection collapse on a bare move that Alt+Arrow now shares) — the retain branch
  must be ADDITIVE; if it isn't, report.
- The keybindings dialog turns out to have a hardcoded action list (contradicting
  PLAN §8's "generated at runtime") — that is a separate finding; fix it properly
  (generate from the keymap) only if it is small (<30 lines), otherwise report.

## Maintenance notes

- `isSelectionEmpty` (if extracted) is now shared by the hooks.ts predicate, the
  cleared-subscription, and the outside-click listener lifecycle — keep it the single
  definition of "empty" (all three channels: `current`, `rows`, `columns`).
- The outside-click listener's attach/detach is driven by selection emptiness — a
  future feature that creates a selection WITHOUT going through `set({ selection })`
  (there is none today; every path replaces the selection object) would leak the
  listener. The store-subscription design exists precisely so that can't happen.
- Reviewers: `onSelectionCleared` fires on ANY clear path by design (the spec names
  the outside click, but a consumer's "reset chip" must also reset when the user
  clears via the gutter or a toolbar button) — do not narrow it in review.
