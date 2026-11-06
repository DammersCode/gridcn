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
