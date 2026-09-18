# Multiplayer presence highlights — Design

**Date:** 2026-07-17 · **Status:** approved (design delegated), build queued behind perf-audit lane
**Research basis:** tablecn multiplayer page (PartyKit, per-cell context ring — rendering path
rejected as anti-pattern), glide-data-grid `highlightRegions` (canvas `{color, range, style}` —
API shape adopted), our overlay engine (primitives reused verbatim). Full research in the
2026-07-17 session log; key files cited inline below.

## Decision summary

Core feature (no new registry item): a `presenceHighlights` store slice painted ONLY by
`DataGridOverlays`. Zero cell/row re-renders by construction — same contract as selection
overlays, extended to a new probe test. Transport stays consumer-land (websocket/CRDT handler
calls the action); the docs demo simulates 3 users with timers.

## API

```ts
export type PresenceHighlight = {
  /** Stable per-user (or per-cursor) id — used as React key and for chip dedupe. */
  id: string;
  /** Any CSS color; painted at fixed alpha for fill, full opacity for the border. */
  color: string;
  /** View-space rect (same coordinate system as GridSelection.current.range). */
  range: GridRect;
  /** Optional name chip anchored at the range's top-left corner when on-window. */
  label?: string;
};
```

- Input paths (both, mirroring the controlled-props idiom):
  1. `actions.setPresenceHighlights(highlights: PresenceHighlight[])` — the real mechanism
     (imperative, like fillPreview). Consumer's transport handler calls it directly.
  2. `presenceHighlights?: PresenceHighlight[]` prop on DataGridRoot/DataGrid — effect-syncs
     into the store for simple consumers. Safe: the root context value is memoized on real deps
     (post click-fix), so a prop tick re-renders Root but hands out the identical context ref
     and `props.children` elements — rows/cells never render.
- New atomic selector `useDataGridHighlights()`, consumed ONLY by `DataGridOverlays`.

## Rendering (overlays.tsx)

- Reuse `clampRectToWindow` → `splitRectByPinZones` → segment placement by CSS grid lines,
  exactly like `RangeOverlay`, with per-highlight color via CSS custom property
  (`--presence-color`): border = full-opacity color, fill = `color-mix(in oklch, var(--presence-color) 12%, transparent)`.
- Layering: below the local active-cell ring (local focus always wins); pinned segments z2.
- Label chip: small rounded chip (`label`, bg = full color, readable fg via `color-mix` contrast
  or fixed white text — keep simple v1), anchored at the range's top-left VISIBLE corner, only
  rendered when that corner survives the window clamp (same guard as the fill handle's corner
  check). No viewport-edge floating in v1.
- Everything `aria-hidden` + `pointer-events-none`. Presence NEVER touches aria-selected,
  `useDataGridRowCellState`, or the rows path (the research-flagged tension — resolved by
  keeping presence out of the row-level subscription entirely).

## Coordinates & sorting honesty

Ranges are VIEW-space (like selection). Sorting/filtering shifts view indices; remote peers
exchanging rowIds must map rowId → view index before calling the action (we already expose the
pieces: `useDataGridRowIds` / view-index selectors). Documented with an example. A rowId-native
adapter is a possible follow-up add-on, not v1.

## Scope cuts (v1, documented)

- Data rows only — no presence on pinned row bands (they already sit outside selection).
- One rect per array entry; a user with a multi-range selection sends several entries sharing id.
- No cursors, no per-cell avatars — the docs demo shows toolbar-style avatar chips + the
  in-grid highlights (tablecn's model: toolbar avatars are the always-visible surface,
  in-grid paint only when on-window).

## Demo (docs)

`data-grid-presence-demo`: 3 simulated users (fixed names/colors), timers move their
cell/range selections around a mid-size grid; avatar chips above the grid; one user
periodically selects a range overlapping another to show blend legibility. New docs section
(placement: probably its own short page under Features, "Multiplayer presence") explaining the
API, the zero-re-render guarantee, the view-space contract, and a sketch of wiring a real
websocket.

## Gates

- New probe test: `setPresenceHighlights` renders ONLY `DataGridOverlays` — zero rows/cells
  (extend the existing selection re-render probe pattern in test/data-grid.test.tsx).
- Browser tests: highlight paints at the right cells (pinned + unpinned split), clamps at the
  window edge, label chip appears/disappears with window membership, overlapping highlights
  both visible.
- Full suites + registry verify + payload rebuild.
