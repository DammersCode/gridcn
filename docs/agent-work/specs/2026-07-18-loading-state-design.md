# Grid-wide loading state (workplan #40, from the ReUI parity check)

## Problem

ReUI's grid ships loading skeleton/spinner modes; gridcn only has per-window skeleton rows
inside the `data-grid-lazy` add-on. A consumer doing an ordinary "fetch then render" (no lazy
add-on) has no built-in way to show the grid as loading — they get the empty state ("No rows"),
which reads as "your query matched nothing" while the request is still in flight.

## Design

New optional `loading?: boolean` on the grid root (same surface as `emptyState`/`density`).

- `loading && rowCount === 0`: the body renders a page of skeleton rows (enough to fill the
  viewport at the current density) instead of the empty state — reuse the lazy add-on's skeleton
  row visual language (muted rounded bars per cell) but implemented in core (core cannot import
  from an add-on); keep it one small internal component.
- `loading && rowCount > 0` (background refresh): keep the data visible; show a slim
  indeterminate progress bar pinned under the header (token colors, respects
  prefers-reduced-motion by falling back to a static bar).
- The empty state never shows while `loading` is true.
- a11y: `aria-busy="true"` on the grid root while loading; new `labels.grid.loading` string used
  as the skeleton region's aria-label (translatable, defaults to "Loading…").
- Default `false`; zero behavior change for existing consumers.

## Out of scope

Spinner-vs-skeleton variants (one skeleton look, one bar), per-column skeleton shapes, and any
data-fetch orchestration — the flag is purely presentational; `data-grid-lazy` keeps its own
per-window skeletons unchanged.

## Also in this lane (docs-only, from the same research)

Pin-indicator recipe: a short snippet in the columns/styling docs showing both existing paths —
CSS-only via the documented `data-pinned="left"|"right"` header attribute, and a React icon via
the `header: ReactNode` column field. No API change (research confirmed the surface exists and
is documented; only discoverability is missing).

## Deferred (advisor decision, user may override)

Row expansion / per-row detail panels: the one real ReUI feature we lack, but variable-height
expanded content conflicts with the fixed-row-height windowing model (scroll math assumes
uniform rows), making it larger than it looks, and it sits outside the Excel-like vision
(Excel has outline/grouping, not detail panels). Not built; revisit only on explicit demand.

## Tests

Skeleton body renders when loading+empty (and empty-state label does NOT); progress bar +
intact rows when loading+data; aria-busy set; labels override works; loading=false unchanged.
