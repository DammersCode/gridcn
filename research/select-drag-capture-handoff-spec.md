# Select-drag capture handoff

The interaction layer's select drags (cell range, row marker, header column, marker checkbox)
take pointer capture on the pressed element. Edge auto-scroll virtualizes the pressed element
out of the rendered window; the browser releases capture when a captured element unmounts, and
a touch pointer is cancelled with it. That is the same failure the row-reorder grip had and
`d0ffc54` fixed by holding its capture on the scroll element from arm time: a select drag that
auto-scrolls past the rendered window dies on touch.

## Constraint: capture cannot move up front

The post-drag `click` and `dblclick` retarget to the capture element. The cell's `click`
resolves the pending active-cell press (`pendingActiveClickRef`, the checkbox toggle for a
stationary press) and the cell's `dblclick` enters edit mode. Holding capture on the scroll
element from press time would starve the cell of both events and break dblclick-editing, so the
handoff has to happen late — only once the click the capture would retarget is already dead.

## Fix

`registry/default/blocks/data-grid/interaction/use-grid-interaction.ts`:

- The drag frame loop hands the capture to the scroll element the moment an edge auto-scroll
  step runs. By then the pointer has left the pressed cell's coordinate, so the pending press
  can no longer resolve (it is cleared as it leaves) and the scroll element's capture outlives
  the drag — touch select drags survive auto-scroll past the rendered window, mouse as before.
- The pending active-cell press is resolved in the document `pointerup` handler ONLY when the
  capture was handed off (then the post-drag `click` targets the scroll element and can never
  reach the pressed cell): on the true pointerup coordinate, guarded by `detail < 2`,
  `!readOnly`, `hasActivateCell`; `pointercancel` discards the press instead. Without the
  handoff the cell's own capture-retargeted `click` resolves the press exactly as before —
  which matters because the `click` event's `detail` (the dblclick dedup) is reliable where
  the `pointerup` detail is not (user-event dispatches pointer events with `detail` 0).

Net behavior change: touch select drags survive auto-scroll; a drag that ends back on the
pressed cell after the handoff still toggles its checkbox (the `pointerup` resolution covers
the case the `click` could not). Everything without the handoff is untouched.

## Tests

Unit (`use-grid-interaction.test.tsx`), driving the frame loop through a stubbed `rAF`:

- a cell press takes capture on the pressed element; the first auto-scroll frame moves it to
  the scroll element; `pointerup` releases it from the scroll element, not the pressed one.
- a drag whose pointer never enters an edge zone keeps capture on the pressed element.
- a `pointerup` without the handoff does NOT resolve the pending press (the cell click owns
  it — a stray `pointerup` resolution would double-toggle a dblclick).
- a checkbox press on the active cell that then auto-scrolls still toggles the cell on release
  at the pressed cell's coordinate (the `pointerup` resolution).
