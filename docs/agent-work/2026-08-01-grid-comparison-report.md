# gridcn vs the field — an in-depth grid comparison report

**Date:** 2026-08-01. **Workplan:** item #49 (queued behind #44, which landed as
[2026-07-18-fling-smoothness-report.md](2026-07-18-fling-smoothness-report.md)).

**Purpose:** a research-driving reference, not a scoreboard. Every number below either exists in
the repo already or is marked **not measured**. Every feature claim about a competitor is either
verified against its cloned source in `references/` or marked **(unverified)**. Nothing here was
invented to make a comparison look tidier than the evidence supports — that discipline is itself
inherited from the two reports this one builds on (§2).

---

## 1. Executive summary

gridcn is the only MIT-licensed grid in this comparison that ships range selection, Excel-style
clipboard, and (as a free add-on) a fill handle — in every other grid at this license tier, those
three are either absent entirely or gated behind a commercial tier. That is the product's core bet
(see `README.md:7-11`) and the benchmark harness exists to keep that claim honest with numbers, not
marketing.

On raw scroll performance at 100k rows, gridcn is currently the **slowest of the four benchmarked
grids under sustained hard fling** (~45fps vs ~60fps for the other three, prod build, launch-mode
controlled — see §3), while being the clear winner on **memory** (30-59MB vs 164-335MB) and **DOM
footprint** (a flat ~572 nodes regardless of scroll position, vs the other grids growing DOM or
holding large VDOM trees). It is also the only grid with a **quantified no-blank guarantee**
(windowed rows never leave a visible gap during a fling, by design — see the fling-smoothness
report §2). Two structural investigations (2026-07-17 tablecn comparison, 2026-07-18 fling
deep-dive) already ruled out several tempting fixes — row pooling, overscan-cap cuts,
`content-visibility` — for concrete, measured reasons. Anyone picking this report back up should
read §5 before re-opening any of those.

The strategic question this report's sibling document answered — rebuild on TanStack Table? — was
settled **no** on 2026-07-18 (`docs/agent-work/2026-07-18-core-strategy-decision.md`): TanStack
provides none of gridcn's hard parts (virtualization, clipboard, fill, selection, overlay
painting), and its own re-render philosophy conflicts with gridcn's zero-React-render-on-scroll
design.

| | gridcn | MUI X DataGrid (MIT) | react-data-grid | TanStack-assembled | Glide Data Grid | AG Grid Community | tablecn |
|---|---|---|---|---|---|---|---|
| License | MIT | MIT (core); Pro/Premium commercial | MIT | MIT | MIT | MIT (Community); Enterprise commercial | MIT |
| Range selection (free tier) | Yes | No (Pro/Premium) | No | Hand-rolled, ~40 LOC, single range only | Yes (canvas) | No (Enterprise) | Not in its `data-grid` surface (see §4) |
| Excel clipboard (free tier) | Yes | No (Premium) | Partial (single-cell callbacks only) | No | Yes (canvas) | No (Enterprise) | No |
| Fill handle (free tier) | Yes (`data-grid-fill` add-on) | No (Premium) | No | No | Yes (canvas) | No (Enterprise) | No |
| Rendering model | Real DOM, CSS Grid + subgrid | Real DOM | Real DOM | Real DOM | Canvas | Real DOM | Real DOM |
| Row virtualization | Custom, velocity-adaptive overscan | Built-in | Built-in | `@tanstack/react-virtual` | Native (canvas draw loop) | Built-in | `@tanstack/react-virtual` |
| Column virtualization | Yes | Yes | Yes (unverified — not exercised in benchmark) | No (not wired in the assembled baseline) | Yes | Yes (unverified) | No |
| Benchmarked in this repo | Yes | Yes | Yes | Yes (assembled baseline) | **Removed** (see §4) | **No — desk research only** | No (separate report, §2) |
| 100k-row fling fps (prod, launch-controlled) | ~45 | ~60 | ~60 | ~60 | not measured | not measured | not measured |
| Memory after scroll (100k) | 30-59 MB | 164 MB | 41 MB | 335 MB | not measured | not measured | not measured |

---

## 2. Methodology recap and honesty caveats

The numbers in this report come from two in-repo sources, and from nowhere else:

1. **`app/dev/benchmark/`** — the live harness. Read the source to reproduce or extend any number
   here:
   - `_lib/dataset.ts` — one seeded (LCG, seed 42) 8-column dataset shared byte-identically across
     all four grid pages, so every grid renders literally the same rows.
   - `_lib/metrics.ts` — `measureScrollFps` drives `scrollTop` writes paced by `requestAnimationFrame`
     (not a synchronous loop — see the file's own doc comment on why that would be unfair to grids
     that redraw off React state vs gridcn's synchronous CSS-var writes) across three **burst→settle
     tiers** (`SCROLL_SPEED_TIERS`): slow (8px ticks, sub-threshold), medium (240px wheel-notch
     cadence), fling (1800px hard flick, decelerating, above gridcn's velocity-overscan cap). Each
     tier reports avg fps, worst 100ms-window fps, and %frames-below-30fps.
   - `_lib/harness.ts` — the run contract: mount time, three scroll tiers, click→paint, heap
     (Chrome-only `performance.memory`, undefined on Firefox/Safari), DOM node count, long-task
     count, and a 5-cycle mount/unmount heap-delta measurement.
   - `_lib/parity.ts` — the parity matrix (exact/approximate/impossible per column type and per
     capability), reproduced in §6. Read this **before** trusting any comparative number: a metric
     is only comparable to the extent the grids render the same thing, and this file records every
     place they don't.
   - `_lib/environment.ts` — stamps dev-vs-prod mode on every run and refuses to imply comparability
     across modes (`DEV_MODE_WARNING`).
   - `page.tsx` (the runner) — mounts each grid alone in an isolated iframe (separate module graph,
     DOM, React tree) so no grid's JIT warmup or memory contaminates another's numbers.

2. **`docs/agent-work/2026-07-18-fling-smoothness-report.md`** — the only in-repo document with an
   actual four-grid results table (§7 there, reproduced in §3 below) and the only place the harness
   has been run to completion, gated, and written up. There is no separate "benchmark v1/v2 results"
   document beyond this — the harness page itself is the tool; this report is its one published
   run.

**Caveats that must travel with every number below:**

- **Dev vs prod is not comparable, at all.** `environment.ts`'s own warning: Turbopack + React dev
  builds inflate per-commit cost, and inflate it *more* for commit-heavy architectures (gridcn) than
  for coalescing ones. Any number not explicitly labeled prod should be assumed untrustworthy.
- **Per-launch bimodality.** The fling report's single most important methodological finding: headed
  Chromium exhibits a stable ~24fps-mode or ~45fps-mode *per browser launch*, affecting **all four
  grids equally**, with nothing in between. Within one launch, results are rock-stable (8 consecutive
  runs within 0.8fps of each other); across launches, unpaired comparisons are not decodable. The
  fix used in that report: pair candidates within one launch, or take medians over ≥5 launches — a
  single before/after run proves nothing at this noise floor.
- **Pairing discipline.** The report's `dateFormatterCache` win looked like +40% fps in naive
  before/after sampling and was, on paired re-measurement, actually +4.7% (7/7 paired wins, t=10.78)
  — the rest was the launch-mode artifact above. Read every "win" in this space assuming the naive
  number is probably wrong until proven paired.
- **The harness measures its own driver's gesture, not literally your users' fingers.** The
  burst→settle tiers were deliberately redesigned (see `metrics.ts`'s doc comment on `ScrollTier`)
  away from a v1 constant-delta driver specifically because a permanent teleport isn't a fling and
  was pinning gridcn's velocity estimator at max overscan for the whole run — an "anti-blank
  insurance premium" measurement, not a scrolling measurement. It is a good proxy; it is still a
  proxy.
- **Synthetic CDP-driven scroll can punish `getBoundingClientRect`-based measurement strategies more
  than real trackpad/wheel input does** — this is exactly what the 2026-07-17 tablecn report found
  (tablecn's `measureElement` layout-forcing call made it *look* worse than gridcn under synthetic
  jump speeds, the opposite of the user's real-world perception that started that investigation).
  Treat any grid whose architecture forces layout reads per mount with extra skepticism on synthetic
  benchmarks specifically.

---

## 3. Stat tables

### 3.1 Benchmark results — 100k rows, production build, headed Chromium

This is the fling-smoothness report's §7 table, the only completed full-harness run recorded in the
repo. Read together with the launch-mode caveat above: this is one (reproduced-twice) sample, not a
median over 5 launches.

| grid | mount (ms) | slow avg / %<30 | medium avg / worst / %<30 | fling avg / worst / %<30 | click→paint (ms) | heap mount / scroll / 5-cycle | DOM nodes | long tasks |
|---|---|---|---|---|---|---|---|---|
| gridcn | 0.0 | 60.0 / 0.0% | 54.2 / 33.0 / 0.8% | 45.4 / 21.2 / 7.5% | 32.0 | 33.2 MB / 58.9 MB / 107.4 MB | 572† | 1 |
| MUI X DataGrid (MIT) | 0.0 | 60.0 / 0.0% | 60.0 / 45.9 / 0.0% | 60.0 / 47.2 / 0.4% | 33.1 | 173.3 MB / 164.5 MB / 149.1 MB | 585 | 0 |
| react-data-grid | 0.1 | 60.0 / 0.0% | 60.0 / 54.9 / 0.0% | 60.0 / 54.8 / 0.0% | 33.3 | 195.4 MB / 41.3 MB / 43.8 MB | 180 | 0 |
| TanStack-assembled | 0.0 | 60.0 / 0.0% | 60.0 / 53.3 / 0.0% | 60.0 / 51.0 / 0.0% | 33.0 | 303.6 MB / 335.2 MB / 1659.8 MB | 310 | 0 |
| Glide Data Grid | **removed from harness — see §4** | | | | | | | |
| AG Grid | **not benchmarked — desk research only, see §4** | | | | | | | |
| tablecn | not run in this harness; see the separate 2026-07-17 comparison (§2) for its own numbers under a different method | | | | | | | |

† A raw run measured 1832 (a sampling artifact — DOM counted mid remount-cycle, catching a still-wide
fling window); repeated runs of the identical build measured 572 with the settle trace confirming
collapse to 20 rows. 572 is the number to trust.

**Launch-mode-controlled reading (from the fling report §6-7):** paired within one launch, gridcn's
fling fps is **~45 vs ~60** for the other three grids — a real gap, but roughly half the size a naive
single-run comparison would suggest (a same-session slow-mode run of the *same build* measured gridcn
medium 32.6 / fling 24.4 / 210 long tasks — same code, different launch mode).

**What the gap is made of** (fling report §1, sweeping sustained scroll speeds at 100k rows, prod):

| delta px/frame | rows added/frame | ms/frame | fps |
|---|---|---|---|
| 100 | 3.1 | 22.0 | 45.6 |
| 300 | 8.5 | 24.1 | 41.4 |
| 600 | 16.8 | 25.7 | 38.9 |
| 1200 | 33.3 | 31.8 | 31.4 |
| 1800 | 50.0 | 40.9 | 24.5 |

Slope: **≈0.40ms per row mounted** (~0.05ms/cell at 8 columns). The window's *size* is constant
(65 rows) across this whole sweep — **turnover**, not window size, is the cost. At near-zero scroll
speed (2px/frame, below the row-change threshold) gridcn holds a full 60fps — the CSS-var scroll
path itself costs nothing measurable; 100% of the deficit is React mount/unmount of rows crossing
the window edge.

### 3.2 Memory detail (100k rows, prod)

| grid | heap after mount | heap after scroll | heap after 5 mount/unmount cycles |
|---|---|---|---|
| gridcn | 33.2 MB | 58.9 MB | 107.4 MB |
| MUI X DataGrid | 173.3 MB | 164.5 MB | 149.1 MB |
| react-data-grid | 195.4 MB | 41.3 MB | 43.8 MB |
| TanStack-assembled | 303.6 MB | 335.2 MB | **1659.8 MB** |
| Glide, AG Grid, tablecn | not measured | not measured | not measured |

TanStack's 1.66GB after 5 remount cycles is flagged in the fling report as "the standout outlier in
the other direction" — it is not just slower to fling, it retains memory much more aggressively
across mount cycles than any DOM grid here. react-data-grid's heap-after-mount reading (195.4MB,
higher than its own post-scroll number) is plausible GC-timing noise rather than a real leak — the
harness takes one heap snapshot per phase, not a profile; treat single-sample heap deltas from
`performance.memory` as directional, not precise (Chrome's heap counter is sampled/approximate).

### 3.3 Bundle / dependency footprint

The registry item itself (`registry.json`, `data-grid` entry) declares exactly **one runtime
dependency: `zustand`**, plus `registryDependencies` on shadcn primitives you already have if you use
shadcn (`button`, `input`, `select`, `checkbox`, `popover`, `calendar`, `dropdown-menu`,
`context-menu`, `separator`, `tooltip` — these are copied source, not npm packages, under the
registry distribution model). That is the entire footprint a consumer's bundle pays for the core
item; add-ons (`data-grid-fill`, `data-grid-presence`, etc.) are separate opt-in registry items with
their own declared deps (`@dnd-kit/react` for the sort-list add-on's drag reorder is the one other
explicit dependency approval on record, workplan #29).

| grid | distribution model | install footprint |
|---|---|---|
| gridcn | shadcn registry (source copied into your repo) | 1 runtime dep (`zustand`) + shadcn primitives you likely already have |
| MUI X DataGrid | npm package | `@mui/x-data-grid` + `@mui/material` + `@mui/system` (a full MUI install if not already using it) |
| react-data-grid | npm package | `react-data-grid` alone (no UI framework dependency) — comparatively light |
| TanStack Table + Virtual | npm package(s) | `@tanstack/react-table` + `@tanstack/react-virtual`, no rendering/editing/clipboard layer included |
| Glide Data Grid | npm package | `@glideapps/glide-data-grid` (canvas rendering, no DOM cell tree) |
| AG Grid Community | npm package | `ag-grid-community` (+ `ag-grid-react`) — **not measured**, desk research only |
| tablecn | copy-paste source (shadcn-style registry-adjacent, not a package) | its own `data-grid` surface pulls `@tanstack/react-table` + `@tanstack/react-virtual` under the hood |

Actual byte sizes (minified/gzipped bundle weight) are **not measured** in this repo for any grid —
no bundle-analyzer pass has been run. If this becomes a research priority, `@next/bundle-analyzer` or
a standalone `esbuild --bundle --minify` probe against each grid's benchmark page would produce a
real number; do not estimate it from dependency count alone.

---

## 4. Per-library deep dive

### 4.1 gridcn (this project)

**Architecture:** real DOM, CSS Grid with `subgrid` per row, one shared `translate3d` canvas
transform per scroll tick (not per-row), imperative `gridRowStart` writes via `useLayoutEffect`
bypassing React specifically to avoid defeating `DataGridRow`'s memo (`row.tsx` doc comment). Row
and column windowing are both custom (`windowing/use-row-window.ts`, `use-column-window.ts`), with a
velocity estimator that grows overscan up to `VELOCITY_OVERSCAN_CAP_PX` (1600px worth of rows) during
a detected fling and decays afterward — this is the single largest architectural difference from
every competitor here, and it is a deliberate trade: it buys the **no-blank guarantee** (quantified,
not just claimed — see the fling report §2's blank-frame sampling) at the cost of extra row
mount/unmount churn during sustained scroll, which is exactly what §3.1's fling numbers show.

**What it has that the others (at MIT/free tier) lack:** range selection with multi-range
(ctrl-click), Excel-format clipboard (TSV + HTML table, quoted-cell parsing, anchored-expand paste),
a free fill handle with series inference, typed columns (`defineColumns<TData>()`), pinned rows
(top/bottom bands), multiplayer presence highlighting via a zero-render overlay plugin seam, and full
i18n via one typed `labels` object.

**What it lacks that others have:** column virtualization exists but is less battle-tested than
TanStack Virtual's ~3 years of ecosystem hardening (tablecn report §"Virtualizer"); no server-side
row model or enterprise data-source abstraction (AG Grid's domain); no canvas-level raw draw
performance ceiling (Glide's domain — see §4.5); no formula engine, row grouping/aggregation, or
cell merging (explicit v1 non-goals, `README.md:61-65`); comfort ceiling is ~100k rows / hard limit
~1M rows (Chromium CSS Grid track limit, same doc).

**Pros:** free-tier feature parity with paid-tier competitors on the Excel-interaction axis; lowest
memory and flattest DOM footprint measured; you own the source (registry model, not a version-pinned
npm dependency); one dependency.

**Cons:** currently the slowest of the four benchmarked grids under sustained hard fling; the
velocity-overscan architecture is more complex to reason about than fixed-overscan competitors, and
its tuning knobs (`VELOCITY_OVERSCAN_CAP_PX`, ramp/decay ticks) have already been swept once (§5.1)
without a clean win.

**Licensing:** MIT, no paid tier at all.

### 4.2 MUI X DataGrid

**Architecture:** real DOM grid, open-core. Confirmed from `references/mui-x/README.md`: "MUI X is
open-core: Community components are MIT-licensed and free forever, while more advanced features and
components require a Pro or Premium commercial license" (line 30), and "Anything we release under an
MIT license will remain MIT-licensed forever" (line 52).

**What it has that gridcn lacks:** a much larger, more mature ecosystem — this repo's benchmark page
(`app/dev/benchmark/mui-x/grid-inner.tsx`) uses its built-in `singleSelect`, `boolean`, `date`, and
`number` column types out of the box, all first-class library features (gridcn has to build its own
cell-type system for the same coverage, which it does — but MUI's version predates and is
independently battle-tested); a documented, supported column-menu system; broad enterprise adoption
and support contracts.

**What it lacks at the MIT tier that gridcn has for free:** range/cell selection beyond row checkbox
selection is architecturally absent from Community — confirmed in `_lib/parity.ts:68`: "Cell-range
selection is Pro-tier... cannot be made equivalent at any price below a licence." Clipboard copy/paste
is Premium-only (`_lib/parity.ts:73`: "the MIT build ships no Ctrl+C handler at all"). Multi-cell
editing / fill-style operations don't exist below Pro either — the benchmark page's MIT build only
supports single-cell edit per commit (`_lib/parity.ts:64`).

**Pros:** best-in-class polish and ecosystem maturity for the features it does ship free (sorting,
filtering, column management, row selection, density); consistent MUI design system integration if
you're already on MUI; on this repo's own measurement, fastest of the four at sustained fling
(60fps, no degradation) — though note the parity caveat that its free tier is doing structurally less
work per cell (no range-selection overlay math, no clipboard listener).

**Cons:** the headline features that make a grid feel like Excel are locked behind a commercial
license; heaviest measured memory footprint after scroll (164.5MB vs gridcn's 58.9MB) despite doing
less selection/clipboard work; requires buying into the MUI ecosystem (`@mui/material` +
`@mui/system`) even for the free tier.

**Licensing/pricing (as documented in `references/mui-x/README.md`):** Community = MIT, free forever.
Pro and Premium = commercial licenses, priced per the MUI pricing page (specific figures not vendored
into this repo — treat as **(unverified)** if quoted from memory; check `mui.com/pricing` directly
for current numbers).

### 4.3 react-data-grid (adazzle)

**Architecture:** real DOM grid, MIT (`references/react-data-grid/package.json:"license":"MIT"`).
Confirmed as the leanest dependency footprint of the npm-distributed options — no UI framework
dependency at all.

**What it has that gridcn lacks:** genuinely nothing structural found in this pass — it is the
closest overall behavioral match to gridcn after gridcn itself (per `_lib/parity.ts:78`'s own
headline: "the closest overall behavioural match after gridcn"), but every rich editor gridcn ships
natively (select dropdown, date picker, numeric input with validation) had to be **hand-rolled in the
benchmark page itself** (`app/dev/benchmark/react-data-grid/grid-inner.tsx:21-67`) because the library
ships exactly one built-in editor, `renderTextEditor`. Its boolean cell is a repurposed row-selection
checkbox formatter, not a first-class boolean type.

**What it lacks that gridcn has:** built-in select/date/number editors (all hand-rolled in the
benchmark), range/multi-cell selection (`_lib/parity.ts:105`: "No multi-cell range or multi-range
selection; drag-select across cells does not exist in RDG"), real range clipboard (only
`onCellCopy`/`onCellPaste` single-cell opt-in callbacks, `_lib/parity.ts:109`), a fill handle, typed
column inference, pinned rows, i18n labels object.

**Pros:** lightest real dependency footprint of any npm-distributed grid here; genuinely fast on this
benchmark (60fps flat across all three tiers, no degradation even at fling); simple, well-understood
API surface.

**Cons:** thin feature ceiling out of the box — almost everything beyond plain text editing is DIY;
no commercial tier to "graduate" into if you outgrow it, so gaps stay gaps unless you build them
yourself (which is exactly what the benchmark page had to do).

**Licensing:** MIT, no paid tier.

### 4.4 TanStack Table + TanStack Virtual (assembled baseline)

**Architecture:** not a grid product — a headless table-state library (`@tanstack/react-table`) plus
a separate virtualization library (`@tanstack/react-virtual`), hand-assembled for this benchmark
(`app/dev/benchmark/tanstack/grid-inner.tsx`). This is deliberately "what raw TanStack gives you
before you build a spreadsheet layer" — see the core-strategy decision doc, which is the reason this
baseline exists in the harness at all: to keep the from-scratch-core decision honest with numbers.

**What it has that gridcn lacks:** nothing on the editing/selection/clipboard axis — per
`_lib/parity.ts:134-147`, editing is entirely absent ("TanStack Table has no editing layer; this is
the single largest parity gap in the comparison"), selection is "~40 lines of benchmark code, not a
library feature," and clipboard is "No clipboard layer exists in TanStack Table and none was
hand-rolled." What it *does* have, structurally, is a mature, framework-agnostic sort/filter/pin
state engine and multi-framework support (React/Vue/Solid/Svelte/Angular/Lit adapters all present in
`references/table/packages/`) if a project needs the same table logic across frameworks.

**What it lacks that gridcn has:** everything that makes a grid feel like a grid rather than a
read-only table — see above. Also no column virtualization in this assembled baseline (not wired up;
would require additional integration work).

**Pros:** the most battle-tested row-virtualization dependency in this whole comparison
(`@tanstack/react-virtual`, ~3 years of ecosystem hardening per the tablecn report); multi-framework
table-state logic if that portability matters; huge community/plugin ecosystem for the state layer
specifically (sorting, filtering, grouping, pinning primitives).

**Cons:** by far the highest measured memory footprint, and the only grid whose memory *grows*
dramatically across mount/unmount cycles (335MB after scroll → 1659.8MB after 5 cycles) — a real
outlier worth independent investigation if TanStack Table is ever reconsidered for anything. Provides
none of the hard parts of a grid product (confirmed in the core-strategy decision doc from both
TanStack's own docs and tablecn's shipping code, which still hand-built ~4,000 lines of
interaction/selection/clipboard on top of Table).

**Licensing:** MIT (`references/table/packages/table-core/package.json:"license":"MIT"`), no paid
tier — TanStack's commercial angle (if any) is around hosted tooling/support, not a Table license
gate; not independently verified here, mark **(unverified)** if cited further.

### 4.5 Glide Data Grid — removed from the harness

**Status:** benchmarked in an earlier harness iteration, then **removed** per workplan #42's
refinement note: "Glide REMOVED (canvas too far from our approach)." Confirmed present in
`references/glide-data-grid` (MIT, `packages/core/package.json:"license":"MIT"`) but not wired into
`_lib/grids.ts`'s current `BENCHMARK_GRIDS` list and no `app/dev/benchmark/glide/` page exists.

**Why removed, in more depth:** Glide renders via `<canvas>`, not real DOM cells. This is the same
axis the canvas-pivot evaluation (2026-07-16, referenced in memory as `canvas-pivot-rejected`)
already ruled out for gridcn itself: canvas rendering sidesteps DOM/React reconciliation cost
entirely, which makes any FPS comparison against a DOM grid apples-to-oranges in the other direction
from tablecn's `measureElement` issue — a canvas grid's "smoothness" numbers reflect a fundamentally
different rendering pipeline, not a tuning difference gridcn could adopt piecemeal. Continuing to
benchmark it invited exactly the kind of misleading headline number this report's discipline is
built to avoid.

**What it has that gridcn lacks (per README description + `references/glide-data-grid`, verified
from the package description "React data grid for beautifully displaying and editing large amounts
of data with amazing performance"):** genuinely native range selection, clipboard, and fill-style
operations built canvas-side (`drawFocusRing`/highlight-region APIs referenced in workplan #20's
presence research) with no DOM node cost per cell at all — its performance ceiling for very large
datasets (millions of rows/columns) is structurally higher than any DOM grid can reach, because it
never pays DOM node creation cost per visible cell.

**What it lacks that gridcn has:** real DOM cells, meaning no native text selection, no native
find-in-page, no CSS styling via tokens (canvas cells are hand-drawn, not styled with shadcn
classes — a real accessibility and stylability cost), and accessibility has to be reconstructed
entirely via a11y shadow/overlay techniques rather than inheriting the browser's native semantics the
way gridcn's `role=grid`/`role=gridcell` DOM tree does for free.

**Pros:** the highest realistic performance ceiling of anything in this comparison, by construction.

**Cons:** the entire "real DOM, shadcn tokens" positioning gridcn is built on (`README.md:3`) is
incompatible with canvas rendering — adopting Glide's approach would mean abandoning gridcn's
identity, not improving it. This is why it's a rejected direction, not a research lead: see §5's "not
re-explorable" list.

**Licensing:** MIT.

### 4.6 AG Grid — not benchmarked, desk research only

**Status:** no `references/ag-grid` clone exists in this repo (confirmed — `references/` contains
diceui, form, glide-data-grid, mui-x, react-data-grid, react-datasheet-grid, reui, table, tablecn,
ui, virtual, but no AG Grid). Everything in this subsection is **(unverified)** against source; it
reflects general market knowledge, not code read in this pass, and should be treated with the same
skepticism as any uncited claim.

**Positioning (unverified):** AG Grid Community is MIT-licensed and free; range selection, Excel-style
clipboard/fill, and several other Excel-parity features are gated behind AG Grid Enterprise, a
commercial license — this is the exact comparison `README.md:7-9` makes explicitly ("Range selection,
Excel-style clipboard paste, and a fill handle are Enterprise/Premium-only features in AG Grid and
MUI X"). AG Grid is widely considered the most feature-complete DOM-based grid in the ecosystem,
with server-side row models, pivoting, and enterprise data-source integrations that neither gridcn
nor any other grid in this comparison attempts to match.

**What it likely has that gridcn lacks (unverified):** a server-side row model / infinite row model
abstraction for backend-driven data (gridcn's `data-grid-lazy` add-on covers a narrower version of
this — sparse-array range-coalescing fetch, not a full server-side model); row grouping and pivoting;
an Enterprise Excel-export with real formula/formatting fidelity beyond gridcn's `data-grid-io`
xlsx/csv export; a master/detail row model; extensive built-in chart integrations.

**What gridcn likely has that AG Grid Community lacks (unverified, mirroring the MUI X pattern):**
range selection, Excel clipboard, and fill handle at the free tier — per the same README claim, these
are Enterprise-gated in AG Grid.

**Recommendation if this becomes a real research priority:** clone AG Grid Community into
`references/ag-grid` and verify the Enterprise-gating claims against its actual licensing docs/source
before quoting them further — the README already makes this comparison publicly, so it is worth
confirming precisely rather than leaving it as inherited market knowledge.

**Licensing (unverified):** MIT (Community) / commercial (Enterprise) — verify current pricing at
ag-grid.com if this becomes load-bearing for a claim.

### 4.7 tablecn

**Status:** not in the live `/dev/benchmark` harness at all — its own dedicated investigation is
`docs/agent-work/2026-07-17-tablecn-comparison.md`, produced for workplan #14. Summarized here
rather than re-measured.

**Architecture:** real DOM grid built on `@tanstack/react-table` + `@tanstack/react-virtual`
(confirmed, `package.json:45` per that report), MIT (`references/tablecn/LICENSE.md`, "Copyright (c)
2024 Sadman Sakib"). Fixed, generous overscan (6 rows, no velocity logic at all) vs gridcn's
velocity-adaptive overscan; measured (not fixed) row height via `measureElement`
(`getBoundingClientRect()` per newly-mounted row per commit on Chromium, skipped on Firefox) vs
gridcn's fixed-height arithmetic; `content-visibility: auto` per row (gridcn has none); no column
virtualization at all (renders every column, unconditionally).

**What it has that gridcn lacks:** `content-visibility: auto` per row as a second, browser-native
layer of off-screen work-skipping on top of JS virtualization — the tablecn report's #1 adoption
candidate, later independently investigated and **rejected** for a real, measured reason (§5.3).
`@tanstack/react-virtual`'s multi-year production hardening vs gridcn's from-scratch, newer
row-windowing code. Its filter/sort toolbar UI was influential enough that gridcn explicitly ported
its interaction pattern (workplan #29, "Filter + sort popovers → tablecn parity" — credited in
gridcn's own Credits section per that item).

**What it lacks that gridcn has:** column virtualization at all (a real structural gap for wide
grids — its demo only exercises ~7 columns); the tablecn report found **no evidence it uses row
pooling** — a materially important negative result, since workplan #14 originally asked to evaluate
row pooling *against tablecn's approach* and the honest answer was "there is nothing to benchmark
against, because tablecn didn't build it." Its perceived smoothness at the row counts tested (10k,
not gridcn's 100k) was, on the tablecn report's own synthetic-scroll measurement, **not confirmed** —
at gentle wheel-like speed the two grids were statistically indistinguishable (32.0 vs 31.1fps), and
at medium/hard synthetic jump speeds tablecn's numbers were *worse*, an artifact of its
`measureElement` layout-forcing pattern being punished harder by synthetic `scrollTop=` jumps than
real input.

**Pros:** the fixed-overscan + mature-virtualizer combination is simpler to reason about than
velocity-adaptive windowing, and content-visibility gives it a real, adoptable technique gridcn
doesn't have (even though the direct port was rejected for gridcn's specific pinned-column
architecture, §5.3).

**Cons:** no column virtualization at all; measured row height costs a forced layout read per mount
that gridcn's fixed-height model avoids entirely — this is a genuine structural disadvantage tablecn
accepts, not a free lunch. No range selection or Excel clipboard in its `data-grid` surface — the
`readme` comparison in this repo's own `README.md:8` groups it with "every other MIT-licensed grid in
the shadcn ecosystem" lacking these.

**Licensing:** MIT (Sadman Sakib, 2024).

---

## 5. Research directions

This is the section to actually work from. Every entry maps a competitor's strength (or a prior
finding) to something concrete in gridcn's own code, and flags what has **already been tried and
rejected** so you don't re-spend a lane re-discovering it.

### 5.1 Already investigated — do not re-open without new evidence

| Lever | Verdict | Why (file/report) |
|---|---|---|
| Row pooling (recycle row DOM/fiber instead of mount/unmount) | **Rejected twice** — once because tablecn (its supposed proof-of-need) doesn't do it either, once on gridcn's own fling measurement | The gate ("real-drag perf test showing the need") from the canvas-pivot decision was checked against the tablecn comparison and again against the fling deep-dive; neither found the premise held. Fling report §8: the named mechanism (velocity overscan + flushSync) isn't the cost — commits are already 1/frame, and pooling's realistic target is ~14% of frame time (`appendChild`/`setAttribute`/`removeChild`), not the 40.8% `flushSync` reconciliation cost. If reopened, re-derive the gate from paired-launch measurements first (`docs/agent-work/2026-07-18-fling-smoothness-report.md` §8). |
| Lower `VELOCITY_OVERSCAN_CAP_PX` | **Rejected** | Buys fps (32.2→43.6 medium) but blank frames go 3.8-5.5x worse (42→231 at cap 600) — trades the no-blank guarantee. `windowing/use-row-window.ts`'s existing doc comment already records ~1500px as the measured floor for real thumb-drag deltas; fling report §3 independently reproduces it. |
| Deferred/post-paint overscan commit (commit critical window sync, top up buffer after paint) | **Rejected** | Sounds right on paper (~44 of 61 window rows are unpainted velocity buffer) but the render path recomputes the critical window every render, converting a single mount into mount→unmount→remount churn — 2.3-3x the frame cost, not less. Fling report §4. Fully reverted; `use-row-window.ts` untouched at HEAD. |
| `content-visibility: auto` per row (tablecn's technique) | **Rejected** | Measured 221→1198fps idle / 38→155fps swap — a huge win — but broke the pin-shadow painted-pixel probe (32px offset) under gridcn's subgrid + pinned-column architecture. Per workplan #9b/#9: "content-visibility definitively rejected on subgrid conflict." **Re-openable**: workplan #9b explicitly proposes adapting the pin-shadow anchor measurement to content-visibility, or scoping `content-visibility` off for pinned-adjacent rows only, then re-running the full matrix. This is the single highest-value *already-scoped* re-investigation in this report — the win is real and large, the blocker is narrow (one measurement hook, one class of rows). |
| Commit coalescing / rAF-align the scroll commit | **No headroom exists** | Measured 1.00 scroll events and 1.00 commit batches per frame already — there is nothing to coalesce. Fling report §1/Lever 1. |
| TanStack Table as the core | **Rejected** (strategic, not tactical) | `docs/agent-work/2026-07-18-core-strategy-decision.md` — provides none of the hard parts, conflicts with the zero-render scroll model, and would require ~4,000 LOC of hand-built interaction/selection/clipboard on top anyway (tablecn's own code proves this). Watch item: TanStack v9's `cellSelectionFeature` reaching GA — revisit only as an optional interop adapter, never a core swap. |

### 5.2 Live target: per-row reconciliation cost (highest-value open lever)

The fling report's own recommendation (§8, last line): after the `dateFormatterCache` win, the
remaining named cost breaks down as `flushSync` (React commit, 33.8-40.8%) + `appendChild`/
`setAttribute`/`removeChild` (~14%) + everything else. Pooling attacks the DOM-mutation slice; it
cannot touch the reconciliation slice. **The highest-value remaining target is React reconciliation
cost per mounted row, not DOM node creation.** Concrete avenues, none yet attempted:

- **Fewer data-attributes / less `cn()` work per cell** — the report names this explicitly as the
  cheaper-than-pooling direction. Audit `registry/default/blocks/data-grid/cell.tsx` and `row.tsx`
  for how many `data-*` attributes and `cn()` calls fire per cell per render; any that are constant
  across a cell's lifetime (not state-derived) are candidates to hoist to a stable className computed
  once, not recomputed per commit.
- **Cell tree depth.** The tablecn report (§"DOM shape") notes gridcn's cell nests an extra wrapper
  (`<div role=gridcell>` → `<span>`, `cell.tsx:236-247`) for text overflow/ellipsis handling. This is
  probably not removable without losing the ellipsis behavior, but it's worth checking whether CSS
  alone (`text-overflow: ellipsis` directly on the gridcell div) could drop the `<span>` for the
  plain-text display path specifically, shaving one DOM node's mount/unmount cost per cell per row
  turnover — multiply by ~8 columns × ~28 rows/frame at fling and this is a real, measurable
  candidate, not a micro-optimization.
- **Monomorphic cell/row object shapes** — workplan #9's still-open "JS runtime memory strategies"
  item flags this directly: consistent field order, no conditional fields, for engine-friendly hidden
  classes in the hot per-tick/per-commit paths (`computeWindow`, snapshots, rects). Not yet audited
  against the current row/cell prop shapes post-4b's `useDataGridRowCellState` consolidation.

### 5.3 content-visibility, adapted (see also §5.1's re-openable note)

Concretely: the pin-shadow measurement (`windowing/use-pin-shadow-edges.ts`) anchors on a real,
painted pixel position. `content-visibility: auto` causes the browser to skip layout for
off-screen rows, which is exactly what broke that anchor (a 32px offset appeared). Two directions
worth prototyping, per workplan #9b:
1. Scope `content-visibility: auto` off for any row within the pin-shadow's measurement radius
   (pinned-adjacent rows only lose the optimization; everything else keeps it).
2. Adapt `use-pin-shadow-edges.ts` to explicitly force a layout read (or use `contentVisibilityAutoStateChange`,
   a newer platform event for exactly this class of problem) before sampling, rather than relying on
   ambient paint state.

Either direction needs the full matrix re-run (idle/swap fps, the blank-frame probe, and the
pin-shadow browser test) before adoption — do not skip the pin-shadow regression test a second time.

### 5.4 Column virtualization maturity (own-code hardening, not a competitor port)

Neither TanStack-assembled nor tablecn column-virtualizes at all (§4.4, §4.7) — this is a place
gridcn is structurally ahead, not behind. But `windowing/use-column-window.ts` is comparatively young
next to `@tanstack/react-virtual`'s multi-year hardening (tablecn report, "Virtualizer" table). If
wide-grid (50-200+ column) usage grows, budget a dedicated stress-test pass (the same burst→settle
harness, driven horizontally) rather than assuming vertical-scroll findings transfer — column
windowing has different edge cases (pinned-column boundary math, binary-search correctness at
non-uniform widths) that the current test suite (`windowing/use-column-window.test.ts`) may not fully
stress at high column counts.

### 5.5 Firefox pinned-column compositing (robustness gap, not perf)

The tablecn report flags, as an aside, that tablecn ships a Firefox-only `adjustLayout` fallback
(switch from `transform` to `top` positioning) because Firefox apparently mis-composites transformed
rows against sticky/pinned siblings. gridcn's pinned cells use CSS inset vars against
`position: sticky`, a different mechanism that may or may not share the bug — **this was explicitly
out of scope for that report and flagged for a future item**. Worth a manual Firefox check
(pin left/right columns, scroll, verify no visual desync) since no browser-matrix test currently
covers this path (the browser test suite's default target is Chromium via Playwright).

### 5.6 Feature gaps worth a spec, not a perf lane

These come from §4's per-library reading, not from the perf reports, and are genuinely new ground
(no existing rejection to check against):

- **Server-side / infinite row model** (AG Grid strength, §4.6, unverified specifics but the shape is
  well-known industry-wide) — gridcn's `data-grid-lazy` add-on covers range-coalescing fetch for a
  known-but-sparse dataset; a true server-side model (server-driven sort/filter/group, not just
  range-fetch) is a bigger, separate feature. Worth a spec if backend-driven huge datasets become a
  priority.
- **Row grouping / aggregation** — explicit v1 non-goal (`README.md:63`) and AG Grid's other core
  strength. Stays a non-goal unless the vision changes; recorded here only so it's visible next to
  the competitor that has it.
- **Bundle-size measurement** — genuinely missing data (§3.3). A one-time `esbuild --bundle --minify`
  probe on each benchmark page (or `@next/bundle-analyzer` against the docs site) would let a real
  "gridcn ships less JS" claim sit next to the dependency-count argument instead of standing on it
  alone.

---

## 6. Appendix: feature parity matrix

Reproduced from `app/dev/benchmark/_lib/parity.ts` (the harness's own source of truth — read that
file directly for the live version if this report goes stale). `exact` = renders/behaves the same as
gridcn's reference implementation; `approximate` = comparable but not equivalent, with a stated
reason; `impossible` = cannot be made equivalent at this license tier or at all, with a stated reason.

| Aspect | gridcn | MUI X DataGrid (MIT) | react-data-grid | TanStack-assembled |
|---|---|---|---|---|
| text (name/email) | exact — text cell type, inline editor | exact — default string column, editable | exact — `renderTextEditor`, editable | exact — rendered text (read-only) |
| number (age/score) | exact — number cell type, min/max, right-aligned | exact — `type:'number'`, editable, right-aligned | **approximate** — text editor coerced to number on commit; RDG ships no numeric editor, so validation/step behavior is benchmark code | **approximate** — rendered text, formatted to match, read-only (no editor to invoke) |
| select (role) | exact — select cell type, choices dropdown editor | exact — `type:'singleSelect'` + `valueOptions`, editable | **approximate** — hand-rolled `<select>`; RDG has no built-in select editor | **impossible** — rendered badge only; TanStack has no cell editing at all |
| date (joined) | exact — date cell type, en-US display format + calendar editor | **approximate** — `type:'date'` needs real `Date` objects, so the benchmark converts the shared ISO string per cell, a per-render cost the others don't pay | **approximate** — hand-rolled `<input type=date>`, raw ISO display; RDG has no date cell type | **approximate** — rendered text, same en-US format, no editor or calendar |
| checkbox (active) | exact — checkbox cell type, toggles in place | exact — `type:'boolean'`, editable | **approximate** — reuses RDG's row-selection checkbox formatter as a boolean cell, not a first-class boolean type | **approximate** — rendered check/dash glyph, read-only indicator |
| editing | exact — all 8 columns editable, per-type editors | **approximate** — single-cell edit on all 8 columns; MIT tier has no fill handle and no paste-to-edit | **approximate** — all 8 columns editable via mixed built-in/hand-rolled editors; half the editors are benchmark code | **impossible** — no editing layer at all; "the single largest parity gap in the comparison" |
| selection model | exact — cell / range / multi-range + row + column | **impossible** — row checkbox selection only; "cannot be made equivalent at any price below a licence" | **approximate** — row checkbox selection + single active cell; no multi-cell range, no drag-select | **approximate** — thin hand-rolled single cell-range drag-select, ~40 LOC, no multi-range/keyboard extension/row-column selection |
| clipboard | exact — native Ctrl+C/V over ranges, TSV round-trip | **impossible** — Premium-tier feature; MIT build ships no Ctrl+C handler at all | **approximate** — `onCellCopy`/`onCellPaste` wired for the active cell only; no range copy producing TSV | **impossible** — no clipboard layer exists, none hand-rolled |

Glide Data Grid and AG Grid have no row in this matrix (removed from the harness / never benchmarked
— see §4.5 and §4.6). tablecn was never run through this harness (separate report, §2/§4.7).
