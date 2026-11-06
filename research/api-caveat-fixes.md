# API caveat fixes for 2.0

Implements `research/api-caveat-audit.md` under the API principles in `AGENTS.md`. One entry per finding: what changed, the decision, and the
capability check (before / after).

## Capabilities

### F2 (done)
- Before: checked ids survived a page change only with `keepCheckedRows` and `totalRowCount`; a client filter hid-and-remembered checks only with `keepCheckedRows` and `keepHiddenCheckedRows`.
- After: `totalRowCount` alone turns on the id memory. `rememberCheckedRows` (`true` / `false`) overrides it in both directions, on client and window grids. `keepHiddenCheckedRows` stays as a deprecated alias. `keepCheckedRows` keeps only its row-operation meaning. Nothing is removed.
- Docs warning removed: "pass `keepCheckedRows` together with `totalRowCount`".

### F7 (done)
- Before: every server caller hand-wrote the bound check for the filter tree. After: `parseServerSpec` does it; callers still can set `limits`, per-column `operators`, `customOperators`, `sortable`, `filterable`, and can skip the function and check by hand. Nothing is removed.
- Docs warning removed: "Validate the column ids" (drizzle). Kept: cap the body size (the library cannot see the raw text).

### F3 (done)
Options compared:
- A. New `serverSpec` boolean (audit proposal). A third name for what `sortMode` and `filterMode` already say; callers who want only server sort would still need the pair.
- B. `totalRowCount` implies both modes, the pair stays as overrides. Fits every fetch style: React Query / SWR / plain fetch / tRPC / REST pages and cursor sources all pass the count of the result (or `null`), URL state restores a spec into a grid that already holds it, GraphQL cursors pass `null`. A source with no count at all (rare) sets the pair by hand, as before.
- C. Derive from the data holding holes. Cannot cover a page of a server result, which has no holes.
Decision: B. `sortMode="client"` / `filterMode="client"` still sort or filter a window locally (a valid use: a small prefetched window with a cosmetic local order).
- Capabilities: before, set the pair by hand; after, same, plus the default. Nothing removed.
- The `DataGridUrlState` development warning of the audit is covered by the existing hole guard (`hole-view-guard.ts`); the two url-state callouts are removed, since the trap is gone for any grid that declares `totalRowCount`.

### F8 (done)
`getRowId` defaults to `defaultGetRowId` (the core default) in both hook modes; a custom function still wins. A row with no id throws, which is stricter than the audit's dev warning and matches the core. Nothing removed.

### F12 (partly done)
- Done: `isPlaceholderRowId`, `getViewRowIds({ loaded: true })`; the server demo no longer matches a `"__"` prefix. The default of `getViewRowIds()` is unchanged (placeholders included), so every old caller keeps working.
- Open: the "reason on silent skips" half of F12 belongs to F14 (see below).

### F6 (done)
- Removed from barrels: the operator trio (toolbar), five io helpers, six keybinding helpers. Kept the names the docs now teach (presence, lookup, pinned rows, fill, find-replace, status bar), which the audit listed from an older docs state.
- Capability: a consumer who imported a removed helper can import it from its file (the registry installs every file). `scripts/verify-barrel-exports.mjs` (in `pnpm lint`) blocks new undocumented barrel values; today's gaps are grandfathered in `scripts/barrel-exports-baseline.json`.

### F10 (done)
`source: "indexed" | "cursor"` on scroll mode; default stays "from the first answer". The docs sentence that disagreed with the code is rewritten (the code reading is right: no count and no cursor is sequential, `hasMore` defaults to a full block). The warn callout is removed.

### F17 (decided: no grouping, clamp already holds)
`revalidateInterval` and `reshapeDelay` already clamp to their minimum (`fetch-hygiene.ts`); the dev warning only says so. Grouping the three live options into `live: {}` would rename 33 source lines, 4 test files, 6 docs pages and the skills for a naming gain, not a trap fix. Kept flat. Capabilities unchanged.

### F22 (done)
`record()` warns in development when an inserted row id is already in `data`; the docs callout is shortened and stays (production stays silent, so the trap is only detected, not removed). The return value stays `void`: `record` is fire-and-forget by design.

### F11 (decided: no code change)
The hook already composes: its `onDataChange` option runs after the merge (pages and scroll). Only a provider-level override of `gridProps.onDataChange` drops the merge, and the core cannot tell a hook-owned `data` from a plain one. The JSDoc already points callers to the hook option. A scroll-mode dev warning exists for evicted edits. No capability change.

### F13 (decided: no default createRow)
- The cell menu items and the shortcuts already hide without `createRow` / `duplicateRow` (`cell-menu-content.tsx`, `use-grid-interaction.ts`); the import dialog's `createRow` is a required prop, so a missing one fails in the editor, not silently.
- A default `createRow` would return `{}`: such a row has no `id`, so the default `getRowId` throws on it. Declined for type safety; callers keep full control of the base row. The "createRow is required" callout is now a plain sentence.

### F16 (partly done)
- Done: `labels` is compared by content (`sameLabels`); the i18n callout becomes a sentence.
- Kept: the two class-name function warnings (cost is real), `topRows`/`bottomRows` stability (rows are arbitrary objects, so a structural compare costs more than the render it saves), `fetchOptions` cache key (the cache is keyed by the function on purpose). Their callouts stay, shortened where possible.

### F19 (done)
Default off (a gate waits as before). `gateTimeoutMs` aborts the signal, cancels the action, and frees the next action; `onGateAborted` reports timeout, changed, superseded, and reset, so silent drops have a hook. Capability: unchanged unless the caller opts in. The "never settles blocks every later delete" callout becomes a sentence naming the opt-in fix.

### F15 (done, reviewed)
- Design: `onSave` + `refreshAfterSave` (`"settled"` default | `"each"` | `false` | function of `{saved, rejected, failed}`); `refresh()` always available; `gridProps.onSave` exists only when the hook got one. A reviewer (Opus) challenged it; changes taken: a void-returning `onSave` never refreshes (the grid cannot know when the server has it), a 10 s max wait so one stuck save cannot starve the refresh, no refresh when every save failed (outage), cursor scroll sources skip a refresh beyond the revalidate bound, docs fixed.
- Left for later (reviewer should-fix): drive "settled" from the guard's `onSavesSettled` signal (async `resolveSaveConflict` can outlive the timer), merge with the structural-settle refresh in counted scroll mode, a richer policy report (`pending`, per-change results), a dev warning when `{...gridProps}` is followed by an own `onSave`.

### F20 (done)
The sort arrow shows for any active sort (URL sorts are visible); the context-menu callout is a sentence (the provider hook already throws an error that names the fix). The `NuqsAdapter` nesting note stays: nuqs owns that behavior.

### F9 (decided: keep one hook with a fixed mode)
Splitting into `useDataGridServerPages` / `useDataGridServerScroll` would rename a hook that every server doc and demo uses, for a case that is a demo toggle. The existing dev warning names the fix (remount with a key). The two lint disables stay. No capability change either way.

### F21 (skipped)
Low value, touches the context-menu resolver contract; only worth doing together with a change to that file.

### F14 (not done)
One shared `{ ok: false, reason }` result for every mode-dependent row action touches a dozen actions, their menu and shortcut gating, and the return types. Not started; spec below.

## The pagination wave (F1, F4, F5, F18) and F14: done

**F1, paginate the view.** `DataGridProvider` takes `pageSize` / `defaultPageSize`, `page` / `defaultPage`, `onPageChange`, `onPageSizeChange`; `actions.setPage` / `setPageSize`. The store keeps the full sorted and filtered list; `viewIndex` holds the shown page and `fullViewOf(viewIndex)` returns the full list (a module `WeakMap`, so the 9 view-building call sites changed by one argument). A filter change goes back to page 1 and calls `onPageChange(1)`; a page past the end shows the last. `reorderRows`, inserts, and deletes treat a page like an active sort. The pager comes from `useDataGridPager()`; `<DataGridPaginationBar />` with no props reads it. Aggregates (`useDataGridAggregate`, scope view) and `exportGrid` (scope view) read the full view.
- Capabilities kept: controlled page and size, size options, the pure math, `useDataGridPagination({ data })` for a list outside the grid (client-only now), server paging through `useDataGridServerPager` / `useDataGridServerRows`, a bar spread with `{...pager}` outside the provider.
- Known limit (a sentence in `pagination.mdx`, no callout): quick search marks matches on the current page only; the filter menu searches every page. Cross-page match navigation needs matches over the full view plus a page jump.
- The four client-pagination callouts are gone (merge step, page-local sort/filter/search, selection drops, streaming skips); selection across a page change keeps what stays on screen, one bullet.

**F5, F4.** `useDataGridPagination` lost the `"data" in options` union: server mode is `useDataGridServerPager` (returns `{ pager }`). Without `onPageSizeChange` the bar hides the page-size select instead of dropping the change with a warning. `useDataGridUrlPagination` returns the pair `DataGridProvider` and `useDataGridServerPager` both accept; page reset on filter change is automatic for the provider path and in `useDataGridServerRows`. Type names `UseDataGridPaginationClientOptions` / `UseDataGridPaginationServerOptions` stay, because `scripts/verify-parity.mjs` (not mine to touch) reads them; the docs session can rename them with that script.

**F18.** `hasNextPage` is `hasMore` on the pager and the server pager options. The `totalRowCount` `undefined` / `null` table is not added to the glossary (the existing "row count" row covers `null`).

**F14.** `insertRow`, `insertRows`, `duplicateRows`, `deleteRows`, `deleteRowsById` return `RowActionResult` (`{ ok: true }` or `{ ok: false, reason }`, seven reasons) instead of nothing. Not done: disabled menu items for the same reasons (the menu already hides items without `createRow`/`duplicateRow`), and `reorderRows` / `moveRowsBy` keep their boolean. The return type widens from `void`, so no caller breaks.

## Opus review of the whole diff: findings taken
- A cell click without `keepCheckedRows` now releases remembered ids and "all matching" (`releaseRemembered`); test added.
- `verify-barrel-exports` had a backspace in its regex (nothing matched); fixed, baseline regenerated (now almost empty).
- `parseServerSpec`: limits that are `undefined`, `NaN` or negative fall back to the default; error text no longer echoes a long operator; own-property check for `filters`.
- `gateTimeoutMs` ignores non-finite values, clamps to the timer maximum, and takes a per-gate map (`number | Partial<Record<GateName, number>>`); Escape reports `"cancelled"`.
- `IMPORT_CANCELLED_MESSAGE` stays exported (callers tell a cancel from a failure by it); the changelog no longer lists it as removed.
- Not taken: a one-time dev warning when the F3 default applies and no `onSortChange` is handled; cycle guard in `sameLabels` (labels are plain data); row index cache in the dev-only `record` check.

## Opus review of the pagination wave: findings taken
- The pager no longer clamps at total 0 (a deep link survives an async load).
- A page change re-slices the stored full view unless the view is stale (no re-sort for a page click).
- A filter set through props reports `onPageChange(1)` (after the write).
- Capability opt-outs: `scope: "page"` on `exportGrid`, `printGrid`, `useDataGridAggregate`; `setPageSize(null)` turns paging off.
- The bar props are a union (all controls or none), so `page` without handlers no longer type-checks.
- Not taken: moving the clamp into the store (the effective page already clamps the view; the stored page catches up when a pager is mounted); a mixed-state fix for a half-controlled `setPageSize`; following the active record across a page change; reorder across a page (still blocked, now with a warning that names the page; row order inside a page is not stable against the full list); cross-page select all for client paging (needs `selectAllMatching` without `totalRowCount`).

## API scorecard (0-10)

Rubric. **Common**: the common case takes few lines. **Cap**: capability preserved (default + override + manual equivalent + policy hook). **Rules**: matches the AGENTS.md API rules (options object, ctx callbacks, controlled pairs, positive booleans). **Name**: names match the glossary and neighbors. **Types**: invalid use is hard to write. **Docs**: docs page and demo cover it. **Trap**: needs no warning callout and has no silent failure. Score is a judgment by the author and the two Opus reviews; the average is rounded down.

| API | Common | Cap | Rules | Name | Types | Docs | Trap | Avg |
|---|---|---|---|---|---|---|---|---|
| `rememberCheckedRows` (+ alias, `keepCheckedRows` split) | 9 | 9 | 8 | 8 | 9 | 8 | 8 | 8 |
| `totalRowCount` implies server `sortMode`/`filterMode` | 9 | 9 | 8 | 9 | 9 | 8 | 8 | 8 |
| `parseServerSpec` + `ServerSpecError` | 9 | 9 | 9 | 9 | 9 | 8 | 9 | 9 |
| `getRowId` optional in the server hook | 10 | 9 | 9 | 9 | 9 | 8 | 9 | 9 |
| scroll `source: "indexed" \| "cursor"` | 9 | 9 | 9 | 8 | 9 | 8 | 8 | 8 |
| `isPlaceholderRowId`, `getViewRowIds({ loaded })` | 9 | 9 | 9 | 8 | 9 | 8 | 9 | 8 |
| `onSave` + `refreshAfterSave` (hook) | 9 | 8 | 8 | 8 | 8 | 9 | 7 | 8 |
| `labels` compared by content | 10 | 9 | 9 | 9 | 9 | 8 | 8 | 8 |
| `gateTimeoutMs`, `onGateAborted` | 9 | 9 | 9 | 8 | 9 | 8 | 9 | 8 |
| sort arrow for any active sort | 10 | 8 | 9 | 9 | 9 | 8 | 9 | 8 |
| `history.record` duplicate-insert warning | 8 | 8 | 8 | 8 | 8 | 8 | 6 | 7 |
| paged view (`pageSize`, `page`, `setPage`, `setPageSize`) | 9 | 8 | 8 | 8 | 8 | 9 | 6 | 8 |
| `useDataGridPager`, bar reading the provider | 9 | 9 | 8 | 7 | 9 | 8 | 8 | 8 |
| `useDataGridServerPager`, `hasMore` | 9 | 9 | 9 | 9 | 9 | 8 | 9 | 9 |
| `RowActionResult` returns | 9 | 9 | 8 | 8 | 9 | 8 | 7 | 8 |
| `useDataGridServerRows` (pages, cursor pager, scroll) | 9 | 9 | 8 | 8 | 8 | 9 | 7 | 8 |
| `scope: "page"` on export, print, aggregate | 9 | 9 | 8 | 8 | 9 | 7 | 9 | 8 |
| barrel lint (`verify-barrel-exports`) | 9 | 8 | 8 | 8 | n/a | 7 | 8 | 8 |

Below 8 after scoring: `history.record` warning (7) and, per criterion, the Trap column of the paged view (6), `RowActionResult` (7), `onSave` refresh (7), `useDataGridServerRows` (7), and the Name of `useDataGridPager` (7).

Changes made because of the scoring:
- The F3 default flip is no longer silent: in development the grid warns once when `totalRowCount` makes sorting and filtering server-side and nothing handles `onSortChange` or `onFilterChange` (Trap 6 to 8). The server hook sets the modes explicitly and never triggers it.

What stays under 8 and why (each needs more than a local fix):
- **Paged view, Trap 6:** quick search marks matches on the current page only; `reorderRows` is blocked while a page is active. Cross-page matches need match computation over the full view plus a page jump.
- **`history.record`, Trap 6:** production stays silent; making `record` idempotent for an already-applied insert needs a change to the grid's commit path.
- **`RowActionResult`, Trap 7:** menus and shortcuts do not show a disabled state with the reason yet.
- **`onSave` refresh, Trap 7:** the policy reacts to the `onSave` promise, not the grid's own settle signal; an async `resolveSaveConflict` can outlive the refresh. A dev warning for `{...gridProps}` followed by an own `onSave` is missing.
- **`useDataGridServerRows`, Trap 7:** the mode is fixed per hook (dev warning, remount with a key); a provider-level `onDataChange` override drops the merge.
- **`useDataGridPager`, Name 7:** it returns the controls while `useDataGridServerPager` returns `{ pager }`.
