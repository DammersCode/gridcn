# Spec: screen-reader announcements for checked rows and result counts

Issue #87.

## Goal

- After a row check (keyboard or pointer) the grid's live region announces the checked-row
  total ("N rows checked"). Today a screen reader only gets per-row signals, never the range.
- Optionally, after a filter or sort commit, the region announces the view's
  row count ("N rows"). Opt-in prop; skipped while `sortMode="server"` (the grid does not hold
  every row, so the count would mislead).
- One debounced live region carries everything; rapid consecutive writes collapse into the
  last announcement (marker range drag, fast filter changes). No new region.

## Decisions

1. **The existing region is the one region, one latest-wins slot.** `DataGridBody` already
   portals an `aria-live="polite" role="status"` div (body.tsx). The store holds a single
   `liveAnnouncement` field: the latest of a row move, a row check, or a result count. Each
   write replaces the text, so a later announcement never accumulates beside an earlier one
   (accumulating three "last value" strings made the region read a stale check count together
   with a later move). The existing `rowMoveAnnouncement` field is kept for
   `useDataGridRowMoveAnnouncement` and is written alongside `liveAnnouncement` on a move. The
   displayed text is trailing debounced (500 ms). Consequence: row-move announcements are
   debounced the same way — a shipped-behavior change that gets a changelog entry.
2. **Checked-count is default-on core a11y; result-count is opt-in.** New boolean prop
   `announceResults` (default `false`), following the `keepCheckedRows` prop flow
   (`DataGridSyncProps` → `InternalSyncProps` → init → `_syncConfig`, listed in the provider's
   `CONFIG_KEYS` so a dropped prop syncs `false`).
3. **Write points.**
   - Checked count: the three row-check actions — `selectRow`, `setRowSelected`,
     `setAllRowsSelected` — write `liveAnnouncement` only on a real channel change (the
     existing no-op early returns stay quiet). Programmatic `setSelection`, `clearSelection`,
     and data remaps do not announce: they are not a user's check gesture.
   - Row move: `applyRowMoves` writes `rowMoveAnnouncement` and `liveAnnouncement` together.
   - Result count: one store subscription in `createDataGridStore` on a
     `filterState`/`sortState` value change writes `liveAnnouncement`
     (`state.viewIndex.length`). One site catches both the uncontrolled action writes and the
     controlled `_syncProps` recompute; the view is settled in the same write as the spec
     change (`resetDeferredRows`), so the read count is final.
4. **Labels.** `labels.grid.rowsChecked(count)` and `labels.grid.resultsCount(count)`;
   defaults "N rows checked" / "N rows" with singular/plural.
5. **No new public surface** beyond the prop, the label keys, and `useDataGridLiveAnnouncement`
   (store barrel only, not the block barrel), which reads `liveAnnouncement`;
   `useDataGridRowMoveAnnouncement` is unchanged.

## Behavior

- `toggleRow` (Ctrl+Shift+Space), `toggleAllRows` (Mod+Shift+E), the marker checkbox, and the
  marker range drag all announce "N rows checked"; the drag's per-frame writes collapse to the
  final count via the debounce.
- Filter/sort/join commits announce "N rows" only with `announceResults`; a lazy source's count
  covers the loaded rows (docs note).
- Quick search (`setSearch`) never touches the region; the toolbar search box owns its own
  match-count region and quick-search filters nothing.
- The debounce is one trailing timer owned by the region component; it clears on unmount.

## Files

- `labels.ts` — `rowsChecked`/`resultsCount` in `DataGridGridLabels` + defaults.
- `store/types.ts` — `announceResults` prop + `liveAnnouncement` state (next to
  `rowMoveAnnouncement`).
- `store/create-store.ts` — init + `_syncConfig` for `announceResults`; the three actions and
  the subscription write `liveAnnouncement`.
- `store/data-write.ts` — `applyRowMoves` writes `rowMoveAnnouncement` + `liveAnnouncement`.
- `store/hooks.ts` + `store/index.ts` — `useDataGridLiveAnnouncement`, store-barrel export.
- `store/provider.tsx` — `announceResults` in `CONFIG_KEYS`.
- `body.tsx` — the region reads `useDataGridLiveAnnouncement`, debounced.
- Docs: `accessibility.mdx` (Live regions section), the provider props reference
  (`announceResults` row), `selection-keyboard.mdx` (one sentence under "Checking rows by
  keyboard").
- Tests: unit — the actions write the checked-count text (and the no-ops stay quiet), the
  subscription fires on filter/sort/join (client mode, `announceResults` on, both uncontrolled
  and controlled paths), stays quiet on `setSearch` and `sortMode="server"`; browser — the
  region text after a keyboard check and after a filter with `announceResults`.
- `CHANGELOG.md` under `Unreleased`.
