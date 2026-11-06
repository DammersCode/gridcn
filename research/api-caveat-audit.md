# API caveat audit for 2.0

Status: findings and proposals, nothing implemented. Goal: a caller learns no rule that the library could
absorb. Ranked by value. Severity: **S1** traps that give silent wrong data or lost state, **S2** needless
ceremony every caller repeats, **S3** a docs-only warning for a trap the library could remove.

Paths are relative to the repo root. Block paths drop the `registry/default/blocks/` prefix. Cost: S under a day, M
a few days, L a week or more. "Breaking" is measured against the current 2.0 branch; an item that touches only
unreleased behavior is not breaking.

Method: `CHANGELOG.md` (`## Unreleased`), every `<Callout type="warn">` and "only/must/do not" sentence in
`content/docs`, JSDoc coupling words in the block option types, the barrel exports checked against
`content/docs` by script (204 of the non-core barrel names never appear in the docs), and the server demos.
Related decisions already made: `research/api-cohesion-2.0.md` (names and shapes of the server surface).

## Ranked findings

### F1. Client pagination slices `data`, so sort, filter, search, totals, and streaming are page-local — S1

- Where: `content/docs/pagination.mdx:49-80` (four warn callouts), `content/docs/addons/pinned-rows.mdx:126`,
  `data-grid-pagination/use-data-grid-pagination.ts` (client mode returns `pageData`).
- Caveat: `useDataGridPagination({ data })` hands the grid only the current page. A search matching rows on other pages
  finds nothing, a column sort orders one page, an aggregate band sums one page, a stream patch for another page skips
  silently, and `onDataChange` sees a slice that overwrites the full dataset when set wholesale. None of it errors.
- Fix: paginate the view, not the data. The grid keeps the full `data`, sorts and filters it, and renders the
  `[page*size, +size)` window of `viewIndex`. The provider takes `page` and `pageSize` (or the hook returns
  `gridProps` to spread). `pager` stays as is. Four callouts and the merge step disappear.
- Breaking: yes (`pageData` goes away; `data` is the whole array). Cost: L (view index, row window, selection
  anchors, ARIA row counts). Owner decision: this is the largest single trap in the client path.

### F2. Three selection props that must be set together, and the doc of one is wrong — S1

- Where: `data-grid/store/types.ts:186` (JSDoc still says `keepCheckedRows` is "`true` while `totalRowCount` is set";
  `data-grid/store/compute.ts:904` says `?? false`), `types.ts:188-195`, `data-grid/store/hidden-checked-rows.ts:20-28`,
  `data-grid/store/create-store.ts:262,1470`, `content/docs/selection-keyboard.mdx:174`,
  `content/docs/recipes/data-fetching/server-side.mdx` ("Selection and bulk actions"),
  `content/docs/lazy-loading.mdx:390`, `CHANGELOG.md:48`.
- Caveat: checks survive a page change only with `keepCheckedRows` **and** `totalRowCount`. `selectAllMatching` is a
  dev-warn no-op without both. `keepHiddenCheckedRows` works only with `keepCheckedRows`, client sort, client filter, and
  loaded rows. `useDataGridServerRows` sets the first two; the client pager does not (`pager.totalRowCount` is passed by hand).
- Root cause: `keepCheckedRows` bundles two meanings: (a) remember checked ids that leave `data`, (b) cell clicks keep
  the checks and row operations act only on checked rows. The 2.0 break removed the derivation because (b) surprised
  people who only declared a count. Now (a) needs a flag that also switches on (b).
- Fix: `totalRowCount` alone turns on (a) (id memory is harmless). `keepCheckedRows` means only (b). Fold
  `keepHiddenCheckedRows` into (a): any grid that remembers checked ids also remembers rows a client filter hides
  (they already stay out of every action). One prop left to learn: `keepCheckedRows`.
- Breaking: no against the unreleased state. Cost: S-M. Safe before 2.0. Fix the JSDoc at `types.ts:186` today either way.

### F3. A scroll-mode source needs `sortMode` and `filterMode` "server", and nothing checks it outside the hook — S1

- Where: `content/docs/addons/url-state.mdx:159`, `content/docs/lazy-loading.mdx:327,341`,
  `content/docs/recipes/data-fetching/server-side.mdx:24,217`, `data-grid-url-state/use-data-grid-url-state.ts`
  (no read of `sortMode`/`filterMode`).
- Caveat: with a hand-wired lazy or paged source, a URL-restored spec sorts and filters the partial data in the
  browser. "The result is wrong, and the grid shows no error." The hook sets both modes, so only hand wiring hits it.
- Fix: one prop replaces the pair: `serverSpec` (boolean, or `dataSource="server"`) sets sort and filter to server in one
  place, and `totalRowCount` implies it when a source declares a window (a window of a result cannot be sorted locally
  without being wrong). `DataGridUrlState` warns in development when the data holds holes or a window and a mode is client.
- Breaking: additive if `sortMode`/`filterMode` stay as overrides. Cost: S-M. Safe before 2.0; the owner picks whether
  `totalRowCount` implies server modes.

### F4. Two ways to page from a server; the manual one has a per-caller checklist — S1/S2

- Where: `content/docs/recipes/data-fetching/server-side.mdx:22-60` (contract steps),
  `content/docs/pagination.mdx:286` ("Reset to page 1 when filters or search change"),
  `data-grid-pagination/use-data-grid-pagination.ts:62-70,123-139`, `content/docs/addons/url-state.mdx:145`.
- Caveat: `useDataGridPagination` server mode makes you own page, page size, count, the fetch, the race guard, the reset
  to page 1 on a spec change, `onPageSizeChange` (omitted: the size change is dropped with a dev warning, line 123), and
  the two server modes. `useDataGridServerRows` does all of it. Both are public, and the docs teach both.
  `useDataGridUrlPagination` cannot reset the page on a filter change because it does not know the filters.
- Fix: one server path. Keep server mode of `useDataGridPagination` only as the pager math (rename the options doc as
  "pager for your own data layer") and point every server doc at `useDataGridServerRows`; give the hook a `page`/`pageSize`
  controlled pair that `useDataGridUrlPagination` plugs into (it already has them). Let the hook reset to page 1 for a
  controlled `page` too (it does, via `onPageChange(1)`), and state it once.
- Breaking: no (docs and one removed section). Cost: S. Safe before 2.0.

### F5. `useDataGridPagination` picks its mode by `"data" in options` — S1

- Where: `data-grid-pagination/use-data-grid-pagination.ts:62-70` (`isServerOptions`), `:71` (`INERT_SERVER_OPTIONS`).
- Caveat: client mode is chosen by the key's presence. `{ data: undefined, ... }` while rows load, or a spread of an
  options object that carries `data` next to server keys, silently switches mode. It also runs both modes' hooks every render with inert inputs.
- Fix: two hooks, `useDataGridPagination({ data })` and `useDataGridServerPager({ page, pageSize, totalRowCount, ... })`, or a
  discriminant (`mode`). Two hooks remove the inert-input hack and the union that TypeScript 5.9 and 7 infer differently.
  If F1 lands, the client hook shrinks to `pager` state and this goes away.
- Breaking: yes for server users (rename). Cost: S. Do it with F1 or F4.

### F6. Unexported-but-barreled helpers that nothing teaches — S3 (registry rule)

AGENTS.md "Registry exports" says export only what the docs teach. Script result (names missing from `content/docs`), outside
`data-grid-sdk` and types:

| Barrel | Names to take off the barrel or teach |
|---|---|
| `data-grid-toolbar/data-grid-toolbar.ts:7` | `operatorsForColumnType`, `operatorLabel`, `operatorHasValue` |
| `data-grid-keybindings/data-grid-keybindings.ts` | `KEYBINDING_CATEGORIES`, `ACTION_CATEGORY`, `categoryForAction`, `categoryLabel`, `labelForAction`, `KeybindingCategory` |
| `data-grid-io/data-grid-io.ts` | `buildExportHeaders`, `quoteCsvField`, `downloadBlob`, `IMPORT_CANCELLED_MESSAGE`, `IMPORT_PREVIEW_ROW_COUNT` |
| `data-grid-presence/data-grid-presence.ts` | `MAX_RESOLVED_RECTS`, `isRowIdPresenceHighlight`, `isRowIdRangePresenceHighlight` |
| `data-grid-status-bar/data-grid-status-bar.ts` | `MAX_STATUS_CELLS` |
| `data-grid-fill/data-grid-fill.ts` | `detectSeries`, `SeriesDescriptor` |
| `data-grid-find-replace/data-grid-find-replace.ts` | `planReplace` |
| `data-grid-lookup/data-grid-lookup.ts` | `lookupCellType` (check: it is the add-on's API, the docs may use a different name) |
| `data-grid-pinned-rows/data-grid-pinned-rows.ts` | `PENDING_SERVER_AGGREGATE` |

The same script lists 109 `data-grid-sdk` names and about 50 types (`*Props`, `*Result`, `*Options`, `ServerRowsRequest`,
`ServerRowsAnswer`, `UseDataGridServerRowsOptions`) with no docs mention. `docs/project-status.mdx:21` calls `data-grid-sdk`
non-public, which makes it a fair internal entry; the server and pagination types are public and should appear in the
docs' type tables. The check was a throwaway script (barrel names against `content/docs`); port it to
`scripts/verify-source-rules.mjs` so the rule is enforced, not remembered.

- Fix: remove the value names above from the barrels (breaking: low, nobody is taught to import them) and add a lint check.
- Cost: S. Safe before 2.0 (2.0 is the moment to remove exports).

### F7. Every server caller repeats the spec-to-query mapping and hand-writes the untrusted-input check — S1/S2

- Where: `content/docs/examples/data/server-side.mdx` ("Notes": depth 2, 16 groups, 64 rows, allowed columns, `join` values),
  `content/docs/examples/data/orm/drizzle.mdx:108` ("Validate the column ids"), `registry/default/examples/data-grid-server-side-demo.tsx`
  (`filters as RemoteFilterNode[]` cast in `fetchRows`), the ORM recipes.
- Caveat: the filter tree reaches the backend as untrusted JSON. Each caller must re-implement the bound check. A missed check
  is an injection or a denial of service. The cast in the demo hides the type gap.
- Fix: ship a pure, React-free `parseServerSpec(input, { columns, limits? })` that returns a bounded, typed `ServerSpec`
  or throws, from `data-grid-server`. The docs line becomes one call. This is the secure-first item and removes the most copied code.
- Breaking: no (addition). Cost: M. Coordinate with the ORM layer spec session. Safe before 2.0.

### F8. `getRowId` is required by the server hook and optional in the core — S2

- Where: `data-grid-server/use-data-grid-server-rows.ts:22,98`, `data-grid-server/scroll-blocks.ts:21,79`; the core default is
  `row.id` (`data-grid/store/types.ts:91,549`). All nine server demos write `getRowId: (row) => row.id`.
- Fix: make it optional with the core default (same function, so merges and the grid agree). Dev-warn once on a row with no string/number `id`.
- Breaking: no. Cost: S. Safe.

### F9. `mode` is fixed for the life of the hook; callers remount with `key` — S2/S3

- Where: `data-grid-server/use-data-grid-server-rows.ts:20,149,157` (dev warning), `data-grid-server/scroll-blocks.ts:19`;
  the server demo splits `PagesGrid` and `ScrollGrid` for it. The hook also calls different hooks per mode (the `useScrollBlocks`/`usePagesRows` ternary near line 160, with two lint disables).
- Fix, cheapest first: (1) accept it and keep the warning (the case is rare: it is a demo toggle); (2) split into
  `useDataGridServerPages` and `useDataGridServerScroll` so "fixed" holds by construction and the overloads and lint disables go.
  Option 2 is cleaner for types (no overload on `mode`) and tree-shaking, and costs a rename that is free before release.
- Breaking: option 2 only against the unreleased hook. Cost: S-M. Owner decision (the merged hook was a deliberate 2.0 choice).

### F10. Answer rules that the caller must know to avoid a stuck or short list — S1

- Where: `content/docs/lazy-loading.mdx:124` ("An answer without `totalRowCount` ends the source at the rows of the first
  block, unless it carries `nextCursor` or `hasMore`"), `data-grid-server/scroll-blocks.ts:23-28`,
  `data-grid-server/read-answer.ts:25-33`.
- Caveat: the fetch order (random access or sequential) is chosen by the shape of the **first** answer. Leaving out the count on one answer
  changes how the whole list behaves. The docs callout and the JSDoc disagree ("neither: sequential, `hasMore` defaults to a full
  block" in code; "ends at the first block" in docs). One of them is wrong; the code reading is what a user gets.
- Fix: make the source kind explicit and obvious: option `source: "indexed" | "cursor"` (default from the first answer, as now), with a dev
  warning when an indexed source answers without a count. Fix the docs sentence now.
- Breaking: no. Cost: S. Safe.

### F11. `onDataChange` in `gridProps` merges edits; a later spread or prop drops the merge — S1

- Where: `data-grid-server/use-data-grid-server-rows.ts:49,96-98` ("Put your handler here; a spread override drops the merge"),
  `data-grid-server/scroll-blocks.ts:70`.
- Caveat: `<DataGrid {...server.gridProps} onDataChange={mine} />` loses the keep-in-step merge, and edits vanish on the next render.
- Fix: the grid composes: `gridProps` carries the merge under a key the provider chains with the caller's `onDataChange`
  (`onDataChange` is called after the merge), or the provider warns when `data` comes from a hook and `onDataChange` is replaced. Smallest: name
  the merge `onServerRowsChange` in `gridProps` and let the provider call both.
- Breaking: no. Cost: S-M. Safe.

### F12. Placeholder row ids leak into caller code — S1/S3

- Where: `registry/default/examples/data-grid-server-side-demo.tsx:102` (`id.startsWith("__")`), `content/docs/api-reference.mdx:52`,
  `content/docs/lazy-loading.mdx:398` (`__lazy-unloaded-<index>`), `CHANGELOG.md:30` (`deleteRows`/`insertRow`/... do nothing on unloaded
  rows; "leave the placeholder ids out").
- Caveat: callers filter ids by a string prefix to avoid holes, and a few row operations silently do nothing near holes.
- Fix: export `isPlaceholderRowId(id)` (or make `getViewRowIds({ loaded: true })` / `getLoadedRowIds()` exist) and teach it; every
  hole-affected action returns `false` or a reason, not silence (as `reorderRows` already does).
- Breaking: no. Cost: S. Safe.

### F13. Row actions that silently need a prop — S2

- Where: `data-grid/store/data-write.ts:1374` (`insertRow` no-op without `createRow`), `:1429` (`duplicateRows` without `duplicateRow`),
  `content/docs/global-shortcuts.mdx:91`, `content/docs/addons/import-export.mdx:304` ("createRow is required"),
  `data-grid/root.tsx:155` (header dropdown needs a non-`none` `rowMarkers`).
- Fix: hide the shortcut, menu item, and button when the prop is missing (the item is not offered, so no dead control); give `createRow` a default
  of "an empty object with the column defaults" for flat rows; the import dialog builds its base row from the columns when `createRow` is absent.
- Breaking: no. Cost: M. Safe for the menu and shortcut hide; owner decision for a default `createRow` (type safety).

### F14. The same row action behaves differently by mode, silently — S1

- Where: `data-grid/store/data-write.ts:1009` (`reorderRows` no-op under any sort or filter), `:1031` (with holes),
  `content/docs/row-operations.mdx:138-156`, `content/docs/selection-keyboard.mdx:212` (row operations skip checked rows while `allMatching`),
  `content/docs/addons/fill.mdx:157` (a fill stops at loaded rows), `content/docs/clipboard.mdx` (paste over holes), `content/docs/addons/pinned-rows.mdx:133`.
- Fix: one rule, one place: a gesture that a mode cannot do shows as disabled in the menu and returns `{ ok: false, reason }` from the action so
  `onSkip`-style callbacks exist everywhere (history already has `onSkip`). Docs list the reasons once (the `reason` union) instead of seven callouts.
- Breaking: action return types widen (boolean to result object): low. Cost: M. Safe in two steps (reasons first).

### F15. `onSave` and the read hook are wired in two places — S2

- Where: `content/docs/recipes/data-fetching/server-side.mdx` ("Saving and refusals"): the hook returns `gridProps`; `onSave`, `onSaveRejected`,
  `resolveSaveConflict` are separate provider props; `server.refresh()` after a save is a manual line in the demo.
- Caveat: the common path ("save to API, refetch, keep the server's truth") is three pieces of caller code.
- Fix: accept `onSave` in the hook options and add `gridProps.onSave` that runs it, then reconciles by default (`refresh()` for a pages source
  unless `reconcile: "none"`); `serverRowIds` and `replaceRowId` stay for server-assigned ids. One concern, one options object.
- Breaking: no (addition). Cost: M. Owner decision on the default reconcile (extra request).

### F16. Props that must keep the same identity (stable reference class) — S3 (7 callouts, plus dev warnings)

- Where: `content/docs/performance.mdx:34-46` (`data`, `columns`, `getRowClassName`, `getCellClassName`),
  `content/docs/i18n.mdx:185` (`labels`), `content/docs/columns.mdx:273` (`columnGroups` header nodes),
  `content/docs/addons/pinned-rows.mdx:140` (band arrays), `content/docs/addons/lookup.mdx:34` (`fetchOptions`, `options`),
  `content/docs/streaming-updates.mdx:199`, `data-grid/root.tsx:408-411` (dev warnings), `data-grid/store/commit.ts:137`.
- Fix per prop, cheapest first: compare `labels` deeply (cheap, one-time per change, like `columnGroups` already does); compare `topRows`/`bottomRows`
  by shallow structure; read `fetchOptions` through a ref and key the cache by the lookup column, not the function; dev warnings stay for the
  two class-name functions (the cost is real and cannot be absorbed). Gets seven callouts down to two.
- Breaking: no. Cost: S-M. Safe.

### F17. `refresh`, `reshape`, `retry`, `evict`, `revalidateInterval`, `reshapeDelay`, `prefetchNextPage`: option sprawl — S2

- Where: `data-grid-server/use-data-grid-server-rows.ts:49-75`, `data-grid-server/scroll-blocks.ts:35-65`. Several share rules the caller must hold: minimums
  (`revalidateInterval` at least 1000, `reshapeDelay` at least 250), pause-while-hidden, wait-for-request, "sequential source skips beyond 10 blocks".
  Below the minimum the value is ignored with a dev warning (`server-state.ts:155`).
- Fix: clamp instead of ignore (state the clamp once), group the live-data options into one `live: { revalidateInterval, reshapeDelay, prefetchNextPage }`
  object (one options object per concern), keep the three imperative methods. Fewer top-level names; no behavior change.
- Breaking: against the unreleased hook only. Cost: S. Owner decision on grouping.

### F18. Naming left from the old surface — S3

- `hasNextPage` (pager) vs `hasMore` (answer) for the same fact; `pageSize` (page) vs `blockSize` (scroll) is deliberate. Make the pager read `hasMore`.
  The pager is spread onto a component, so a rename touches `DataGridPaginationControls` (`use-data-grid-pagination.ts:9-20`) and its docs.
- `totalRowCount` is `number | null | undefined` in three places with three meanings for `undefined` (provider: "data is the whole result"; answer:
  "keep the last count"; scroll result: not yet known). Document the table once in the glossary; prefer `null` for unknown everywhere in results.
- Breaking: yes for the pager field. Cost: S. Safe before 2.0.

### F19. Reset and cancel rules for pending gates — S3

- Where: `content/docs/row-operations.mdx:70` ("Settle the promise on every path... never settles blocks every later delete"),
  `content/docs/recipes/data-fetching/server-side.mdx` ("Async gates": the result is dropped with no error when `readOnly`, row gone, or spec changed),
  `data-grid/store/types.ts` (`onBeforeDeleteRows`, near line 215).
- Caveat: a never-settling promise freezes that gate for good.
- Fix: a per-gate timeout (`gateTimeoutMs`, default off or generous) that aborts via the existing `AbortSignal` and cancels the action; or settle the gate when its
  signal aborts. Silent drops get an `onGateDropped({ gate, reason })` callback or a `data-gate-dropped` mark.
- Breaking: no. Cost: M. Owner decision (timeout default).

### F20. Single warnings that describe a limit, not a trap — keep as docs

Fine as written: Ctrl+H browser shortcut (`addons/find-replace.mdx:190`), `?` shortcut (`addons/keybindings.mdx:45`), clipboard read permission
(`addons/context-menu.mdx:166`), React 19 and Tailwind v4 (`installation.mdx:90`), 200,000-cell paste cap (`clipboard.mdx:132`), axe-core limits
(`accessibility.mdx:166`), `NuqsAdapter` not nested and Suspense when prerendering (`addons/url-state.mdx:61,66`), unique `prefix` per URL-state grid
(`recipes/ui-patterns/multiple-grids.mdx:22`). External constraints; nothing to absorb. Two small ones are absorbable:

- `NuqsAdapter must not be nested` and `DataGridContextMenu must be inside DataGridProvider` (`addons/context-menu.mdx:38`): throw a named error in
  development with the fix instead of a callout. Cost: S each.
- A URL-applied sort has no indicator in the default config (`addons/url-state.mdx:145`): show the sort indicator whenever a sort is active, whatever
  `headerClickBehavior` says. That removes a callout and a dead state. Breaking: no. Cost: S.

### F21. Context menu resolver runs during render — S3

- Where: `content/docs/addons/context-menu.mdx:151`. Hooks in a resolver break the rules of hooks.
- Fix: call the resolver in a component (render a `<Resolver>` element) so hooks work, or document the resolver as a pure function in its JSDoc only.
  Cost: S. Low value; do it only when touching the file.

### F22. Undo `record` plus your own write double-applies — S1

- Where: `content/docs/addons/undo-redo.mdx:117` ("Do not write the array yourself first"), `data-grid-history/` `record`.
- Fix: `record` returns the applied change and the grid warns in development when `data` changed to the recorded value between `record` and the echo
  (a duplicate write). Or rename `record` to `apply` so the name says it writes. Cost: S. Safe.

## Cross-cutting patterns

- **Coupling by convention:** F2, F3, F5. The library checks pairs in dev warnings or not at all. Prefer one prop with the implied state derived.
- **Silent skips:** F10, F12, F14, F19. A skipped action should say why in its return value, as `reorderRows` and history's `onSkip` already do.
- **Per-caller copies:** F7, F8, F15. A thing every demo copies belongs in the hook.
- **Stable-reference rules:** F16. Absorb the cheap ones.
- **Registry surface:** F6. Enforce by script.

## Top 10 to do first

1. **F2** Split `keepCheckedRows` (act-on-checked) from id memory (`totalRowCount`); drop `keepHiddenCheckedRows`; fix the stale JSDoc at `types.ts:186` now.
2. **F7** `parseServerSpec` (bounded, typed, React-free): secure first; removes the most copied code.
3. **F3** One server-spec switch, `totalRowCount` implies server sort/filter, `DataGridUrlState` dev check.
4. **F1** Paginate the view, not the data (largest trap; L).
5. **F6** Remove the unused barrel exports; enforce with `scripts/verify-source-rules.mjs`.
6. **F4** One server path in the docs and options; hook owns the page reset and URL pagination plugs in.
7. **F8** Optional `getRowId` in the server hook.
8. **F11** Compose the hook's merge with the caller's `onDataChange`.
9. **F12** `isPlaceholderRowId` and a loaded-ids reader; reasons on silent skips (start of F14).
10. **F15** `onSave` through the hook with a default reconcile.

### Safe before 2.0 ships (no owner call needed)

F2 (JSDoc now; the derivation split is unreleased state), F4, F5 with F4, F6, F8, F10 (docs fix and dev warning), F11, F12, F16 (cheap parts), F18, F20, F22.

### Needs an owner decision

- **F1**: pagination over the view is a rewrite; ship in 2.0 or keep the callouts.
- **F2**: does `totalRowCount` alone turn on id memory (recommended), and does `keepHiddenCheckedRows` fold into it?
- **F3**: does `totalRowCount` imply server sort and filter?
- **F9**: keep one hook with a fixed `mode`, or split into pages and scroll hooks.
- **F13**: default `createRow` (type safety against fewer dead controls).
- **F15**: default `refresh()` after a save (one extra request).
- **F17**: group the live options.
- **F19**: default gate timeout.

## Not covered

Add-ons views, presence, keybindings, and fill beyond the cases above got a barrel and warn-callout pass, not a code read. Client-versus-server
parity for every matrix cell stays in `research/parity-matrix.json`.
