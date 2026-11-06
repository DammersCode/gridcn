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
