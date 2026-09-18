# QA & Docs Work Plan — 2026-07-17

Living plan for the post-v1 QA burst. Advisor: planner (main session) — plans, gates, commits.
Builders: builder agents, one lane each. Update this file as items land; it is the source of
truth if the session dies (see also the memory index).

## In flight (builders running)

### 5. Paper-style docs theme — IN FLIGHT 2026-07-17 (builder launched)
- Direction decided (delegated to advisor): flat-minimal + big radii + warmed light bg + soft
  card shadows; CSS-token overlay on fumadocs vars in app/global.css; docs chrome ONLY — the
  grid stays shadcn-token-pure. Builder loads frontend-design skill for the aesthetic pass.
- Deliverable: token overlay + applied chrome + short design note in docs/agent-work/specs/.

## Landed (was in flight — see done list)

### 1. Select editor renders as a string input (core bug) — DONE 1451bfc
- **Report:** editing the `role` column in every example shows a text input, not the select dropdown.
- **Static pre-check (done):** cell-types/select.tsx SelectEditor opens-on-mount and is correctly
  registered; wiring looks right, so the bug is behavioral/runtime.
- **Prime suspects:** the Select popup portals to document.body and the grid's
  commit-on-outside-click capture treats the popup as "outside" (instantly ending the edit,
  leaving the borderless trigger = looks like a text input); or the dblclick tail closes the
  fresh popup; or the typed-char (initialText) path. Date's Popover editor may share the bug.
- **Also folded into this lane (same file, cell.tsx):** pinned-ROW cells are translucent
  (`bg-muted/30` replaces opaque `bg-background` under twMerge) — fix with the pre-composited
  color-mix pattern used for the pinned-column hover (see e99385d), + browser opacity test.
- **Lane:** registry/default/blocks/data-grid/ (cell-types/, interaction/, cell.tsx) + tests.

### 2. FPS meter on the performance demo — DONE 9b66d9e
- **Ask:** render diceui's FPS registry component (https://diceui.com/docs/components/base/fps,
  source in references/diceui) at the TOP-LEFT of the grid inside /docs/performance's preview.
- **Constraints:** overlay must not intercept grid pointer events; rAF loop with cleanup;
  SSR-safe; credit diceui; decide demo file layout per CONTRIBUTING rules.
- **Lane:** registry/default/examples/, registry.json, components/registry-examples.tsx,
  app/dev/examples/page.tsx, content/docs/performance.mdx.

### 3. Pinned-column shadow offset in light mode — DONE e99385d/44e4ea6
- **Report:** shadow still visually offset from the pinned column edge in LIGHT mode, despite
  e99385d's fix whose tests assert 0px positional drift.
- **Key insight:** the old test measured element POSITION, not where the shadow VISUALLY paints
  (gradients/box-shadow blur shift the perceived edge). New acceptance bar: pixel-sampled visual
  edge within ±1px of the cell border edge, tested in BOTH themes, in a NEW test file
  (test/pin-shadow.browser.test.tsx) to avoid colliding with lane 1's test file.
- **Repro matrix:** light/dark, with/without row markers, fractional column widths, zoom/DPR.
- **Lane:** root.tsx, windowing/use-pin-shadow-edges.ts, app/global.css, new test file.

## Queued (start when lanes free)

### 4. Conditional-styling examples for /docs/styling-theming (behind lane 2 — same files)
- **Ask:** realistic business examples — value thresholds (score < 50 red), styling one column,
  one row, one cell. Use getRowClassName / getCellClassName / per-column cellClassName.
- New registry example (e.g. data-grid-conditional-styling-demo) + embed in styling-theming.mdx
  with short prose explaining each pattern. Update registry.json + import maps.

### 4b. Full-swap mount cost — row-level subscription consolidation — DONE 7e290dd
  (useDataGridRowCellState; still awaiting user's React Scan re-capture to confirm, see below)
- **Evidence:** two React Scan captures (2026-07-16/17, Desktop fps-fix.txt): ~544 cell MOUNTS per
  max-velocity swap tick, React render 16-33ms, "other" 155-207ms (dev-inflated). All-props-changed
  = mounts; memo cannot help. React Compiler NOT enabled (checked next.config.mjs) — manual memo
  regime is correct and already working (render time halved between captures).
- **Lever:** move useDataGridCellState's per-cell Zustand subscription up to DataGridRow — one
  subscription per row (68/swap) deriving {activeCol, editingCol, searchMatchCols, selectedCols}
  for its cells, passed down as props included in cell memo compare. Trade-off: active-cell move
  re-renders its row (industry-standard granularity). Must keep the phase-3 wasted-render probe
  green and NOT regress selection-drag zero-cell-renders (selection is overlay-painted — verify
  rows don't subscribe to selection ranges, only the per-cell aria-selected... check how
  isSelected flows post-a11y-audit; it may force per-cell granularity for aria — if so, scope to
  active/editing/searchMatch and keep isSelected cheap or row-derived).
- **Verify with the user's debugging loop:** land it, user re-captures the same interaction in
  React Scan, compare "other time" + subscription counts. ALSO still want: same capture on a
  prod build (dev profiling inflates), and confirmation the interaction was a fling.

### 5. Paper-style docs theme (/brainstorming — DESIGN FIRST, no implementation)
- **Ask:** a style system giving the documentation a "paper" UI with smooth rounded corners.
- **Process:** brainstorming skill — clarify scope with the user one question at a time
  (open question 1: does "paper" mean warm off-white surfaces + layered card depth, or
  flat/minimal with big radii? reference site welcome), then 2-3 approaches (CSS-token overlay
  on fumadocs vars vs full theme), design doc to docs/agent-work/specs/, user approval,
  then implement. Scope: docs site chrome only — the GRID's look stays shadcn-token-pure.

### 6. Lazy row loading + Pagination add-ons (user-approved, "you decide" design settled)
- Full design: docs/agent-work/specs/2026-07-17-lazy-loading-pagination-design.md.
- Three phases after current lanes clear: (1) core onRowWindowChange + skeleton rows for
  undefined data, (2) data-grid-lazy add-on (sparse array, range coalescing, skeletons,
  requires controlled sort/filter), (3) data-grid-pagination add-on (client slice or fully
  controlled server mode, footer component, labels group, url-state composition).

### 7. Type-safety validation phase (user-requested 2026-07-17)
Goal: prove and raise the TypeScript quality bar across the repo. Scope, in gate order:
- **Compiler flags audit:** strict is on; MEASURE (branch-local tsc run) the cost of enabling
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
  `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`. Adopt what the codebase can
  absorb without weakening runtime code; document each rejection with the error count + reason.
- **Cast census:** inventory every `as never`, `as unknown as`, `as any`, and non-null `!` in
  registry/ (the store/cell generic-boundary casts are a known deliberate pattern — the audit
  decides per site: eliminate via better generics, or document the invariant in a one-line
  comment). Target: zero UNDOCUMENTED casts.
- **Lint hardening:** evaluate typescript-eslint strict-type-checked + consistent-type-imports +
  no-unsafe-* on registry/ only (docs-site code held to recommended). Same measure-then-adopt rule.
- **Type-level tests:** expand the existing *.type-test.ts pattern (vitest expectTypeOf) to cover:
  defineColumns inference incl. the method-shorthand variance fix, GridCellTypes consumer
  augmentation, controlled-props shapes, DeepPartial labels, ColumnDef option narrowing per type
  key, public barrel surface (no accidental `any` exports — consider tsd-style assertions).
- **Public API .d.ts review:** generate the barrel's rolled-up types and read them — anything a
  consumer sees typed as `any`/`{}`/broken generic is a defect.
Gate: tsc + suites green with any adopted flags; findings report ranks remaining debt.

### 8. UI-visibility sweep + filter popover layout (builder running 2026-07-17)
- Filter popover: value input starved to a sliver by fixed-width selects in w-96 popover (user
  screenshot). Builder has full design authority; must survive long German operator labels.
- Sweep every chrome surface (toolbar/menus/dialogs) at 1280px + 800px, light + dark; fix in
  add-on lanes, report core-lane findings.

### 9b. content-visibility revisit (from tablecn lane, 2026-07-17)
- `content-visibility: auto` on rows measured idle 221→1198fps / swap 38→155fps but broke the
  pin-shadow painted-pixel probe (32px offset) — dropped per no-regression rule. The win is too
  big to ignore: revisit in #9 by adapting the pin-shadow anchor measurement to
  content-visibility (or scoping c-v off for pinned-adjacent rows), then re-run the full matrix.

### 9. Deep performance audit phase (user-requested 2026-07-17; design decisions delegated)
Goal: go beyond the render-count work — compare implementations with measurements, not vibes.
- **Function complexity census:** identify hot-path functions (scroll tick, window commit,
  selection ops, clipboard serialize, view-index build) and document each's time complexity;
  compare alternates where a better bound exists (e.g. selection-contains checks, membershipRuns,
  find-search-matches early-exit) — adopt only with a measured win at realistic n.
- **JS runtime memory strategies:** allocation audit of per-tick/per-commit paths (object/array
  churn in computeWindow, snapshots, rects); monomorphic object shapes (consistent field order,
  no conditional fields) for engine-friendly hidden classes; reuse vs allocate for hot small
  objects; Uint32Array viewIndex evaluation (PLAN §4.6 already flags it for >1M rows — measure
  at 100k too).
- **React memory tricks:** retained-heap profile via Playwright + CDP HeapProfiler at
  10/1k/100k/1M rows (PLAN §4.6's stolen benchmark method — implement it as a runnable script);
  subscription-count budget (pairs with workplan 4b row-level consolidation); verify no
  per-row/per-cell wrapper closures crept in (PLAN §4.6 memory-model rules); effect/listener
  leak check across mount/unmount cycles.
- Deliverable: a perf-audit report (docs/agent-work/) + the adopted fixes, each with
  before/after numbers; new heap-profile script wired as an opt-in npm script (not CI).

### 10. Column flex fill (user report 2026-07-17: hero grid leaves dead space right of Score)
- **Why it happens (not a bug):** demo columns are fixed px (sum 890) inside a ~976px container;
  the grid has no fill mode. CSS `1fr` is OFF the table — all pixel math (pin offsets, selection
  overlays, fill handle, column window) derives from `layout.widths`.
- **Design (decided):** per-column `flex?: number` on ColumnDef. Distribute POSITIVE leftover
  (viewport clientWidth − marker − Σ base widths) proportionally to flex, clamp at maxWidth and
  redistribute clipped excess; never shrink below base width; no leftover or no flex → today's
  behavior. Manual resize override wins and removes the column from flex (existing
  resolveColumnWidth precedence). Wire viewport width (root's useElementDimensions) into
  useColumnLayout; pure distribute function + unit tests; browser test that overlays still align
  on flexed columns. Update hero demo (name/email flex) + columns docs + type-test.

### 11. Barrel rename: `<item>-index.ts` → `<item>.ts` (user 2026-07-17)
- Consumer imports must read `@/components/data-grid/data-grid`, not `.../data-grid-index` —
  shadcn convention. Rename all 7 block entry barrels, fix every internal/example/docs import,
  registry.json paths+targets, scripts/fix-registry-imports.mjs + verify-registry.mjs handling,
  eslint boundaries if they name the barrel. Payload rebuild after.

### 12. Docs content batch (user 2026-07-17)
- Every docs/example dataset with a `role`-like column uses the `select` cell type (today many
  are plain text) — sweep all examples + mdx snippets.
- i18n gets its OWN docs page (labels object, DeepPartial, groups incl. pagination later,
  RTL explicitly unsupported) — extract from wherever it lives today, add to meta.json nav.
- styling-theming "programmatic per-row/per-cell": +2 realistic examples — style a whole COLUMN
  and a whole ROW via getCellClassName/getRowClassName APIs.
- Perf audit of ALL docs code snippets: inline getRowClassName/getCellClassName/callbacks are
  bad examples (identity churn = the dev guardrail warns) — module-scope or useCallback pattern
  everywhere, matching data-grid-conditional-styling-demo.
- Pinned rows: MULTIPLE top/bottom rows already work (band maps the whole array) but docs show
  one — demo + docs show 2+ pinned-top rows (user 2026-07-17).
- Row/column virtualization: built (windowing/) but has NO docs — section or page explaining the
  windowed rendering model, overscan, what consumers get for free (user 2026-07-17).
- Lazy/pagination (#6) explicitly re-requested by user 2026-07-17 ("add this in") — it is the
  next MAJOR phase after this docs batch, per the approved spec.

### 13. Row-marker UX (user 2026-07-17)
- **Bug:** right-click on a row marker opens an EMPTY context-menu popover — suppress rendering
  entirely when the menu would have no items (data-grid-context-menu add-on).
- **Feature:** press-and-drag on row markers extends row selection row-by-row (like Excel).
  Must work on ALL marker types (number, checkbox, both) — today shift+drag partially works on
  number only. Include drag auto-scroll at viewport edges and keyboard/a11y parity
  (aria-selected on rows, existing roving tabindex untouched).

### 14. Rendering/perf comparison vs tablecn (user 2026-07-17; runs with/extends #9)
- User perception: tablecn (github.com/sadmann7/tablecn) feels smoother at the same row count,
  fewer FPS drops. Pull the repo, study its data-grid implementation, diff the architectures
  (virtualizer, scroll handling, memo strategy, DOM shape, CSS containment, event handling),
  identify WHY it feels faster, produce measured side-by-side numbers (same dataset, same
  machine, FPS probe), then adopt what wins with before/after measurements. Deliverable:
  comparison report in docs/agent-work/ + fixes.
- FOLD IN (user scroll capture 2026-07-17, React Scan: 416 cell + 127 row renders, 23-26fps
  drops during scroll): window-edge row MOUNTS are the remaining scroll cost. Evaluate the
  designated fallback from the canvas decision — ROW POOLING (recycle row DOM/fiber instead of
  mount/unmount at window edges) — against tablecn's approach; adopt only with real-drag perf
  test wins (the existing gate from canvas-pivot-rejected).

### 15. Import dialog: duplicate mapping + docs UI (user 2026-07-17)
- The mapping step lets the SAME grid column be chosen for multiple source columns — verify
  what actually happens (last wins? both write?), decide whether duplicates make sense
  (probably not — likely prevent or warn), fix + document the behavior.
- The import steps list on /docs/import-export#import is plain/ugly (user screenshot) —
  restyle (fumadocs Steps component or similar).

### 16. Sort/filter toolbar — diceui advanced-filters port (DECIDED 2026-07-17, research done)
Research: references/diceui has the STATE MODEL (config/types/parsers/use-data-table) but not
the advanced UI .tsx files (filter-list/filter-menu/sort-list absent — reconstruct from MDX +
types). diceui = MIT (c) 2024 Sadman Sakib. Advisor decisions:
- **Filter upgrade IN PLACE** (stays "filter", stays in data-grid-toolbar): FilterSpec gains a
  stable `filterId`; global AND/OR `joinOperator` (diceui model: one join for all rows, own
  store field + action + OR path in build-view-index/matches-filter); multiple rows per column
  allowed; typed value inputs per column.type (number/date inputs instead of always-text);
  operators grow by `isBetween` (number/date, two-value input). SKIP v1: inArray/notInArray +
  faceted/multiSelect variants (we have no faceted option counts), isRelativeToToday, the
  command-palette alternative UI. Labels: filterOperators group gains new keys; toolbar group
  gains join strings.
- **NEW add-on `data-grid-sort-list`**: diceui-style toolbar sort button — multi-column list,
  add/remove/modify, precedence reorder via up/down buttons (NO drag dep — no new npm deps
  rule; diceui bundles a sortable component, we don't). New `sort` labels group in core;
  contextMenu keeps its sortAsc/sortDesc/clearSort strings. Uses existing core SortSpec +
  setSorts/toggleSort — greenfield, no file moves.
- **NO further toolbar split**: filter button stays in data-grid-toolbar (already an add-on;
  splitting search/filter/columns into 3 items churns every consumer + the mixed
  DataGridToolbarLabels group for zero consumer benefit). Evaluated per user ask; rejected.
- **Credits**: README + docs get a Credits note — diceui (MIT, Sadman Sakib) for
  toolbar/filter/sort-list/FPS inspiration, tablecn if any code gets adapted in #14.
- BLOCKED behind pagination lane (both touch labels.ts/registry.json/meta.json).

### 17. Pagination + fetching examples — DONE e3738d6 (pagination demo, React Query
  adapter section, permanent-failure retry UI all in content/docs/lazy-loading.mdx)
- data-grid-pagination add-on ships WITH a docs example using the component.
- React Query adapter/example for data-grid-lazy (fetchRows via queryClient.fetchQuery or
  an example wiring useInfiniteQuery-style caching).
- Failure-mode example/docs: first fetch works, later range fetch fails permanently —
  show what the grid does (skeletons revert, onError, retry on next visibility) and how a
  consumer surfaces a retry UI.

### 18. RTL wording (user 2026-07-17) — DONE inline: "not yet supported, may come in a
  future version" in i18n.mdx + index.mdx callouts.

### 19. Cell click re-renders all visible rows (user 2026-07-17, profiler dump)
- Evidence: user-provided profiling export, 2026-07-17 09:51 (React DevTools
  export) — clicking a cell (fill handle moves) re-renders every visible row.
- Advisor hypothesis: root.tsx subscribes to the active cell's column (off-window inclusion in
  columnIndices) → every active-cell change re-renders DataGridRoot → NEW context value →
  every context-consuming row re-renders (layout-context doc itself warns root renders bust
  context consumers). Candidate fixes: split volatile bits out of the root context, move the
  activeColumn dependency down into body/window layer, or memoize the context value against a
  stable dep list. Must keep wasted-render probe + perf suite green; verify with the dump's
  interaction replayed in a browser test (click cell → assert only the affected row(s) render).

### 20. Multiplayer presence highlights (user 2026-07-17)
- **Ask:** highlight other users' cells/ranges on the same grid, like tablecn's
  /data-grid-multiplayer demo and glide-data-grid's drawFocusRing/highlight regions. Must be
  performant — ideally ZERO cell/row re-renders (user: "best would be not to trigger any
  updates"). Docs demo simulates 3 users moving cell/range selections with the highlighting API.
- **Advisor direction (verify in research):** reuse the overlay-painted selection path — a
  `highlights` input (array of {id, color, range(s), optional label/avatar}) rendered by the
  existing overlay layer; cells/rows never subscribe. Transport is OUT of scope (consumer
  brings websocket/CRDT; grid exposes the API). Core-vs-add-on: painting lives in core's layer
  stack (small surface); a transport adapter add-on only if a real backend example is wanted.
- **Research first:** tablecn clone (scratchpad) multiplayer page implementation + its
  transport; references/glide-data-grid highlight-region/draw-cell APIs; then design doc
  (API shape, color handling, label chips, pinned-area interaction, virtualization clipping),
  then build AFTER the perf audit lane lands (both touch core overlays).

### 21. WebGPU interactive shader hero on the docs root — DONE cf4a435
- Landed: variant F + H scan band per spec (2026-07-17-webgpu-hero-shader-design.md).
  components/hero-shader.tsx, WGSL fragment shader, token-driven colors, drag/hover-pause/
  velocity band, static fallback, reduced-motion frame, off-screen pause. Original ask below.
- **Ask:** pretty interactive WebGPU-rendered shader on the docs landing page root, themed to
  fit the grid library; user wants concept ideas + short descriptions first (/brainstorming).
- **Constraints (advisor):** WebGPU with graceful fallback (WebGL2 or static) — WebGPU is not
  universal; must not fight the paper theme (#5, in flight — same files, runs AFTER it);
  pointer-interactive; zero impact on docs INP (own canvas layer, rAF paused off-screen);
  no new npm deps if raw WebGPU API suffices.
- **Status:** direction locked 2026-07-17 — variant F "shared render windows" (user: "like f
  alot"): scrolling sheet of value/skeleton cells, user render window follows pointer, ghost
  collaborators carry their own column-scoped windows, row-anchored ghost selections. PLUS user
  requirements: drag-to-scroll the sheet with the mouse, and hovering pauses the auto-scroll.
  Mockup round 3 (F with drag+hover-pause) presented; round 4 folds in H's full-width scan
  band (user window spans edge-to-edge, stretches with scroll velocity) per user ask.
  On confirm → spec + build lane.

### 22. Unify docs page scrollbar with the code-preview scrollbar (user 2026-07-17)
- **Ask:** the main docs page scrollbar looks different from the code-preview's slim scrollbar —
  add a global override so the whole docs site uses the code-preview scrollbar style.
- **Status:** small CSS lane, advisor-inline after paper theme (#5) commit.

### 23. Pagination redesign → COMPOSABLE parts — DONE 54a71a3 + payloads 0a622ba
- User escalated: make pagination composable like a shadcn Pagination primitive (PARTS-ONLY,
  breaking), Next/Prev chevron-only, page numbers only from the middle Pages part. First/Last
  jump buttons stay. Design: docs/agent-work/specs/2026-07-17-pagination-composable-design.md.
- New labels pagination.firstPage/lastPage landed (kept from inline v1). Build lane rewrites
  footer into parts + context, rewrites demo/docs/tests, payload rebuild. IN FLIGHT.

### 24. Type-debt burn-down (advisor-queued from the type-safety report's ranked debt)
- **A — DONE da08dfd + payloads 2e9feed** (cast census 56→11; AnyColumnDef alias;
  AccessorKeyOf guards the keyof-unknown trap; hooks callable + optional generic):
  `useDataGridVisibleColumns`/`useDataGridAllColumns` return columns whose `accessorFn`/
  `setValue`/function-`readOnly` are uncallable (`never` param). Re-type the erasure boundary to
  `unknown` (consistent with `useDataGridRow`), propagate through the ~15 internal sites incl.
  the 8 call sites the report's attempted quick fix broke. Type-tests prove callability.
- **B — DONE 6fc1a53 + payloads 5d7acc9** (real count 487 incl. tests, all to zero; ~19
  documented hot-path assertions; one defensive viewIndex guard in store row-id hooks):
  adopt `noUncheckedIndexedAccess` — 124 source errors, start in
  selection/ (compact-selection.ts) and fill/ (detect-series.ts) where the report says the
  real-bug signal is; measure-then-adopt, document any rejection.
- Report §5 has the full analysis: docs/agent-work/2026-07-17-type-safety-report.md.

### 25. Hero shader fidelity rework (user 2026-07-17: "not even close" to candidate F)
- **User feedback on cf4a435:** the landing bg must actually LOOK like the approved artifact
  (F study: value text + skeleton bars in cells, full-width scan band, named ghost windows
  Ada/Kim/Rio with dashed borders + row-anchored selections), and must cover the FULL page,
  not just the hero text block. WebGPU is no longer required — any tech is fine if it matches
  the design ("don't limit yourself to webgpu").
- **Advisor decision:** port the approved mockup's Canvas-2D F sketch faithfully into
  components/hero-shader.tsx (drop the WGSL path — one code path, text rendering is native);
  fixed full-page canvas behind all content, pointer via window listeners, drag only from
  non-interactive empty space so buttons/grid/links keep working. Spec amended.
- **DONE ade6942** — verified vs mockup in both themes; radial legibility mask added;
  reduced-motion blank-canvas bug found+fixed during verification.

### 26. DateCell SSR hydration mismatch (found by #25's browser verification, 2026-07-17)
- DateCell renders "Jul 5, 2023" server-side vs "5 Jul 2023" client-side — locale-dependent
  Intl formatting differs between the node server and the browser → hydration mismatch (the
  dev overlay's "2 Issues" badge on the landing demo). Fix: deterministic/pinned locale (or
  explicit format) in the date cell's display path, test that server and client output match.
- Core registry bug (cell-types/date). **DONE 0b87005** (advisor-inline): default locale pinned
  to en-US (explicit option still wins), deterministic-output test, payloads rebuilt.

### 27. Hero background barely visible (user 2026-07-17, follow-up on #25)
- ade6942's radial legibility mask (transparent 25% → var(--background) 78%) + the mockup's
  low ink alphas over-dimmed the full-page background — "we can almost not see anything".
- Fix: raise background presence (soften/shrink the mask, raise cell/ghost alphas) until the
  grid is CLEARLY visible across the page while headline/body text stays readable; tune
  visually in the browser, both themes. IN FLIGHT.
- **Addendum (user, mid-lane):** text readability on the root page needs MORE protection, not
  less — the veil behind the text must be WIDER and/or more solid, with a soft diffuse falloff
  ("more white around it"), so text sits in a generous clean zone while the grid stays strong
  outside it. Forwarded to the running builder.
- **Addendum 2 (user):** the DIFFUSION veil direction is REJECTED — user wants a different
  text-background treatment entirely; brainstorming session with visual examples (solid paper
  panel / frosted glass / cell-aligned cutout / no-panel text halo). Builder redirected to
  deliver visibility tuning only; treatment lands as a follow-up after the user picks.

### 28. Hero text treatment = P2 frosted glass + dark-mode ink bug (user picked 2026-07-17)
- **User picked P2** from the treatments artifact: frosted-glass panels (translucent card bg +
  backdrop-blur + hairline border, rounded, soft shadow) replace the interim radial masks on
  all five text blocks of the landing page.
- **Bug (user: "why is it not white on dark mode"):** hero-shader's inkAlpha()/
  readBackgroundIsDark() parse only rgb()/rgba() strings, but the paper theme tokens are
  oklch(); Chrome's getComputedStyle preserves oklch → regex fails → ink falls back to BLACK
  and the dark boost never engages. Fix: resolve any CSS color via 1x1 canvas fillStyle +
  getImageData pixel readback (universal), verify near-white ink on dark. IN FLIGHT.

### 29. Filter + sort popovers → tablecn parity (user 2026-07-18, screenshots)
- **Ask:** make the toolbar filter popover and the sort popover look and behave like tablecn's
  data-table-filter-list / data-table-sort-list (repo now at references/tablecn, MIT): "Filter
  by"/"Sort by" title, aligned rows (join label · field select · operator select · value input ·
  trash · GRIP DRAG-HANDLE for reordering), Add/Reset footer buttons; study the implementation
  and port the logic.
- **Advisor decisions:** state model stays ours (FilterSpec/SortSpec from #16 — stable ids,
  AND/OR join, typed inputs already exist; this is UI/UX + reorder). Sort order = precedence
  (semantic); filter order = stored array order. tablecn credit added alongside diceui's.
- **User overrides (2026-07-18, mid-lane):** (a) drag reorder uses `@dnd-kit/react` (the new
  React wrapper) — explicit dep approval, installed + declared in registry.json for both
  add-on items; (b) tablecn is Radix-based, we are Base UI — build our OWN port adapted to
  our components/conventions, no 1:1 copy; (c) accessibility is a first-class requirement:
  full keyboard reorder (grip focusable, ArrowUp/Down moves the row, announced via
  aria-label/live region as appropriate) AND the a11y model documented in the docs pages
  (keyboard table for the popovers). Forwarded to the builder.
- **DONE 35fcc9e + payloads 161946c** — all overrides applied; real bug found+fixed
  (@dnd-kit/react OptimisticSortingPlugin moves DOM mid-drag, disabled per-row); browser
  suite grew to 250; eslint warnings 27→25.

### 30. Home-page card hover goes translucent over the grid bg (user 2026-07-18) — advisor-inline
- Clickable cards on the docs root (e.g. → /docs/performance) use a translucent hover fill
  (fumadocs Card hover accent/80-style) — the animated grid bleeds through on hover, looks bad.
  Fix: opaque hover surface for the home cards (and the add-on link tiles if affected).

### 31. /dev vs docs feature-coverage audit (user 2026-07-18; queued behind #29)
- **Ask:** everything testable on the /dev page must also be findable in the docs. User could
  NOT find docs coverage for: the sort + filter toolbar buttons (add-ons), density, header
  click behavior, row markers. Audit /dev (app/dev/) feature-by-feature against content/docs,
  list gaps, then fill them (demos + docs sections/pages, nav in meta.json, registry examples
  where needed). Runs AFTER #29 lands (docs + toolbar demos are #29-touched surfaces).
- **DONE 8569824** — full coverage table produced; row-markers + header-click sections added,
  isBetween documented, stale sort-list-demo description fixed; density confirmed covered;
  new popover UI confirmed documented; zero core bugs found.

### 32. Post-#29 completeness + filter/sort performance proof — DONE a34edf2 + payloads 083c0e7
- Landed: createFilterMatcher (bounds parsed once per filter → 28-56% faster filter scenarios
  at 100k rows, parity-tested), view-index-perf.test.ts with documented ceilings, checkbox
  true/false through labels, i18n.mdx full sort group + join/reorder keys, sort-list mounted
  on /dev + German keys, deepMergeLabels 3-arg function test. Sort path verified optimal
  (decorate-once + shared Collator). Unit suite now 1002.
- **Discovered gap, queued as #34:** tablecn has global open shortcuts (Ctrl+Shift+F/S) and
  Backspace/Delete-removes-last-filter; we don't. Needs design vs the keybindings dialog.

### 34. Filter/sort popover global shortcuts (from #32 parity check; awaiting user interest)
- Ctrl+Shift+F / Ctrl+Shift+S open the filter/sort popovers; Backspace/Delete in the popover
  removes the last row (tablecn behavior). Design question: integrate with data-grid-keybindings
  (registered GridActions + dialog listing) vs toolbar-local listeners. Original ask below.
- **Feature sweep:** after the popover rework lands, audit it for missing features — i18n above
  all (every new string in the labels groups, DeepPartial docs key lists updated, i18n page
  covers the new toolbar/sort keys incl. the reorder announcements) plus any other parity gap
  (e.g. operator coverage per column type, empty-state rows, reset behaviors). Implement gaps.
- **Performance proof:** benchmark the filter + sort hot paths (matches-filter, build-view-index,
  sort comparators) at realistic n (100k rows, multiple filters incl. OR join + isBetween,
  multi-column sort) with dedicated perf test cases proving they are still fast; follow the
  perf-test discipline (floors, isolated reruns, never lower thresholds). Where measurements
  show a regression or a better bound exists, OPTIMIZE (time complexity first — e.g. per-row
  per-filter work, comparator allocations) with before/after numbers per the #9 audit method.

### 33. Type-safety fleet scan (user 2026-07-18: "start a fleet of builder agents"; behind #29)
- Multi-agent scan (user explicitly opted into fan-out orchestration) over ALL features with
  emphasis on the reworked filter/sort: each scanner hunts missing types, `any`/unsafe casts,
  unsound generics, and approaches that only LOOK type-safe (e.g. assertions hiding real
  narrowing gaps, stringly-typed ids, unchecked store boundaries). Findings adversarially
  verified before fixing; confirmed defects fixed under the standing bars (zero undocumented
  casts, noUncheckedIndexedAccess stays green, gates per lane). Runs once #29 lands so the
  scan sees the final popover code.
- **DONE 3b45582 + payloads 77e5822.** Fleet: 46 agents, 19 raw findings → 5 confirmed,
  2 plausible, 12 refuted. Fixed: dnd-kit drag data typed (casts gone), Base UI select null
  guarded, 4 undocumented ! removed via narrowing, computeDeleteBatch guard. The verification
  test exposed two PRE-EXISTING UI bugs, both fixed: SelectValue rendered raw values (ids like
  "age"/"asc") without an items/children resolver, and Base UI SelectIcon's default "▼" text
  survived the render-prop merge into every chevron svg app-wide. Kept: keybindings
  Object.entries cast (conventional, test-covered). Browser suite 251.

### 36. Performance demo shows numbered row markers (user 2026-07-18) — advisor-inline
- /docs/performance demo gets rowMarkers number mode so the row count/position is visible
  while scrolling the 100k rows.

### 35. Docs scrollbars reveal on hover (user 2026-07-18) — advisor-inline
- Docs-site scrollbars (page + fd-scroll-container code blocks) hide their thumb by default
  and reveal it while the pointer hovers the scrolling element; Firefox approximated via
  scrollbar-color swap. Docs chrome only, no registry impact.

### 37. Styling & theming: an example per style pattern (user 2026-07-18)
- **Ask:** /docs/styling-theming shows every styling pattern the grid exposes with its own
  runnable example — incl. FULLY styling a whole row and a whole column (user's explicit
  example), not just the threshold-conditional demo.
- Scope: audit the styling surface (per-column cellClassName/headerClassName if present,
  getRowClassName, getCellClassName, density, tokens + data-attribute contract), one demo per
  pattern (extend existing demos where natural, new registry example(s) where not), prose per
  pattern, stable-callback discipline, registry wiring + payload rebuild.
- **DONE (this commit)** — new data-grid-styling-patterns-demo (fully-styled Region column,
  fully-styled at-risk rows, live density toggle) + three new docs sections incl. CSS-only
  state styling via data attributes; stale `data-invalid` docs reference fixed (attribute
  never existed); zero API gaps found.

### 38. Project evaluation → small-gap burn-down (user 2026-07-18)
- **Ask:** evaluate the project for missing small features / documentation improvements worth
  implementing right now. Advisor surveys (session knowledge + read-only sweep), picks the
  sensible small items, builds them. Known candidate going in: the reserved-but-unwired
  `grid.emptyState` label (zero-row grid renders nothing today). IN FLIGHT (survey).
- **User addendum:** every feature the evaluation surfaces gets its own markdown spec file
  in docs/agent-work/specs/ ("catch files") before building.
- **Survey done (Explore sweep + session knowledge), 7 findings, all size S:**
  (1) docs promise two-stage Ctrl+A but code is single-stage → IMPLEMENT two-stage, spec:
  specs/2026-07-18-two-stage-select-all-design.md; (2) grid.emptyState label dead + "No data"
  hardcoded → wire it, spec: specs/2026-07-18-empty-state-design.md; (3) export scope
  'view'|'all' undocumented in import-export.mdx; (4) CHANGELOG.md stale (missing pagination/
  lazy/sort-list/presence); (5) README add-on table missing lazy+pagination, features list
  missing presence/composable pagination; (6) createFilterMatcher + AnyColumnDef absent from
  api-reference.mdx; (7) dev-guardrail console.warns lack troubleshooting callouts in
  virtualization/performance docs. Non-gaps verified: nav complete, llms routes generated
  live, io scope code correct, keybindings dialog complete. ONE build lane for all 7.
- **DONE f27e1d4 + payloads 2d21e7b** — two-stage Ctrl+A (region flood + identity-based stage
  reset, docs callout now true), emptyState label wired (prop still wins, "No data" literal
  gone), all 5 doc fixes landed. Unit 1009 / browser 255 / registry 30 items, all green.

### 39. Local development guide (user 2026-07-18) — advisor-inline
- DEVELOPMENT.md at repo root: run the site, all test suites + gotchas (uppercase drive,
  .vite/.next cache clears, perf-test discipline), build/verify registry payloads locally,
  and install the components from the local registry into ANOTHER project (URL install +
  @gridcn namespace via components.json). Linked from README.

### 40. ReUI table parity + pin indicator (user 2026-07-18, tasks 1+2)
- Research ReUI's table/data-grid feature set; list anything it has that gridcn lacks; implement
  the sensible gaps (spec first). Pin indicator specifically: ReUI shows a pin icon on pinned
  column headers — check whether gridcn already lets the consumer render/style this in the
  header (composable header surface); if yes, document; if no, add it composably. RESEARCH IN
  FLIGHT → spec → build.

### 41. Events & state showcase docs + API control evaluation (user 2026-07-18, task 4)
- New docs page showing WHAT the grid exposes: live demo where interacting (select, edit, sort,
  filter, paste...) renders the event payloads/state objects as pretty JSON previews. Plus an
  evaluation: does the public API let consumers properly control/read all state (controlled
  props, hooks) and customize behavior — gaps listed and fixed if small. RESEARCH IN FLIGHT →
  spec → build.

### 42. Benchmark page + strategic core evaluation (user 2026-07-18, tasks 3+5)
- /dev benchmark page comparing gridcn against feature-comparable grids (candidates: AG Grid
  Community, MUI X DataGrid, TanStack Table+virtual, Handsontable?, Glide, react-data-grid) on
  performance, memory, and every stat we can capture — human-testable in the dev route.
  Competitor libs land as devDependencies (user-approved by the ask).
- Strategic half (task 5): evaluate REBUILD vs BUILD-ON another core (esp. TanStack Table —
  user saw their new select + an Excel-like spreadsheet demo teased); weigh against performance,
  our shipped feature set, and the library vision. Deliverable: comparison report + benchmark
  infra + recommendation (like the canvas-pivot eval).
- **Strategic half DONE:** stay from-scratch, TanStack core rejected — decision doc
  docs/agent-work/2026-07-18-core-strategy-decision.md + memory. Benchmark v1 DONE a6877a6.
- **Refinement (user 2026-07-18, planner-authorized): IN FLIGHT** — rich-cell parity across all
  grids (select/date/checkbox/number, as-similar-as-possible; impossibilities rendered in the
  benchmark UI as a parity matrix), Glide REMOVED (canvas too far from our approach), prod-build
  validation of v1's implausible dev-mode gridcn numbers + driver fairness audit.

### 43. Checkboxes use the shadcn Checkbox component (user 2026-07-18)
- The grid's checkboxes (checkbox cell type + row-marker/select-all checkboxes) are custom
  and don't look like shadcn's — switch to the shadcn/Base UI Checkbox component (ui/checkbox),
  registryDependencies updated, visuals verified both themes, tests adjusted. Queued behind
  #41 (registry.json contention).

### 44. Scroll smoothness at 100k under sustained fling (from benchmark v2 prod numbers) — IN FLIGHT
- **Evidence (fair driver, prod build, reproduced twice):** gridcn at 100k rows: medium 34.2fps
  (27.1% frames <30), fling 27.5fps (39.2% <30), 76 long tasks — weakest of the four grids on
  this axis, while winning memory (29.6MB vs MUI 163MB / TanStack 306MB post-scroll) and DOM
  (572 nodes flat) and keeping the no-blank guarantee. Mechanism: velocity overscan mounts up
  to ~44 extra rows per commit + synchronous flushSync inside the scroll event.
- **This meets the pre-agreed trigger** (canvas decision 2026-07-16: row pooling is the
  designated fallback, gated on a real-drag perf test showing the need). planner lane: measure-
  first against /dev/benchmark's fair driver; levers in order: (1) commit strategy (rAF-aligned
  vs flushSync-per-event), (2) overscan mount-cost reduction, (3) row pooling per the fallback
  design. No-blank + zero-render contracts hold; adopt only measured wins; CI floors may only rise.
- **DONE a1d157f — the premise did not survive measurement** (full report:
  docs/agent-work/2026-07-18-fling-smoothness-report.md). Benchmark is BIMODAL per browser
  launch (~24 vs ~45fps mode, affects all grids); controlled gap is ~45 vs ~60, not 27 vs 37.
  Commit coalescing: zero headroom (already 1 commit/frame). Overscan cap cuts + deferred
  overscan: rejected (blank frames 42→231 / 2.3-3x churn). ROW POOLING: gate NOT met on honest
  re-measurement — stays rejected. Adopted: dateFormatterCache (+4.7% paired, 52x per call).
  Cost model: linear in row turnover, 0.40ms/row; future lever = per-row reconciliation cost.

### 45. Quick start goes minimal (user 2026-07-18) — advisor-inline
- Quick start currently leads with undo/redo (data-grid-history's useDataGridState) — user
  wants the minimum: core item only, plain useState + onDataChange, add-ons mentioned only as
  optional next steps at the end (undo/redo linked, not installed).

### 46. Callouts: no left stripe (user 2026-07-18) — advisor-inline DONE
- fumadocs Callout's colored left stripe removed via global.css (icon color is enough);
  start padding rebalanced since the container's ps-1 assumed the stripe.

### 47. Docs: remove redundant install commands (user 2026-07-18) — IN FLIGHT
- Every page repeats `pnpm dlx shadcn add @gridcn/data-grid` even for built-in core features.
  Rule: install commands live on installation/quick-start; add-on pages show ONLY their own
  add-on's install (with the core as stated prerequisite once); core-feature pages get none.

### 48. Lean core evaluation → extraction (user 2026-07-18) — RESEARCH IN FLIGHT
- **Ask:** base grid as lean as possible; evaluate moving built-ins to add-ons — user names
  presence + fill handle; check every default feature; "if not too destructive and we can
  actually build it, do it as much as possible."
- Research first: per-feature coupling map (store slices, overlay painting, interaction wiring,
  keymap, labels), extraction seam design (overlay/interaction plugin points), consumer
  breakage, and the vision tension (README sells selection+clipboard+fill as the free core
  trio — the cut list must surface this explicitly for the record). Build queues behind
  #44/#45 (core files) and follows spec-first.
- **Research DONE (2026-07-18).** Core = 93 files / 11,246 LOC. Verdicts: PRESENCE = clean cut
  (spec: specs/2026-07-18-presence-extraction-design.md, queued 3rd in core queue behind
  #44/#45; introduces the single overlay-plugin seam). ROW-PINNED BANDS = optional easy bonus
  cut (unrequested, flagged). FILL = extractable but medium-high seam cost (injectable root
  hook + GridAction extensibility) AND contradicts the README headline "all three in the core
  item, free" — AWAITING USER go/no-go on rewriting that claim before any build. CLIPBOARD =
  same tension, not recommended. Everything else (selection, keyboard, editing+built-in cell
  types, markers, column pinning, windowing, sort/filter engine, loading/empty) = load-bearing,
  extraction destructive.
- **PRESENCE EXTRACTION DONE cfcaee7/567c918 (2026-08-01).** Core seam: `overlayPlugins` on the
  provider (identity-guardrailed), rendered between built-in layers and the active-cell ring
  (local focus stays on top — deliberate deviation from the spec's "after built-ins",
  preserving the tested DOM-order contract). New item data-grid-presence: PresenceHighlight +
  overlay components + useDataGridPresence() (hook over component — plugin must exist before
  the provider renders). Zero-cell-render probe moved with it, stays green. BREAKING pre-1.0:
  presenceHighlights/setPresenceHighlights/useDataGridHighlights left core. Gates re-verified
  by advisor (unit 1088/1088 after a load-induced forks-worker retry; browser 269/270 = the
  known perf flake; catalog auto-sync produced the 33-item /r/registry.json).
- **FILL EXTRACTION DONE d9f263e/74b64ec (2026-08-01).** New item data-grid-fill (14 files):
  fill/ algorithms + overlay JSX + useFillHandle move out; add-on-local fill store; consumer
  API `useDataGridFill()` → { plugin, FillHandleTracker } — two pieces because the pointer
  engine needs refs that only exist inside DataGridRoot's subtree, so the tracker registers
  into a new core `fillHandlers` slot (mirrors scrollToCellImpl). fillDown/fillRight stay in
  GridAction/keymap, no-op without the add-on (tested, incl. no-console-errors).
  rectRelativeTo moved with its only caller; barrel gained pointerToCoord/InteractionLayout/
  useDataGridRootContext/combineRects (genuine cross-block needs). README/docs repositioned:
  core = selection + clipboard + editing, fill = free one-line add-on; presence row added to
  README table (was missed). BREAKING pre-1.0: onFillPattern, useFillHandle, FillPatternArgs,
  useDataGridFillPreview leave core. Gates advisor-verified: tsc/eslint/verify clean, unit
  1080/1080, browser 272/273 — perf floor fail (12-13fps vs 15) reproduced IDENTICALLY on
  stashed HEAD baseline in isolation → pre-existing slow-launch mode, not this lane.
- **PINNED-ROWS EXTRACTION DONE 4a3019b/4c6544d (2026-08-01).** Spec: specs/2026-08-01-pinned-
  rows-extraction-design.md (provider-level rowBands seam — NOT child registration, for
  first-paint + SSR correctness since bands affect layout height and aria-rowcount). Core:
  rowBands sync-prop (guardrailed like overlayPlugins), root keeps all height/aria arithmetic,
  context carries pinnedTopCount only; barrel gained GridColumnLayout alias (pre-existing
  ColumnLayout name collision surfaced by the extraction). Add-on: components moved verbatim +
  useDataGridPinnedRows({top,bottom}) → {rowBands}. Two band-opacity tests found in
  pinned.browser.test.tsx (pinned-COLUMNS file) moved too. New no-add-on test (no band DOM,
  correct aria-rowcount, no console errors). BREAKING pre-1.0: pinnedTopRows/pinnedBottomRows
  props leave core. Advisor-verified: tsc/eslint/verify clean, unit 1083/1083, browser 272/273
  (same baseline-proven perf flake). Catalog now 35 items. CORE SURGERY COMPLETE — all three
  #48 cuts landed; queue continues with #50 → #55/#56 refactor → #57 final gate.

### 49. In-depth grid comparison report — DONE 1441f6b
- Delivered: docs/agent-work/2026-08-01-grid-comparison-report.md (583 lines; filename is
  dated at delivery, not the original 07-18 placeholder). Exec summary, methodology + honesty
  caveats, stat tables (only measured numbers; gaps marked "not measured"), per-library deep
  dives (MUI X, react-data-grid, TanStack-assembled, Glide-removed-why, AG desk-research
  marked unverified, tablecn), research directions incl. the dead-end register (row pooling,
  overscan cuts, deferred commits) so rejected levers aren't re-explored blind.
- Top open levers it surfaced: (1) content-visibility revisit (blocked only by the pin-shadow
  measurement — highest value, matches 9b), (2) per-cell reconciliation cost (cn()/attribute
  work, span wrapper in cell.tsx), (3) monomorphic shapes in hot paths (#9), (4) high-column-
  count hardening (nobody else column-virtualizes), (5) real bundle byte-weight measurement +
  verify AG licensing claims from source before citing further.

### 50. Final DX/UX + structure review — DONE 0823ce1/e9213e2
- As-a-user pass: docs coherent post-extractions (only find: installation.mdx missed five
  add-on install commands — fixed); no stale core claims of extracted features anywhere;
  CHANGELOG/README/meta.json current. JSDoc left lean per the user's 2026-08-01 directive
  (no restating docs; absence is the sollzustand for obvious symbols — memory:
  jsdoc-no-restating).
- **DataGridRoot<TData> ADOPTED** (type-only, unknown default, erased internally like
  DataGrid's wrapper; zero runtime change, all 43 call sites unaffected; type tests cover
  default/narrowed/rejected + the events demo dropped its ctx.row cast). events-state.mdx
  gained a "Typed callbacks in split composition" section.
- Structure verdicts: root→body→row→cell callback threading is deliberate (memoized cell
  needs flat props — verified, left alone). FED FORWARD → new #58: header-cell prop grouping.
- Gates: all green incl. browser 273/273 (perf test passed — flake confirmed environmental).

### 60. Registry install-layout fix — explicit target paths (#57 Finding A; BLOCKS release)
- **Defect:** the shadcn CLI flattens every item's files into components/ on install — 88
  ../-relative imports break, 10 domain index.ts files silently overwrite each other; consumer
  tsc 364 errors, next build fails. Pre-existing (4.12 and 4.16 identical), never caught
  because no full consumer install had been exercised before #57.
- **Decision (advisor):** per-file `target` paths in registry.json preserving the domain
  layout (option i). Source flattening (ii) is impossible — the index.ts collisions — and
  would undo the #55 refactor; upstream escalation (iii) is not a fix. Targets are mechanical
  (derived from the repo path), so generate/validate them by script rather than hand-editing
  ~200 file entries.
- **Must verify in the lane:** target semantics for consumers WITH and WITHOUT src/ dir;
  whether the CLI still rewrites `@/registry/...` alias imports correctly when files have
  nested targets (fix-registry-imports.mjs's FIXED constant may need updating or retiring);
  verify-registry.mjs extended to assert every file entry carries the correct derived target.
- **Acceptance bar:** the preserved scratchpad harness (consumer-test/) — fresh install of all
  35 items → consumer `tsc --noEmit` CLEAN and `pnpm build` PASSES; dx-probe.tsx's
  @ts-expect-error flips back to a real caught error. Docs: installation.mdx nested-layout
  claim corrected to match reality; quick-start.mdx import path fixed if needed.

### 60 status: DONE 5bbd4a0/8e09e8b (2026-08-01)
- Target semantics proven on CLI 4.16.1 (plain relative targets, src/-dir handled by the CLI;
  cross-item rewrites resolve by basename against the batch's targets). 195 targets generated
  by scripts/add-registry-targets.mjs; verify-registry now fails on target drift. Three demos
  imported types.ts past the barrel (basename-ambiguity trap) — repointed.
  fix-registry-imports kept (build still inlines raw aliases). Harness: 35/35 install nested,
  consumer tsc/build CLEAN except data-grid-cell-types-demo (TS-version gap → #61).
  Docs already described the now-true layout; api-reference gained a known-gap callout.

### 61. Consumer-compat fixes: GridCellTypes augmentation + stable-TS (from #60; before #59)
- **GridCellTypes augmentation broken for consumers (proven in the harness):** the shipped
  cell-types.ts `satisfies { [K in CellTypeKey]: CellTypeFor<K> }` fails to compile once a
  consumer augments the interface (their new key has no entry in the shipped object).
  **Decision (advisor):** pin the satisfies to a literal BuiltinCellTypeKey union ("text" |
  "number" | ...) decoupled from the augmentable interface — keeps per-key checking for
  built-ins, augmentation-proof. Type-test both: builtin drift still errors in-repo; a mock
  augmentation compiles. Acceptance: harness re-run with a REAL consumer augmentation
  (custom cell type registered + used) → tsc clean.
- **Stable-TS compat:** repo pins typescript ^6.0.3; consumers run stable (harness: 5.9.3).
  data-grid-cell-types-demo's renderCell destructure is implicit-any on 5.9. **Decision:**
  examples must compile on consumer-stable TS — add the explicit annotation the demo needs;
  repo keeps its own pin. Harness re-run must show 35/35 consumer tsc CLEAN + pnpm build PASS
  (the full #57 acceptance bar, finally at 100%).
- **DONE f858e32/5089be6 (2026-08-01).** BuiltinCellTypeKey decoupling in cell-types.ts +
  builtin-augmentation.type-test.ts proving both directions; demo annotated (sole sibling per
  sweep); known-gap notes removed from types.ts/api-reference/custom-cell-types docs.
  HARNESS AT 100%: 35/35 installs, consumer tsc exit 0 / 0 errors, pnpm build PASSES, real
  currency-augmentation probe compiles. All main-repo gates green (browser 273/273).
  #57's mandate is fully satisfied — the registry chain is consumer-proven end to end.

### 62. Docs restructure in the shadcn shape (user 2026-08-01; AFTER the user reviews #59)
- **Ask:** the user loves the STE writing style and now wants the docs SHAPED like shadcn/ui's:
  an Introduction page first, then Installation, "in a style how they did it — please try to
  make it similar."
- Study references/ui's docs (apps' content/docs: their Introduction page tone/anatomy, the
  installation flow, and the per-component page anatomy: intro sentence → preview →
  Installation (tabs) → Usage → Examples). Map our pages onto that shape: a proper
  Introduction (what gridcn is, the shadcn-registry philosophy, what it is NOT), Installation
  as its own clean page, feature/add-on pages following the component-page anatomy where it
  fits. Keep the STE prose style from #59 for all body text. Navigation (meta.json) reordered
  to match. No content invented — restructure + fill only obvious gaps.
- **Sequencing:** STRICTLY after the user has reviewed and committed/rejected #59's
  uncommitted diff (same files). Auto-commit applies again for this item (normal lanes).

### 63. Credits: thank every upstream properly (user 2026-08-01; fold into the #62 lane)
- **Ask:** credits currently highlight diceui only — "not only dice ui." Thank shadcn/ui
  (registry system + the UI primitives we build on) and every other upstream whose registry,
  components, or patterns we use: shadcn/ui, Base UI, diceui (FPS meter), tablecn (popover
  anatomy reference), @dnd-kit, zustand, fumadocs — check the repo for the full honest list
  (grep references/ + package deps + existing credit mentions).
- One Credits section/page done once, warmly and specifically (what we took from whom), links
  included. README credits section aligned with it.
- **#62+#63 DONE af490a2.** Survey result: per-page anatomy was ALREADY shadcn-shaped from
  prior lanes — only index.mdx needed the Introduction restructure (definition → preview →
  gap → ownership philosophy → modular → what-it-is-not → credits → next steps) and
  meta.json one nav fix (multiplayer-presence Features→Add-ons, was mis-filed). Credits:
  7 upstreams with specific attributions; fixed a false no-dnd-kit claim (popovers DO use it
  per #29 override; core reorder stays native). Build 85 routes green, zero broken links.

### 65. RTL/LTR feasibility research (user 2026-08-01; planner lane, RESEARCH/SPEC ONLY, parallel)
- **Ask:** evaluate whether we can build RTL + LTR support into the lib. NO implementation —
  research and a spec draft only ("nur evaluates, keine implementation, nur specs and
  research").
- Study, in order: (1) how shadcn/Base UI already solve RTL (dir attribute, logical
  properties/Tailwind logical utilities — references/ui) since our chrome builds on them;
  (2) every collected grid reference (references/mui-x, react-data-grid, glide-data-grid,
  tablecn, table, react-datasheet-grid, virtual) — which support RTL, HOW (scroll math,
  sticky/pinning mirroring, keyboard semantics), and what they got wrong per their issue
  trackers; (3) OUR blockers: the CSS-var scroll transform (-scrollLeft), pin-offset math,
  overlay rect math, fill/keyboard direction semantics, places using physical left/right vs
  logical inline-start/end (census).
- Deliverable: docs/agent-work/2026-08-01-rtl-research.md + a draft spec (specs/) with
  approach options, effort/risk per option, and a recommendation — user decides go/no-go.
- **RESEARCH DONE a240ef4 (planner, probe-verified in Chromium, no source changes).** Verdict:
  FEASIBLE, effort M — 59 physical-coordinate sites across 11 files, ~1/3 already logical.
  Recommended Option B: `direction` prop + normalization at the coordinate seams; the scroll
  transform gets a `--grid-dir: 1|-1` sign in CSS → per-frame JS path UNCHANGED (perf
  contract a non-issue, proven bit-identical geometry both directions). Chrome is free via
  Base UI DirectionProvider; grid-line-placed overlays free. Top risks: pointerToCoord
  hit-testing (only non-trivial item), sub-pixel boundary rounding, silent physical-math
  regressions later (wants centralized helpers + lint rule). Found inconsistency TODAY:
  use-column-window normalizes RTL scroll while the var writer is LTR-only. shadcn's rtl
  codemod exists but solves debt we don't have — not adopted. Open product decision §5:
  ArrowRight = visual (recommended, matches all references + Base UI). AWAITING USER GO/NO-GO.

### 64. Multi-perspective docs research (user 2026-08-01; runs AFTER #62 lands)
- **Ask:** a research step over the finished documentation that reads it from different
  developer knowledge levels ("known dev perspectives, to lower devs") to find gaps and
  improvements across the range.
- Fleet of reviewer personas, each reading the LIVE docs content as that reader: (1) React
  beginner who has never used shadcn (does quick-start actually get them to a working grid?
  are terms like "registry", "controlled", "barrel" explained or linked?), (2) mid-level dev
  integrating into an existing app (state wiring, events, validation recipes findable?),
  (3) senior/perf-focused dev (architecture, perf contracts, extension seams documented?),
  (4) non-native-English reader (does the STE pass hold everywhere?), (5) a "skeptical
  evaluator" comparing us against MUI/AG docs (what would make them bounce?). Each reports
  concrete findings with page references; a synthesis step ranks them into fix-now (small,
  do immediately) vs queue items. Findings report to docs/agent-work/, fixes as follow-up.
- **RESEARCH DONE — synthesis: docs/agent-work/2026-08-01-docs-perspectives-research.md.**
  Verdicts: beginner=friction (shadcn-init on-ramp), mid-level=server-round-trip recipe
  missing entirely, senior=conditional yes, B1=15/23 pages pass STE (dense API pages fail;
  one actionable bug: fill-handle never names the modifier key), skeptic=needs maturity
  signals (version/semver/changelog/browser/a11y-conformance all unsurfaced). Fix-now lane
  covers the mechanical list; new queue items below.

### 66. Project status & compatibility page — DONE 24d292d/9196420
- /docs/project-status: version/pre-1.0 meaning, changelog discipline, honest browser matrix,
  framework floors, updating-installed-code, support/security. Two load-bearing findings:
  React 19 is a HARD dependency (provider.tsx uses React's `use()` for context — not in 18);
  `shadcn add --dry-run/--diff` VERIFIED LIVE against a namespaced registry on CLI 4.16.1
  (old `shadcn diff` is deprecated) — documented with real commands, no desk-research claims.
- Process note: my #69 sweep-commit picked up this lane's finished page early (verified
  byte-identical, no corruption); future parallel docs lanes → stage explicit file lists.

### 67. Accessibility page — DONE 07c6c99 (honest-claims variant)
- /docs/accessibility (Features nav, after selection-keyboard): the real a11y model + a
  six-row test-status matrix citing actual passing browser tests (a11y suite re-run 3/3
  axe-clean, dated); EVERY manual-screen-reader cell says "Not yet performed" — no
  conformance claimed, WCAG 2.1 AA stated as target only. Known gaps in one list (fill
  handle AT-hidden, pinned rows not keyboard-navigable, no landmark, RTL, contrast excluded
  from automation). Cross-linked from selection-keyboard/index/project-status.
- **OPEN (user/manual): the human NVDA + VoiceOver pass** — after it runs, flip the matrix
  cells and consider a conformance statement. The checklist (moved OUT of the docs page per
  the user's de-internalization call, 2026-08-01): cold-tab reading order/role announcements;
  arrow navigation incl. a jump across a scrolled-out window; editor open/commit/cancel focus
  return; Shift+Arrow range growth announcing the selected COUNT; search live match-count
  timing; full filter/sort-list keyboard reorder announcements; aria-busy skeleton +
  progressbar labels actually spoken; the two documented gaps (fill handle, pinned rows)
  behaving as documented rather than trapping focus.

### 68. Recipes expansion — DONE f62a6dc
- Four recipes on recipes.mdx (single page kept, 488 lines): server round-trip (real DataOp
  shapes, optimistic+rollback AND refetch-on-settle, honest failure path — "no per-cell
  server-error API" flagged as a real gap with today's two patterns), TanStack Query wiring,
  RHF dialog editing (bypass-validate warning included), auth-gated cells. Grid-side snippets
  typechecked (2 real type errors caught); TanStack/RHF illustrative per precedent, zero new
  deps. Cross-links from pagination/editing-cell-types/lazy-loading. Build 91 routes green.
- Backlog candidate surfaced: a per-cell server-error API (post-commit 422 → cell error).

### 69. Overlay-plugin author guide (from #64; docs)
- OverlayPluginCtx AutoTypeTable in api-reference + a "build your own overlay plugin" page
  mirroring custom-cell-types' depth.

### 59. Simplified-Technical-English docs pass — DONE 4866b24
- All 23 .mdx pages rewritten (pragmatic STE): sentence limits, condition-before-command,
  modal ladder, one term per concept (make sure that / configuration / run / show; "render"
  reserved for React). meta.json clean. pnpm build green (85 routes). Bonus fix: stale
  AutoTypeTable path from the store/ split (build was broken without it).
- User reviewed the style mid-lane ("i love the writing style") and gave explicit commit
  approval — the planned uncommitted-review exception was lifted; committed by advisor.

### 58. Header-cell prop grouping — DONE 6a4d9e8/8dd5aaa
- resize/reorder sub-objects formed; rest stayed flat (no third obvious cluster). Internal
  component (not barrel-exported), non-memoized both — verified before touching. column-ux
  32/32 green isolated + full suites green; payloads rebuilt (lane wrongly assumed content
  changes don't need a rebuild — they do; advisor corrected).

### 51. Custom cell type guide (user 2026-07-18) — IN FLIGHT
- A thought-through, high-DX guide for building your own cell type: the CellType contract
  explained with WHY per member, keypoint checklist distilled from real lessons in this repo
  (fromText never throws; toText = canonical serialization vs toDisplayText; hoist/cache
  expensive per-render objects — the measured dateFormatterCache story; SSR-deterministic
  formatting/locale pinning; commit-guard editor pattern; display-only cells via the
  interaction layer; shadcn components for editor UI; GridCellTypes augmentation for typed
  options; compare/isEmpty semantics), with one good worked example end to end.

### 52. Events & state polish round (user feedback 2026-07-18) — IN FLIGHT
- Page/demo structure: sort and filter+join get their own separate sections/numbering.
- Selected VALUES: don't force consumers to hand-roll value extraction — onSelectionChange's
  payload gains a lazy getValues() accessor (materializing values per drag step is too hot for
  an eager array; advisor decision) + docs.
- Remove all "(NEW)" markers — nothing is released, everything is new.
- BUG: onRowWindowChange fires twice per change (visible in the demo log) — find and fix.
- BUG: the grid preview on the events page can't be scrolled — find and fix (demo layout?).
- Gap check: compare our event/state surface against MUI X / react-data-grid / TanStack /
  references (AG docs ok read-only) and implement missing high-DX events/states that fit.

### 53. Standard Schema validation — DONE d320b6a/b65415f
- `validate` is now fn | StandardSchemaV1 (structural "~standard" detection); type VENDORED
  into types.ts per TanStack Form cross-check (references/form) — zero consumer deps,
  @standard-schema/spec is repo devDep only, guarded by a bidirectional conformance type-test.
- Design finding: fn|schema union can't stay bivariant as a plain property (method-shorthand
  hack needs a callable) → ColumnDef grew TValidate (defaults to TValue, erased as `any` only
  at the documented boundary fields). Also surfaced a latent cellClassName variance bug.
- Async at editor-commit layer (use-async-validate.ts): pending readOnly editors (disabled
  swallowed Escape), generation-counter race guard, rejectionCount-keyed commit-guard reset
  (pending→false alone re-fired a stale blur commit). Transforms commit result.value. Bulk
  paths (paste/fill/import) run sync schemas identically; async = pass-through + one dev warn.
- 30 unit + 2 browser + type tests; all gates re-verified by advisor (perf flake pre-existing).

### 48 addendum 2 (user 2026-07-18: "any other feature extractable?")
- Re-checked against the coupling report incl. post-research additions (defaultData/events/
  loading — none extractable). ONE further cut adopted: **row-pinned bands** →
  `data-grid-pinned-rows` add-on (research: no store state, own render path, zero keymap/
  interaction coupling, ~150-250 LOC, low cost). Folded into the extraction sequence as cut #3
  (presence → fill → pinned-rows, one lane each, shared docs/payload churn). Everything else
  stays load-bearing per the report's per-feature reasons; clipboard stays core per user.

### 48 addendum (user decisions 2026-07-18)
- **FILL EXTRACTION: APPROVED** ("nicht zu viel Logik by default") — spec:
  specs/2026-07-18-fill-extraction-design.md; README positioning rewrite included; runs after
  #45 → #53 → presence (shared overlay seam built there). Clipboard stays core.
- **DROPPED by user:** React-Scan prod re-capture + search-icon symptom — closed, no action.

### 54. Ctrl+F capture for the grid search (user question 2026-07-18) — IN FLIGHT
- Native find-in-page over virtualized rows is architecturally impossible (only the window
  exists in the DOM; hidden=until-found needs all rows as nodes — dead at 100k). Our search
  ALREADY scrolls to matches on prev/next (scrollToCell). New: opt-in
  `captureFindShortcut` on the toolbar search — mod+F while focus is INSIDE the grid opens/
  focuses our search (preventDefault, grid-scoped listener); browser find stays untouched
  everywhere else. Docs explain the native-search limitation honestly.

### 55. Structure-split fleet scan → the final refactor (user 2026-07-18)
- **Ask:** store.tsx is large — split it; plus a builder-fleet phase scanning the whole repo for
  files that should become folders (e.g. store/ with types/lib/helpers) for human maintainability.
- **Scan (fleet, read-only, IN FLIGHT):** per-area file census (LOC, symbols, concern clusters)
  + split/merge proposals honoring CONTRIBUTING's rules (domain dirs, no single-file dirs, merge
  tiny siblings, one-symbol-per-file only ≥200 LOC, entry-file convention); one synthesis agent
  merges proposals into an ordered refactor plan.
- **Execution:** merges with the standing structure refactor (memory: runs LAST after
  hardening) + #50's structure findings — one mechanical refactor lane at the END of the core
  queue; registry.json files lists + payload rebuild are part of it.
- **Scan DONE (5-agent workflow):** 13 proposals → 7 adopted, ordered B→C→A→D→E→F→G (duplicate
  barrels deleted first, selection confetti merged, then the store/ split into 7 files
  (types/compute/commit/create-store/provider/hooks + barrel), use-row-window 3-way split,
  three small merges), 6 rejected with reasons (filter-menu/sort-list/io-import/lazy splits
  and flat add-on roots all judged well-shaped). Full execution plan committed:
  plans/2026-07-18-structure-refactor-plan.md — builder-ready, barrel-stable, one lane,
  strictly AFTER #53 + presence + fill extractions.
- **EXECUTION DONE 06cdaf7/fa031c6 (2026-08-01), incl. #56.** B adapted (4 barrels deleted;
  fill/fill.ts skipped — post-extraction it's the add-on's real module, not a duplicate; the
  stale-path test suites were restored, repointed, renamed index.test.ts), C/A/D/E/F/G done.
  store/ map: types ~330 / compute ~300 / commit ~215 / create-store ~430 (one symbol, per
  plan) / provider ~200 / hooks ~400 / index ~60. #56: ColumnDefOf<TData> replaced 9 sites,
  ClipboardProcessCtx<TData> replaced 4; AnyColumnDef kept distinct (different erasure state).
  registry.json 37 surgical line edits. Advisor-verified gates all green: tsc/eslint(0/25)/
  verify, unit 1083/1083 ×2, browser 273/273 (perf test green).

### 56. Repeated-type-expression dedup (user 2026-07-31)
- **Ask:** `ColumnDef<TData, unknown, any>` (spotted at store.tsx:1962) repeats verbatim —
  10 sites across store.tsx/data-grid.tsx, each dragging its own eslint-disable comment.
  Wherever a generic instantiation repeats, name it once instead of duplicating it.
- **Scope:** sweep registry/ for repeated type EXPRESSIONS (≥3 verbatim occurrences of the
  same instantiation, incl. the `{ row: TData; column: ... }` clipboard-ctx shape) and
  replace with named aliases in types.ts next to AnyColumnDef — e.g.
  `ColumnDefOf<TData> = ColumnDef<TData, unknown, any>` carrying ONE documented
  eslint-disable + invariant comment. Judgment call per pattern: only alias where the name
  reads clearer than the expansion; 2-site repeats stay inline. Zero behavior change,
  types-only; public barrel surface must stay identical (type-test proof).
- **Sequencing:** fold into the structure-refactor lane (#55 execution) as a step before the
  store/ split — same files, and the split then moves the aliases into store/types.ts once.

### 57. End-to-end consumer-install type validation (user 2026-07-31; COMPLETELY LAST step)
- **Ask:** we distribute via the shadcn registry — everything type-level must survive a real
  consumer install. The repo leans on many devDependencies; nothing a consumer's compile needs
  may live only there. Prove it, don't assert it.
- **Method (per DEVELOPMENT.md consumer-install guide):** build payloads, serve the registry
  locally, scaffold a FRESH consumer app in the scratchpad (strict + noUncheckedIndexedAccess
  ON, matching our repo flags), install EVERY registry item via `shadcn add @gridcn/...`, then:
  `tsc --noEmit` on the consumer must be clean; next build must pass; spot-check DX in the
  consumer (hover types on DataGrid/ColumnDef/validate: no `any`, generics infer, vendored
  StandardSchemaV1 resolves WITHOUT installing @standard-schema/spec; GridCellTypes module
  augmentation works from consumer code).
- **Known risk classes to check explicitly:** types imported from repo devDeps that consumers
  don't get (the reason #53 vendors StandardSchemaV1); registryDependencies completeness per
  item (install each item standalone, not just the bundle); import-path rewrites
  (fix-registry-imports) leaving no `@/registry/...` leftovers; peer deps the payloads assume.
- **Sequencing:** the FINAL gate of the whole queue — after #53, the three extractions, #49,
  #50, and the #55 structure refactor (which rewrites registry.json files lists). Any failure
  here reopens the offending item.
- **HARNESS RAN 2026-08-01 — CAUGHT A CRITICAL PRE-EXISTING DEFECT (Finding A).** All 35 items
  install exit-0 (presence-first transitive pull works; deps land per-item; StandardSchemaV1
  vendoring HOLDS — no @standard-schema/spec in the consumer tree; @/registry grep clean; DX
  probes b-e pass), BUT consumer tsc = 364 errors / next build FAILS: the CLI (4.12 AND 4.16,
  pre-existing not bump-caused) FLATTENS every item's files into components/ — 88 ../-relative
  imports break AND the 10 domain index.ts files silently overwrite each other. installation.mdx's
  nested-layout claim was never true for real consumers. Fixes: Finding B (@types/papaparse
  devDependency on data-grid-io) DONE 13fbb9e; CLI bump 3b0dcb8 (payloads byte-identical,
  fix-registry-imports still correct); docs-field kept 0f7dd64 (renders clean). Finding A → #60.
- **Registry-spec audit DONE (advisor, 2026-07-31, vs ui.shadcn.com/docs/registry +
  references/ui + references/diceui):** setup is compliant with the current spec — registry.json
  shape, registry-item payloads ($schema/title/description/categories), namespaced cross-item
  registryDependencies (@gridcn/data-grid), static public/r serving, registry/[style]/[name]
  layout; live-tested `shadcn@4.16.1 list/view` against a local serve (32 items OK). One gap
  FIXED: /r/registry.json was a manual copy `shadcn build` never refreshes (mtime proof) —
  fix-registry-imports.mjs now syncs it every payload rebuild. Folded into this item's checklist:
  (a) bump devDep shadcn 4.12.0 → latest before the consumer test and re-verify the
  fix-registry-imports install-time rewrite quirk against that CLI (script depends on CLI
  internals; consumers always run latest); (b) consider the optional `docs` field (post-install
  message, e.g. quick-start URL) on the core item — one line, decide then.

### 73. Docs codeblock horizontal scrollbar missing (user bug 2026-08-01)
- **Report:** code blocks in the docs scroll vertically, but long lines overflow with NO
  visible left-right scrollbar.
- Pre-diagnosis (advisor): the fumadocs CodeBlock viewport is `.fd-scroll-container
  overflow-auto max-h-[600px]` — both axes live on one element that our unified-scrollbar
  CSS styles (thumbs transparent until :hover). Vertical shows, horizontal does not —
  root-cause in the browser (reveal rule? pre width? Tabs overflow-hidden clip?), fix in
  app/global.css / components/preview-tabs.tsx, verify VISUALLY on a real page in both
  normal mdx codeblocks and the Preview/Code tabs, light+dark.

### 75. Import-dialog quick-skip + configuration (user 2026-08-01; spec ready)
- Spec: specs/2026-08-01-import-dialog-config-design.md. X button per mapping row for fast
  skip; `ImportDialogOptions` (defaultDelimiter, autoDetectDelimiter, defaultHeaderRow,
  defaultSkipColumns, mapColumn resolver) applied at preselection time only, zero behavior
  change when omitted. data-grid-io lane; launch when a build slot frees — BEFORE #74 so the
  /dev refresh captures it.

### 74. /dev route refresh — DONE 0ed48bb
- Audit: all 22 examples wired and current; ZERO stale props under app/dev + examples.
  Browser pass over every dev page with real interactions (edit commit, Ctrl+D fill,
  pagination flip, presence highlights moving live, BOTH pinned bands visible, benchmark
  pages compile). Fixes: overlayPlugins arrays useMemo'd in data-grid-demo +
  presence-demo (events-demo was already the template); dev page's pinned-rows description
  corrected (claimed a single top totals row). Payload rebuild folded into the pending
  combined rebuild. Pre-existing cosmetic note: /dev has no <title> metadata (left alone).

### 70. Docs de-internalization + trim — DONE (part 1 in 2dc410e, part 2 c6f04d9)
- Part 1: all internal references removed (workplan/PLAN mentions, competitor-eval narrative
  in events-state condensed); pre-existing broken anchor fixed.
- Part 2 (the user's five prose rules, memory: docs-prose-minimal): comparative framing,
  definitional hand-holding, meta-narration, intro walls removed across 24 pages, net −79
  lines; every page opens example-first (max one sentence above); relocated mechanics passed
  the "does the developer need this" test or were cut; pinned-rows.mdx snippets realigned to
  the averages-top/totals-bottom demo; two more pre-existing broken anchors fixed.
- Process note (advisor error, corrected): the five rules were first mis-addressed to the RTL
  lane (which correctly declined); a dedicated lane applied them. import-export.mdx was
  excluded mid-flight (io lane owned it) — its new sections were written rule-compliant by
  that lane; give it one trim look in a future docs pass.

### 71. RTL implementation — DONE 2dc410e (planner)
- Option B landed: --grid-dir CSS-var signs the three transforms (ZERO per-frame JS change,
  perf test 1/1 green); one normalizeScrollLeft helper resolves the column-window
  contradiction; pointerToCoord/columnAtX in inline space with half-open intervals;
  scrollCellIntoView relative-delta (fixed an LTR bug too); arrows visual via one keymap
  seam (Tab/Home/End untouched); resize/reorder/auto-scroll/pin-shadows direction-aware;
  DirectionProvider + dir both wired; direction = prop with DOM-inherited default, measured
  once. CSS census: 7 logical conversions, rest deliberately physical. Central helpers in
  windowing/direction.ts. +10 unit describes, 18 RTL browser tests, unit 1116, LTR untouched.
- Caveats (documented): no RTL-locale screen-reader pass; dir needed on self-rendered
  portals; no lint rule yet against raw rect.left/scrollLeft outside direction.ts (backlog).
- Fallout fixed by advisor: eslint declared as devDependency 7e35289 (lint script relied on
  a hoisted binary; fresh install pruned it). CHANGELOG entry removed per the user's
  changelog pause (memory: changelog-paused — NO new entries until user starts release logs).

### 72. Continuous-updates performance target + direct-update API (user 2026-08-01)
- **Ask:** new perf target — measure how continuous/streaming value updates (live tickers,
  frequent refreshes) slow the grid; optimize what we find; and evaluate an API improvement:
  update values DIRECTLY (single cell / bulk batch) instead of replacing the whole data
  array, so updates do not re-render everything.
- Research first (normal pattern — user offered a multi-agent debate format but allowed
  skipping it): measure the current update path (controlled data replacement vs defaultData +
  ops; what re-renders per update at 1/10/100 updates per second on 100k rows), find where
  the cost is (viewIndex rebuild? row memo busting? commit batching?), then design the API
  (e.g. updateCells(batch) store action with targeted invalidation) with perf proof.
- SEQUENCING: measurement needs a quiet machine — runs AFTER the #71 RTL lane lands, not in
  parallel with builders.
- **RESEARCH DONE bffd2d1 (planner):** unsorted streaming is a non-issue (0.46ms/tick @100k);
  ONE ACTIVE SORT cliffs to 56ms (computeViewIndex full rebuild incl. Intl.Collator per data
  identity). Spec: specs/2026-08-01-direct-update-api-design.md.
- **BUILD DONE 744aece/9f2e72d (planner):** updateCells/updateRows/reconcileView +
  useDataGridViewStale; cached maintained rowId→index map (rebase vs invalidate audited per
  mutation path, tested); defer-default with auto-downgrade; controlled echo-detection;
  source:"stream" history-excluded (recordSources opt-in). PROVEN (prod, paired in-launch):
  sorted 33ms → 0.004ms/tick, 1 DOM mutation/tick (bar ≤6), scroll FPS unchanged; regression
  test guards the fast path. New /docs/streaming-updates page + data-grid-streaming-demo
  ticker (user decided: dedicated page). Unit 1171, browser 307, catalog 36 items.

### 76. Docs theme: grid style, no roundings + ncdai components (user 2026-08-01)
- **Restyle:** the docs style schema has too much rounding — NO rounded corners, sharp
  corners, "more grid style"; update the schema generally to fit the grid aesthetic (radius
  tokens to 0/near-0 across docs chrome; the paper-theme softness gives way to a technical
  grid look; keep the token-driven approach and light/dark).
- **Components:** install `@ncdai/github-stars` (place bottom-right in the sidebar) and
  `@ncdai/theme-toggle-effect-polygon` (replace/wire the theme toggle) — and SLOW DOWN the
  polygon effect animation ("too fast for my taste").
- Docs-site chrome only; grid components stay shadcn-token-pure. Parallel-safe vs the
  updateCells lane (registry core untouched).
- **DONE 5e78ef4.** --radius 0 (whole scale via the calc chain, zero exceptions needed);
  shadows flattened to hairlines; the "square fumadocs chrome" block covers what fumadocs
  hardcodes (NO upstream radius var exists — block is load-bearing across upgrades); user's
  flagged inline-code chip verified square via DOM audit (computed border-radius sweep empty
  on home/editing-cell-types/search dialog, both themes). @ncdai namespace registered;
  github-stars in sidebar footer (silent no-op until the repo is public); polygon theme
  toggle at 1.4s (was 0.7s) behind --theme-toggle-polygon-duration.
- **INCIDENT during the lane:** an external git reset --hard wiped the uncommitted tree
  mid-flight (both lanes affected; theme lane rebuilt from session context, streaming lane
  warned + verifying). Standing rule reinforced in briefs: lanes never run reset/checkout ./
  broad stash; baselines via git show or worktrees. Also: Tailwind v4 scans every
  non-gitignored path — page-dump scratch files in the repo poisoned the generated CSS once
  (transient, fixed); dumps belong in the session scratchpad only.

### 77. URL pagination — DONE 987bbf6
- useDataGridUrlPagination → spreads into pagination's server mode (client mode seeds
  pageSize once, can't take URL changes — documented why). Clamping, omit-at-default,
  replace-history, pageSize-change resets page. DIY snippet retired from docs.

### 78. Incremental sort maintenance — DONE 952cdb7 (planner)
- updateViewIndex: remove → filter re-test → binary reinsert with the data-index tiebreak
  (proven equivalent + total order). 3840 fuzzed element-identical assertions, 3 stable runs;
  dev builds compare 5% of ticks and fall back on mismatch. Six valves; crossover 256
  (measured slope 0.027ms/row, curves meet ~15k). 100k immediate: 415ms → 0.25ms (k=1),
  0.86ms (k=20); defer unchanged. buildViewIndex byte-identical reference. Note: the research
  doc's ~26-30ms rebuild was machine-dependent (this box: 415ms) — headline numbers are
  paired same-launch ratios only.

### 79. Async bulk validation — DONE 96544c6 (planner)
- runValidateBatch: straight-line sync until the first Promise, then 32 lazy worker slots;
  held batch applies in ONE commit, skip-on-reject + result.value transforms. Per-surface
  generation guards (paste/fill/import/streaming) with rowId-keyed targets — pure reorders
  survive. Sync path proven untouched (Promise.then + queueMicrotask spy probe). Streaming
  prevalidates then re-enters with skipValidation. Direct callers of buildPasteWrites/
  buildFillWrites/buildImportedRows now get T | Promise<T>. Dev-warn retired.

### 80. Per-cell server-error API — DONE 19c2aa2
- cellErrors map + setCellErrors/clearCellErrors (not a data change), auto-clear audited
  across every write path, vanished-id pruning on deleteRows/replacement, aria-invalid
  ring/tint + role=alert message (input.tsx convention), zero-render probes green. Recipes
  failure path rewritten to the real API. Open review nits for the user: ring/tint design
  eyeball, whether useDataGridRowHasError stays public, dark-mode contrast eyeball.

### 81. Full-repo optimization audit (high-capability fleet) — DONE (report)
- 8 finder dims, 90 findings; all 25 highs adversarially verified (22 confirmed/plausible,
  3 refuted). Report: docs/agent-work/2026-08-02-optimization-audit.md. Fix queue below.

### 82. Registry payload integrity (CRITICAL, confirmed) — DONE 4411aa7 (+payload rebuild)
- fix-registry-imports.mjs rewrites ONE literal; 25 unrewritable aliases ship in 16 payloads
  (incl. non-demo data-grid-pagination + data-grid-lazy) → consumer module-not-found.
- Lane: generic blocks→components regex rewrite, fail-loud payload gate (no
  `@/registry/default/blocks/` may survive), lazy-guard isDev via barrel (add barrel export),
  pagination-footer barrel import, eslint no-restricted-imports barrel-only rule,
  registry-smoke derives item list from registry.json. Payload rebuild = advisor, after lanes.

### 83. updateCells sync-schema generation burn (data loss, confirmed) — DONE e72d125
- `++streamGeneration` runs before the `instanceof Promise` check; a sync-schema write silently
  discards an unrelated in-flight async batch. Move token into the Promise branch + regression
  test (async batch + sync-schema batch → both onDataChange land). create-store.ts:592.

### 84. Context menu × pinned rows (confirmed) — DONE f48f45d
- resolveContextMenuTarget: `ariaRow - 2` ignores ariaRowIndexOffset (off by pinnedTopCount;
  wrong-row delete/insert) + pinned-row cells not excluded from the gridcell selector.
  Fix both + composed test. resolve-context-menu-target.ts.

### 85. Cell-type `compare` never wired into sorting (confirmed) — DONE 31251fd (+ colon-safe cellErrors pruning; empty-last unified; docs updated)
- number/date/select columns sort as strings. Wiring changes observed sort order (bug fix,
  but user said "as long we dont breka the sorting" — flag in handoff). compute.ts + tests.

### 86. Perf trio (confirmed) — DONE d4d4a63
- useDataGridAllRowsSelectedState O(rowCount) selector per store change (hooks.ts);
  scroll-tick read→write→read layout thrash (use-scroll-snapshot.ts); clipboard column-copy
  per-cell serializeRowSlice + no cell-count cap (use-grid-clipboard.ts).

### 87. Test integrity (confirmed) — DONE d170e8b (found #90 via positive controls)
- RTL browser tests self-skip via `if (!x) return` (selection-rect selector matches nothing —
  dead assertions); bulk-validation staleness half untested at real call sites (paste/fill
  integration cases incl. positive control). Ban bare early-return guards in browser tests.

### 88. API surface S-fixes (confirmed) — DONE 20227b3 (row-op keys: mod+shift+f / mod+shift+x)
- Re-export ColumnDefOf + ClipboardProcessCtx from the entry barrel; DataGrid wrapper forwards
  duplicateRow/cellTypes/labels (+ drift type-test); useDataGridFill stable FillHandleTracker
  identity (mount-count regression test); cellErrors key colon collision (compute.ts split fix).

### 89. AI-narration comment sweep — DONE (sweep found zero outside lane files; lane files cleaned in e72d125/4411aa7)
- User ask: remove comments that narrate what the next lines do / restate code (example:
  "// Async branch: resolve every verdict BEFORE ..."). Keep one-line non-obvious-why
  comments, directives, policy-compliant JSDoc. Sweep lane covers the repo minus the files
  the #82/#83/#84 lanes touch (those lanes strip their own). Comments ship in payloads, so
  the pending post-lane payload rebuild covers this too.

### 90. Bulk writes land by stale viewRow after mid-flight reorder — DONE 2026-08-02
- Found by #87's positive-control tests, traced live in paste AND fill: isBulkBatchCurrent
  only checks target ids still exist; BulkWrite carries viewRow (no rowId), and the batch
  applies against the CURRENT viewIndex → pure reorder during async validation = write on the
  wrong row. Fix: carry rowId through BulkCandidate/BulkWrite, re-resolve post-guard; then
  flip the two "BUG (workplan #87)" tests to the intended assertions. Silent cross-row
  data corruption, live today.

### 91. useDataGridAggregate (filter-aware pinned totals) — DONE b75838f (user-reviewed)
- data-grid-pinned-rows hook: { [columnId]: 'sum'|'avg'|'min'|'max'|'count'|fn }, reduces over
  viewIndex (filter/search-aware), over: 'view'|'all' escape hatch, memoized on viewIndex+data
  identity. Docs totals section rewritten around it; demo updated. Audit report has full spec.

### 92. rowId-native presence adapter — DONE d19452b
- Core useDataGridRowIdToViewRow() (viewIndex-identity subscription, lazy Map) + presence entry
  type { id, color, rowId, columnId } resolved at paint, filtered-out rows dropped. Replaces the
  O(n)-per-store-change DIY mapping in multiplayer-presence.mdx. Audit report has full spec.

### 93. Docs example expansion — DONE 6811197/8a337e9/9767d83/7a571d6 (user-approved list)
- User: examples missing for validation/invalid-input look; a playground demo with as many
  features as possible + switches for mutually exclusive ones (pagination vs lazy loading);
  scan all docs H2 sections for meaningful example gaps and fill them.
- Phase 1: planner scan → gap plan in docs/agent-work/. Phase 2: builder lanes (new
  registry examples + registry.json entries + docs embeds). Payload rebuild at the end.

### 94. Demo instruction sweep — DONE (18 demos hinted, 11 skipped self-evident)
- Every interactive demo states the required action + any hidden rule/threshold in a visible
  hint line (pattern: reworked validation demo). Example: cell-errors "Quantity > 100, ~600ms".

### 95. RTL cell/caret fixes + language-driven i18n demo — DONE
- Core: dir="auto" cell span pinned Latin values physically left under RTL (header/editor
  diverged) -> <bdi>; editor inputs get dir="auto". 6 new glyph-position browser tests (the old
  suite only measured boxes). Demo: shadcn RTL pattern - locale carries dir, no separate switch,
  Arabic fully translated.

### 96. Loading-state redesign — CANCELLED by user (dim + variants page reverted; original slim bar kept)

### 97. Demo/preview overflow — DONE 643a115 (preview centring) + 2f3dc09/a4fac22 (21 demos)
- User: /docs/fill-handle preview broken. TWO causes. (a) preview-tabs.tsx centred an overflowing
  flex child, so its left edge was unreachable by scroll — fixed 643a115 (justify-center-safe) +
  regression test. (b) demos declared more fixed column width than the ~415px preview box —
  lane fixing all demos + demo-fit.browser.test.tsx over every demo with a reasoned allow list.

### 98. Manual install docs — DONE 3bed048 (primitives) / 33ea174 (tab shell) / 3414134 (rollout)
- Spec: docs/agent-work/specs/2026-08-03-manual-install-docs.md. Add-ons get a real copy-paste
  Manual tab; the 89-file/654KB core deliberately does NOT (procedure + file tree instead).
  Data read at build time from public/r/<item>.json. Lanes: A primitives -> B tab shell ->
  C component + MDX pages (A and B share install-command.tsx, so sequenced not parallel).

### Remaining audit leads (not scheduled)
- insertRowBelow/duplicateRow keys: DONE in #88.
- 65 unverified medium/low leads: see the audit report.

### Backlog candidates (rescued from docs during the de-internalization sweeps, 2026-08-01)
- Per-cell server-error API: surface a post-commit server rejection (422) as a cell error —
  from #68; today's patterns are toast+revert or history undo.
- data-grid-pagination + data-grid-url-state composition helper (page param in the URL) —
  docs currently show the DIY nuqs hook.
- rowId-native presence adapter (auto map rowId→view index over sort/filter, convenience
  hook) — docs currently show the manual mapping.
- Lint rule forbidding raw rect.left/scrollLeft outside windowing/direction.ts (RTL risk #3).
- Full register of every product gap + reason: docs/agent-work/2026-08-01-not-supported-register.md.

## Awaiting user input

- **Search icon:** my class fix (7f206db) was likely a no-op (`inset-inline-start-*` proved to be
  valid Tailwind v4). If the icon still looks wrong: what exactly (overlap/size/gap/color)?
- **Profiling repro:** was the React Scan capture (552 cell renders, 154ms other time) from a
  FLING or a SLOW scroll? Fling = expected mount cost (dev-mode inflated); slow scroll = real
  regression of the phase-3 render-count contract. A prod-build repro would settle it.
- **Skill installs:** shadcn/ui@shadcn, vercel-react-best-practices (appears installed already),
  addyosmani accessibility — user runs the npx commands if wanted.

## Standing follow-ups

- **Payload rebuild** after lanes 1-4 land: `npx shadcn build && node scripts/fix-registry-imports.mjs
  && node scripts/verify-registry.mjs`, commit public/r once.
- **perf.browser.test.tsx load-sensitivity:** dips below the 15fps floor only under concurrent
  machine load (builders/suites). If it flakes in CI, add a retry annotation — do NOT lower floors.
- **jsdom "unit" project rename check:** coverage agent renamed the project; commands are
  `npx vitest run --project=unit` / `--project=browser`.
- **Perf measurement discipline (2026-07-18, from #44):** headed-Chromium fps is BIMODAL per
  browser LAUNCH (~24 vs ~45fps modes, stable within a session, hits every grid equally) —
  single-run before/after comparisons are not decodable. Pair A/B arms within one launch, or
  take medians over ≥5 launches. Also: perf.browser.test.tsx's isolated-run failures can be a
  machine-load artifact — verify against a clean stash checkout before blaming a change.
- **Drive-letter casing gotcha (2026-07-18):** browser suite can fail at import with
  `c:\C:\...` fumadocs-typography resolve errors when the shell cwd uses a LOWERCASE drive
  letter (fumadocs emits uppercase-C absolute specifiers; path.resolve mangles the mix).
  Fix: run suites from the repo root with an UPPERCASE drive letter. Clearing
  node_modules/.vite alone does NOT fix this variant.

### 99. 65 unverified audit leads — DONE a84a81c (verify) / 53a9b78 (fix)

Phase A + Phase B complete. 19 fixed, 4 feature gaps left as product decisions, 42 dismissed.
Gates green: tsc, eslint (0 errors), unit 1426, browser 368, verify-registry, next build.

FOLLOW-UP DONE 925978c: `getRowIds()` on SelectionChangeDetails, `scope: "selection"` for export,
B14 payload-content gate (`scripts/verify-payload-content.mjs`, wired into CI before the rebuild).
Docs: manual screen-reader pass removed from the a11y matrix (not planned); comparative framing
dropped from README + homepage.

STILL OPEN from this item:
- **2 of the 4 feature gaps remain** — `isAnyOf` multi-value filter operator (M: touches the
  operator union, `FilterSpec.value` widening to `string[]`, both matchers, and the filter-menu
  value input) and the row-settled validation seam (M: needs a new "row settled" signal threaded
  through every write path). Both additive, both new public API. USER DECISION.
- Both handled by the user in 2c94add (register row + clipboard `settle()` removal).

Source: `docs/agent-work/2026-08-02-optimization-audit.md` (final table, 65 medium/low leads).
These were NEVER adversarially verified. Some are already stale (the `pruneCellErrors` colon
lead was fixed by #85). Process: verify first against current HEAD, then fix only survivors.

- Phase A — verification fleet, 7 lanes, read-only — **DONE 2026-08-20**. Verdicts written back
  into the audit report's table as a `Verdict` column. **19 confirmed / 4 feature gaps / 42
  dismissed.** Two-thirds died on contact; all 8 rendering-perf leads were refuted by measurement.
- Phase B — fix lanes for the 19 CONFIRMED only, grouped by file-set so lanes stay disjoint.
  The 4 GAPs are product decisions, NOT part of this item — do not build them unprompted.
- Gates per lane: tsc, eslint, affected vitest project. Payload rebuild if `registry/` changed.

**Confirmed defects to fix (19):**

| # | Where | What | Effort |
|---|---|---|---|
| B1 | store/hooks.ts | `useDataGridRowHasError` prefix-matches; error on `"a:b"` makes `"a"` report true | S |
| B2 | store/create-store.ts | `applyCellUpdates`/`deleteSelection`/`commitCellEdit`/`commitCellValue` never set `viewStale` or refresh `searchMatches` — **regression from #72 (744aece)** | M |
| B3 | store/create-store.ts | `insertRow`/`duplicateRows` do not prune `cellErrors`, contradicting two documented contracts | S |
| B4 | clipboard/parse-clipboard.ts | per-character concat; 20MB paste blocks 274ms vs 84ms, and unlike copy there is no cap | S |
| B5 | data-grid-io/build-imported-rows.ts | 100k-row import blocks ~307ms with no pending affordance and an inert Cancel | M |
| B6 | data-grid-io/parse-import-file.ts | multi-sheet workbook silently imports sheet 1 with no warning | S |
| B7 | data-grid-context-menu | shortcut hints read `DEFAULT_KEYMAP`, ignoring the consumer keymap | S |
| B8 | data-grid-io/export-grid.ts | object URL revoked on the click tick; anchor never appended | S |
| B9 | data-grid-history/use-data-grid-state.ts | fresh `getRowId` per render rebuilds the O(n) rowId Map, breaking #92's contract | S |
| B10 | keybindings + context-menu | both read deprecated `navigator.platform`; core probes `userAgentData` first | S |
| B11 | add-on hooks | `getRowId` arity mismatch (core 2-arg, add-ons 1-arg) causes real TS7006 for consumers | S |
| B12 | store barrel + entry | `cellErrorKey` not exported while docs tell consumers to hand-build keys | S |
| B13 | data-grid.tsx | 5 store hooks in the store barrel absent from the public entry | S |
| B14 | scripts/ + CI | nothing asserts built `public/r/*.json` payloads match source blocks | M |
| B15-B20 | tests | 6 test-integrity gaps: composed URL-pagination test, `performance.memory` no-op assertion, 4 sleeps in rtl.browser, duplicated `StoreProbe`, dev-valve sampling, 3x-microtask drain | M |

**Do NOT re-litigate the 42 dismissed.** The audit table records why. Three carry-forward notes
(concurrent-features re-open trigger, `navigator.platform`, missing register row) are in the
audit report under "Lane reports".

### 101. validateRow — per-row cross-field validation — DONE (this commit)

User decision: per-row (not per-gesture). Spec: `docs/agent-work/specs/2026-08-20-validate-row.md`.
`validateRow?: (row, rowId) => Record<columnId, message> | null` on Provider/DataGrid; runs once
per touched row after every write gesture commits (edit/paste/fill/delete-contents/updateCells/
updateRows), AFTER clearErrorsForOps; errors land in `cellErrors` (same display as #80 server
errors); values still commit; closure-scoped ownership map so re-runs clear exactly their own
stale keys and never consumer `setCellErrors` entries. Not run on insert/duplicate/delete/consumer
data replacement; sync-only v1. 7 regression tests incl. the order-independence defining case and
an ownership-clearing case proven to bite via sabotage. Closes the last of #99's four feature gaps.

### 100. Test-infra evaluation — spec PROPOSED, decision pending

`docs/agent-work/specs/2026-08-20-test-infra-evaluation.md`. Question: do we need more than
Vitest (Playwright etc.) for consistency/reliability? Answer: browser project ALREADY runs real
Chromium via the Playwright provider. Recommendation: D (config-only fixes: perf project split +
serial, browser-only retry:1, bundle harness stylesheet, pin duplicate React) = yes; C (tiny
capped Playwright Test layer: WebKit/Firefox smoke on clipboard/download/RTL + built-docs-site
smoke) = yes-but-small; B (wholesale Playwright rewrite) = no. Sequencing: D first, C after the
perf.browser.test.tsx investigation lands. USER DECISION on the spec's three questions.

### 102-105. z-index scale + parallel lane batch — DONE

- **#102 GRID_LAYER** (eee54e6 / 76264f7 / 7828e9f): one named scale in `data-grid/layers.ts`,
  every value BELOW shadcn's z-50 portal tier (dialog must always beat the grid, incl. for
  registry consumers), `isolation: isolate` explicit on the root, real-Dialog contract test.
  Follow-up 7828e9f: `pinnedOverlaySegment` layer + the unit test my refactor had broken
  (lesson recorded: run the FULL unit suite before pushing, not just browser).
- **#103 playground lazy+sort** (affe1f6): sort spec now goes to the API; pages never re-sorted
  client-side. recipes.mdx had documented a NON-WORKING pattern (`sortable: false` does not
  suppress sorting) — corrected. CORE GAPS recorded in the commit message: no pre-sorted-data
  mode, suppressed sort blanks aria-sort (a11y), toggleSort cycle not reusable, lazy hook has no
  invalidate. USER DECISION whether to build any of these.
- **#104 react-compiler-eval** (branch, pushed): verdict WORKS AS-IS — 315/315 components
  compile, zero real-behavior breaks; 2 unit tests assert anti-patterns the compiler optimizes
  away. Trap documented: @vitejs/plugin-react v6 silently ignores its removed `babel` option —
  guard tests on the branch fail loudly if the compiler is unwired. Merge is a USER DECISION.
- **#105 GRID_ATTR** (this commit): typed `data-grid-*` attributes — 32 entries +
  `gridAttrSelector`, barrel-exported; SET sites keep literal JSX (Tailwind's scanner needs
  literals) locked to the constants by type-tests; all QUERY sites in source+tests converted.
  Typo sabotage fails 21 tests.
- react-grab 0.2.0 installed dev-only (76264f7).

### 106. react-grab fix + deps update + compiler suite (branch flow) — DONE

Branch flow now: `main` -> `dev` (risky work staging) -> `react-compiler-suite`. All pushed.

- **react-grab** (main 660f1d8): double-init - the ESM build auto-inits on import; the extra
  exported-init() call built a second bare engine (no toolbar/hotkeys) replacing the global API.
  Bare side-effect import fixes it. /dev console errors are react-scan's, not react-grab's.
- **deps update** (dev e9c4524): full in-range sweep + jsdom 30 / jest-dom 7 / cnfast 0.1.0;
  SKIPPED typescript 7 (broke consumer smoke before) and react-table 9 (benchmark-only). Fixed
  what the update surfaced: vitest default browser port 63315 is inside a rotating Windows
  excluded range (EACCES) -> pinned 52121 strictPort:false; eslint descending into
  agent worktrees; pnpm key migration to pnpm-workspace.yaml; ONE tracked-file machine-path
  privacy violation (debug screenshot in preview-overflow test) - also hot-fixed on main
  (f8c7849), diff-scan pattern widened to forward-slash paths. Single React copy again (D4).
  MERGE dev -> main is a USER DECISION.
- **compiler suite** (react-compiler-suite, 4 commits): opt-in `unit-compiled`/`browser-compiled`
  vitest projects + `pnpm test:compiler` + CI step; guard tests assert memo cache present under
  compiled AND absent under plain (an unwired compiler fails loudly, sabotage-verified); the two
  test-construction incompatibilities made honestly dual-mode. Four-project matrix green.
  NOTE for merge: the branch pins browser ports 5301/5302 (two projects can run concurrently),
  dev pins 52121 - reconcile in vitest.config.ts, prefer the two-port shape. `pnpm test` scoped
  to the two default projects so the compiled ones stay opt-in. MERGE is a USER DECISION.
- Known separate nit (pre-existing): playground demo test's 30s beforeAll import budget is
  load-marginal; raising that one hookTimeout is a 1-line follow-up.

## Done this burst (context for the above)

Late-2026-07-17 additions, all committed: #10 flex fill (cfe02bf) · #11 barrel rename (5dfec73)
· #12 docs batch (dc0308f) · #6 lazy phases 1-3 (3e3041d, e2f4748, e3738d6) · #13 marker UX
(d59c290) · #19 click render storm (9ddbf8b) · #15 import dedup (4006e0d) · #16 filter upgrade
(5fe316a) + sort-list add-on + credits (0aa7cfd) · #14 tablecn report (0d68074) + overscan
settle reset (9f0200b) · #9/9b perf audit (7e290dd: 29x search-match lookup, heap script,
content-visibility definitively rejected on subgrid conflict) · #18 RTL wording (3959631) ·
#20 presence highlights (329f810, spec 015ecfa).


fill-crash on computed columns (5ecd05b) · filter i18n demo labels (55defbb) · cnfast/deps
consolidation (0c3944f) · perf docs slim + README benchmarking (7598ce4) · home Button
nativeButton (b6d666c) · search icon class canonicalization (7f206db, possibly cosmetic) ·
import-dialog overflow + aligned mapping grid (882740c) · docs code-scroll (be970fc) ·
LLMs .md rewrite (aa966d0) · sort/filter port from fifes-web (97ef968) · pinned hover opacity +
shadow measurement hook (e99385d) · payloads (e2bf5a9) · docs polish: AutoTypeTable, sections,
callouts, landing grids (89887ea) · diceui-style preview panel (555682b, b3647c9) ·
package-manager install tabs (c82e81d, 01f1fd8).

### 100. Handoff maintenance leftovers — DONE

Recorded the settled URL-state browser back/forward behavior in the not-supported register.
Replaced the clipboard async-validation tests' fixed microtask drain with condition-based waits.

Gates: focused clipboard 11/11; tsc; eslint 0 errors / 24 warnings; unit 1426 passed with the
known load-sensitive playground hook timeout, then playground isolated 2/2.
