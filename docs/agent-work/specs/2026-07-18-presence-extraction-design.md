# Presence extraction + overlay-plugin seam (workplan #48, cut #1)

Research basis: 2026-07-18 lean-core coupling evaluation. Presence is the clean cut: zero keymap
surface, zero interaction wiring, no other feature reads it, no vision tension (it postdates the
core and was overlay-only by design). Core today: 93 files / 11,246 LOC; this removes ~200 LOC
from core and proves the seam design that any future extraction (e.g. fill, if approved) reuses.

## The seam: one overlay-plugin slot

`overlays.tsx` gains a single registration point instead of hardcoding presence JSX:

- `DataGridOverlays` renders `overlayPlugins` from the root context after its built-in layers.
  A plugin is `(ctx: OverlayPluginCtx) => ReactNode` where ctx exposes what presence already
  uses: the window clamp + pin-zone segmentation helpers (`splitRectByPinZones`,
  `clampRectToWindow` — exported, stable), layout vars, and the store hook surface.
- Registration: `DataGridProvider`/root accepts `overlayPlugins?: readonly OverlayPlugin[]`
  (identity-stable; dev guardrail warns on churn like other callback props).
- This is the ONLY new core surface. No interaction-hook seam, no GridAction changes — those
  belong to the fill decision, not this cut.

## The add-on: `data-grid-presence`

- New registry item (depends on `@gridcn/data-grid`): the `PresenceHighlightOverlay` +
  `PresenceLabelChip` components (moved from overlays.tsx), the `PresenceHighlight` type
  (moved from core types.ts, re-exported by the add-on), a `useDataGridPresence()` wiring hook
  or a `<DataGridPresence highlights={...}>` component that registers the plugin + owns the
  highlights state (add-on-local store slice or plain props — pick the simplest that keeps the
  zero-cell-render contract; the probe test moves with it).
- Core REMOVES: `presenceHighlights` state, `setPresenceHighlights` action, the sync prop,
  `useDataGridHighlights`, `EMPTY_PRESENCE_HIGHLIGHTS`, the overlays presence JSX, the type.
- Breaking (pre-1.0, in-repo only): presence demo's registryDependencies + imports, three docs
  pages (multiplayer-presence.mdx becomes the add-on's page with its install command,
  api-reference.mdx, events-state.mdx presence section), CHANGELOG entry under Changed.

## Contracts

Zero-cell-render presence probe stays green (moves to the add-on's tests); overlays alignment
tests (pinned zones, windows) unchanged for selection/fill; core suites untouched otherwise.
Payload rebuild; registry.json gains the item; core item's files list shrinks.

## Sequencing

After #44 (fling lane owns root/windowing) and #45 (defaultData owns store.tsx) land — this
spec's lane is third in the core queue. Fill/clipboard extraction is NOT in this spec: it waits
on the user's explicit go/no-go about rewriting the README's "all three in the core item, free"
headline (see the coupling report §3) plus the costlier interaction/GridAction seams.
