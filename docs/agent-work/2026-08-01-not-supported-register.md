# Not-supported / not-yet-implemented register

Every product-level gap with its reason, collected 2026-08-01. Sources: the lean-core
coupling evaluation, the core-strategy decision, the #57/#60 consumer harness, the #64
persona reviews, the streaming research, and the shipped docs. Status legend:
REJECTED = deliberate no with a decision behind it; NOT YET = plausible later, cut for a
stated reason; INHERENT = follows from an architecture choice we stand behind.

## Grid features

| Feature | Status | Reason |
|---|---|---|
| Row grouping + aggregation | REJECTED | Analytics-grid territory. The vision is an Excel-like EDITABLE grid; grouping drags in a second row model (group rows, expansion state, aggregate recompute on edit) that conflicts with the flat viewIndex coordinate space every subsystem (selection, windowing, clipboard, presence) builds on. |
| Cell merging / column spanning | REJECTED | The zero-render architecture assumes a uniform lattice: windowing, overlay rect math, and pin-zone segmentation all address cells as (viewRow, viewCol). Merged spans break that addressing everywhere at once. `cell-span.tsx` covers the display-only case. |
| Tree data / master-detail rows | REJECTED | Same second-row-model problem as grouping (expansion state, indent semantics, keyboard model changes). Named explicitly after the skeptic review so silence does not read as oversight. |
| Pivot tables | REJECTED | Wholly different product (data reshaping, not editing). |
| Canvas rendering | REJECTED (2026-07-16, 12-agent eval) | Real DOM cells styled by the consumer's shadcn tokens ARE the product identity. Canvas (Glide's approach) wins raw scroll perf but loses token styling, DOM extensibility, and the a11y tree. Fallback if perf ever demands it: row pooling, gated on a real-drag perf test — the gate was measured and NOT met. |
| TanStack Table as core | REJECTED (2026-07-18) | It supplies none of the hard parts (windowing, range selection, clipboard, editing engine, overlay painting) and measured the worst retained memory of the field (1.66GB after 5 mount cycles). Revisit trigger: their cellSelectionFeature reaching GA. |
| React 18 | NOT SUPPORTED | Hard dependency, not policy: the store provider reads context via React 19's `use()`. Verified in the #66 lane. |

## Editing & data

| Gap | Status | Reason |
|---|---|---|
| Async (Standard Schema) validation on bulk paths (paste / fill / import / streaming) | SHIPPED (2026-08-01, #79) | The batch is HELD, every cell validates with a ~32-in-flight concurrency cap, then the accepted cells commit in ONE `DataChange` with the existing silent skip-on-reject; transforms commit `result.value`. A per-surface generation counter drops a superseded batch (paste-over-paste, data replacement, sort/filter change, unmount); targets are rowId-keyed so a pure reorder survives. Sync-only batches keep the old straight-line path — `runValidateBatch` returns the array, never a Promise, and allocates no async machinery. `skipValidation` stays the trusted-feed fast path. The dev-warn is gone. Latency is the consumer's schema's; `processPaste` remains the one-request-per-block escape hatch. |
| Per-cell server-error API (post-commit 422 → cell error) | SHIPPED (2026-08-01, #80) | `cellErrors: ReadonlyMap<string, string>` keyed `rowId:columnId`, set via `actions.setCellErrors`/`clearCellErrors`. Auto-clears on the next successful commit through every write path (commitCellEdit, commitCellValue, applyCellUpdates, updateCells, deleteSelection); pruned of vanished rowIds on deleteRows and any genuine (non-echo) `data` replacement. NOT a data change: no DataChange, no history entry, no onDataChange echo. Same ring/tint/aria-invalid visual language as a sync `validate` rejection; an errored cell's editor shows the message the same way `editingError` does. Zero-render: `useDataGridRowCellState` carries `errorCols` the same null-not-empty-Map way `searchMatchCols` does, so only a row with an actual error re-renders. |
| Incremental sort maintenance (`reorder: "immediate"` cheap at 100k) | SHIPPED (2026-08-01, #78) | `"immediate"` now removes each patched row, re-tests filter membership, and binary-searches it back in under the identical comparator chain incl. the dataIndex tiebreak. Measured 0.3 / 0.9 / 7.6 ms for 1 / 20 / 256 patched rows at 100k, against ~415 ms for the full rebuild on the same machine. Correctness bar was element-identical viewIndex vs the rebuild, proven by a ~3800-assertion fuzz suite plus a sampled dev-mode assertion. Batches over 256 rows, a same-tick sort/filter change, or a custom column comparator fall back to the untouched rebuild. |
| Streaming updates in undo history | DELIBERATE DEFAULT | At 100 ticks/s a stream evicts the user's entire undo stack in seconds (finite capacity). `source: "stream"` is skipped by history; `recordSources` opts in. |

## Pinned rows (v1 scope)

| Gap | Status | Reason |
|---|---|---|
| Pinned rows read-only, not keyboard-navigable, outside selection/sort/filter | NOT YET (v1 scope cut) | They are separate consumer arrays (no getRowId, index-keyed), designed for totals/summary bands. Making them navigable/selectable means extending the entire keyboard + selection coordinate model to a second row space — a real design project, not a flag. |

## Accessibility

| Gap | Status | Reason |
|---|---|---|
| Fill-handle drag invisible to assistive tech | INHERENT (documented) | The handle is a pointer-only affordance. The accessible path is the keyboard fill (mod+D / mod+R), which is fully announced. |
| No page landmark from the grid | INHERENT | The grid is a component, not a page region; the consumer owns the landmark structure. |
| Color contrast excluded from the automated a11y suite | TOOLING | The axe contrast checks were unreliable in the headless environment (canvas/color readback flakiness) — excluded for signal quality, not because contrast does not matter. |
| Screen-reader conformance (NVDA/JAWS/VoiceOver) | NOT YET VERIFIED | No manual pass has run. The docs matrix says exactly that; the test checklist lives in workplan #67. WCAG 2.1 AA is stated as a target, never claimed. |
| RTL: bidi text shaping, portaled content | PARTIAL (RTL itself SHIPPED 2026-08-01) | Direction, mirroring, hit-testing, and keyboard semantics are supported. Bidi SHAPING inside a cell is the browser's job (`dir="auto"` marks direction and stops); self-rendered portals outside the grid subtree need an explicit `dir`. No RTL-locale screen-reader pass yet. |

## Add-ons & composition

| Gap | Status | Reason |
|---|---|---|
| Pagination page-state in the URL (url-state composition) | SHIPPED (workplan #77) | `useDataGridUrlPagination` in `data-grid-url-state` syncs `page`/`pageSize` with the URL and spreads straight into `useDataGridPagination`'s server mode; no hard dependency between the two add-ons. |
| URL state re-applied on browser back/forward | REJECTED | `useDataGridUrlState` reads the URL once on mount, then the grid store becomes the source of truth and replaces URL state without creating navigation entries. |
| Column layout in the URL | REJECTED | Column layout (widths/order/pins/hidden) is device-local preference, not shareable view state; it has its own persistence pair (`initialColumnLayout`/`onColumnLayoutChange`). |
| Lazy loading: client-side sort/filter/search over unfetched rows | INHERENT | Sparse data cannot be sorted/filtered client-side without fetching everything — which defeats lazy loading. The grid dev-warns on the combination; server-side sort/filter is the supported pattern. |
| Export formats beyond CSV + xlsx (JSON, PDF) | REJECTED | JSON is trivial consumer-side (they own `data`). PDF means a heavy rendering dependency for a feature AG gates behind Enterprise; out of scope for a registry-distributed component. |
| `onEditStart` / `onEditStop` events | REJECTED (events gap-check) | Evaluated against competitor catalogs; judged surface growth without a driving use case — editing state is already observable via `useDataGridState`/editing hooks. Adopted instead: onCellClick, onRowClick, onColumnResize. |

## Internal perf levers (evaluated, rejected — do not re-explore blind)

| Lever | Verdict | Reason |
|---|---|---|
| Row pooling | Gate NOT met | Measured benefit did not clear the bar on real drag tests. |
| Velocity-overscan cuts | REJECTED | Blank frames 42 → 231 — trades away the no-blank guarantee. |
| Deferred/post-paint overscan commits | REJECTED | Amplifies churn instead of reducing it. |
| content-visibility: auto | PARKED (highest-value revisit) | Up to 5x fps in isolation, but breaks the pin-shadow painted-pixel probe (32px offset). Reopen only by first adapting the pin-shadow measurement (workplan 9b). |

## Project-level

| Gap | Status | Reason |
|---|---|---|
| github-stars badge renders nothing | WAITING | The repo is not public yet; the component no-ops gracefully until then. |
| CHANGELOG | PAUSED | Pre-release; the user starts release logging explicitly. |
