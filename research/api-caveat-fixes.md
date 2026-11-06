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

## Not done: the pagination wave (F1, F4, F5, F18) and F14

These need one coherent change; none of it is started in code. Spec for the next session:

**F1, paginate the view.** Provider props `page`, `pageSize` (controlled pair with `onPageChange` / `onPageSizeChange`, plus `defaultPage`, `defaultPageSize`). The store keeps the full sorted and filtered list and exposes the `[page*size, +size)` window as `viewIndex`; a module-level `WeakMap` maps a windowed array to its full list (`fullViewOf`) so the 9 `computeViewIndex` / `incrementalViewIndex` call sites (`create-store.ts` 1037, 1636, 1652, 1670; `data-write.ts` 238, 241, 273; init at 678) change by one argument. A filter or search change resets to page 1; the page clamps when the total shrinks. `reorderRows`, `insertRow` positions and `moveRows` treat an active window like an active sort. A hook `useDataGridPager()` inside the provider returns `DataGridPaginationControls` from the store (total from `fullViewOf(viewIndex).length`), and `DataGridPaginationBar` reads it when spread no props. Open design question: quick search computes matches over `viewIndex`, so with a window it sees the current page only; the fix is to compute matches over the full list and jump the page on "next match".
Capabilities to keep: controlled page, page size options, the pager math (`pagination-math`), `pageData`-style slicing for people who paginate themselves (`useDataGridPagination({ data })` stays until the provider path ships, then is removed with a **Breaking** entry).

**F5 and F4.** Split `useDataGridPagination` server mode into `useDataGridServerPager({ page, pageSize, totalRowCount, hasMore, ... })` returning `{ pager }`; point every server doc at `useDataGridServerRows`; give `useDataGridUrlPagination` the same controlled pair (it has it). Call sites: 7 demos, 4 recipe pages, 3 skills.

**F18.** `DataGridPaginationControls.hasNextPage` becomes `hasMore` (pager spread onto `DataGridPaginationBar`, `useDataGridServerRows` passes `hasMore`); document the `totalRowCount` `undefined` / `null` table once in `GLOSSARY.md`.

**F14.** A `RowActionResult = { ok: true } | { ok: false; reason }` returned by `deleteRows`, `insertRow`, `duplicateRows`, `reorderRows`, `moveRows`; reasons: `"readOnly" | "unloaded-rows" | "view-active" | "gate-pending" | "no-factory"`. Menu items and shortcuts show disabled for the same reasons. Land the reasons first (return values only), then the gating.

## Opus review of the whole diff: findings taken
- A cell click without `keepCheckedRows` now releases remembered ids and "all matching" (`releaseRemembered`); test added.
- `verify-barrel-exports` had a backspace in its regex (nothing matched); fixed, baseline regenerated (now almost empty).
- `parseServerSpec`: limits that are `undefined`, `NaN` or negative fall back to the default; error text no longer echoes a long operator; own-property check for `filters`.
- `gateTimeoutMs` ignores non-finite values, clamps to the timer maximum, and takes a per-gate map (`number | Partial<Record<GateName, number>>`); Escape reports `"cancelled"`.
- `IMPORT_CANCELLED_MESSAGE` stays exported (callers tell a cancel from a failure by it); the changelog no longer lists it as removed.
- Not taken: a one-time dev warning when the F3 default applies and no `onSortChange` is handled; cycle guard in `sameLabels` (labels are plain data); row index cache in the dev-only `record` check.
