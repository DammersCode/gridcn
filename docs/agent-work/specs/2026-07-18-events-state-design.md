# Events & state: showcase page + API control gaps (workplan #41)

Research basis: full API inventory + control matrix (2026-07-18 evaluation lane). Verdict: the
API is consistently observable (every writable slice has a read hook), sort/filter/join/search/
pagination follow the controlled-pair convention, presence models the gold standard (action +
controlled prop) — but two real gaps block common consumer needs.

## Gap fix 1 — column layout is write-only (the big one)

Width/order/pin/hidden are mutable only via imperative actions with NO change notification and
NO restore path — "persist my users' column layout" (a top data-grid ask) is impossible without
the undocumented `storeApi.subscribe()` escape hatch.

Design (uncontrolled-with-events, deliberately NOT a fully-controlled overlay):

- `type ColumnLayout = { widths: Record<string, number>; order: string[]; pins: Record<string, "left" | "right">; hidden: string[] }`
  — plain JSON-serializable snapshot (only user-touched widths in `widths`; `order` is the full
  current id order).
- `onColumnLayoutChange?: (layout: ColumnLayout) => void` — fires once per committed change
  (resize commit, reorder drop, pin/hide action), NOT per drag frame. Fired from the store
  actions (no React render dependency).
- `initialColumnLayout?: ColumnLayout` — applied once at mount over the ColumnDef seeds
  (existing resolveColumnWidth precedence: layout beats def defaults). Partial objects fine.
- Rationale for not fully-controlled: save/restore needs notify + rehydrate, not per-render
  ownership; a controlled overlay would fight ColumnDef seeds and triple the surface.

## Gap fix 2 — no selection change callback

`onSelectionChange?: (selection: GridSelection) => void` on the grid root — fires on committed
selection changes (same store-action layer; document that drag-extend fires per step, which is
what presence/broadcast consumers want). The docs' presence page already tells users to wire
exactly this by hand; this makes it first-class. `onActiveCellChange` is NOT added — the active
cell is part of `GridSelection`; one callback suffices.

## The docs page — "Events & state"

New `content/docs/events-state.mdx` (+ meta.json nav, near api-reference) built around a new
registry example `data-grid-events-demo`: grid on the left, live inspector panel on the right
that pretty-prints (JSON.stringify, 2-space, syntax-highlighted in a code block) the LATEST
payload per event with a timestamp, most recent first (capped list). Events wired, one section
each, following the evaluation's outline:

1. `onDataChange` (edit/paste/fill/delete all normalize here — the flagship shape)
2. selection via the NEW `onSelectionChange`
3. `onSortChange` / 4. `onFilterChange` + join (isBetween tuple visible)
5. `onFillPattern` (veto pattern shown)  6. `onRowWindowChange` (scroll)
7. column layout via the NEW `onColumnLayoutChange` (resize/pin/hide live)
8. presence `setPresenceHighlights` read-back (the two-sided pattern, as contrast)

Prose per section: one paragraph on the shape + when it fires + the controlled/imperative/hook
triad table from the evaluation (trimmed). Page states the api-reference caveat (curated, full
list in store.tsx).

## Docs corrections from the evaluation

- columns.mdx: replace the silent asymmetry with the new `onColumnLayoutChange`/
  `initialColumnLayout` documentation (persistence recipe: save to localStorage, restore).
- api-reference.mdx: add the two new props + ColumnLayout type.
- multiplayer-presence.mdx: mention `onSelectionChange` as the broadcast hook (replaces the
  manual-subscription guidance).
- i18n: no new strings (no user-facing text in the events themselves; demo chrome is demo-local).

## Deferred (recorded, not built)

Pagination×url-state composition (documented non-goal stands), keymap change events, editing
start/cancel lifecycle events — all low-impact per the matrix.

## Tests

Unit: onColumnLayoutChange fires once per commit with the right snapshot (resize/order/pin/
hide), initialColumnLayout applied over defs, onSelectionChange fires on click/extend.
Browser: events demo renders payloads on interaction (click → selection JSON, edit → DataChange
JSON); existing suites stay green.
