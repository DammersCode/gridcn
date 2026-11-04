# Interaction cost: script per click and per key

Harness: `scripts/perf-interaction.mjs` against a production build with `GRIDCN_DEV_ROUTES=1` (page `/dev/interaction-bench`: 9 columns incl. text, number, select, checkbox, pinned left and right, row markers, header filter). Script time is the CDP `ScriptDuration` delta around one interaction plus two frames. 8 warm-up and 30 measured interactions per run, 3 to 5 fresh page loads per cell, pooled median and MAD. Several base URLs run interleaved so machine load hits each equally. Orientation only: another grid reports about 0.8 ms per click and 13 ms per key at 4x CPU slowdown; its conditions are unknown.

## Baseline (HEAD bb190349, noisy shared machine)

| Rows | Throttle | click | arrow | Shift+arrow | start typing |
|---|---|---|---|---|---|
| 1,000 | 1x | 2.4 ± 0.4 ms | 1.4 ± 0.3 | 1.0 ± 0.2 | 1.5 ± 0.1 |
| 1,000 | 4x | 25 ± 4 | 13.5 ± 2 | 9.3 ± 1.6 | 13.8 ± 1.9 |
| 100,000 | 1x | 2.5 ± 0.6 | 1.6 ± 0.3 | 1.2 ± 0.2 | 1.7 ± 0.2 |
| 100,000 | 4x | 25 ± 6 | 13.3 ± 2.4 | 9.3 ± 1.4 | 13.7 ± 1.7 |

Row count does not matter: the cost is one commit plus forced style and layout on the rendered window.

## Where the time goes (trace, 1,000 rows, per arrow key)

- One React commit renders about 10 components (production), 31 in dev. Rows, cells and the marker re-render only for the two rows involved.
- `focus()` in the cell layout effect forces style recalculation (3.5 passes) and one layout (0.86 ms of about 1.4 ms).
- Three things each dirtied the canvas grid layout: a cell switching `z-index` between `auto` and an integer, the selection overlay moving, the active-cell overlay moving. Removing all three removed the layout; any one kept it.

## Changes and results

| Change | Effect | Cost |
|---|---|---|
| Cells always carry an integer `z-index` (`GRID_LAYER.cell` = 0) | forced layout per key 0.86 to 0.60 ms with the overlay change; style recalc down in an isolated run | each cell is a stacking context; low risk, no order change (0 and auto tie in tree order) |
| Unpinned overlays `position:absolute; inset:0` | part of the layout drop above | pinned segments keep `position:relative` and sticky-like insets |
| Row ref-callback cache keeps identity | StrictMode: 28 row renders per key to 2 (dev only; production unchanged) | none |
| Root subscribes to the active column only when off-window | root and its provider skip about half of the arrow keys | one selector closure over the window |

Trace totals (production, arrow): layout 0.86 to 0.60 ms; click event dispatch 2.14 to 1.88 ms. Component renders per interaction (production): click 17.9 to 15.8, arrow 11.5 to 10.5, Shift+arrow 5.8 unchanged.

Wall-clock `ScriptDuration` shows the gain at 1x (about 10 to 15 %) but it sits inside the noise on a loaded machine (MAD 20 to 30 %); the 4x runs flipped between loads. Treat the trace numbers as the evidence and re-run on an idle machine before quoting.

## Tried and dropped

- Hiding overlays or the live region by CSS: no change alone; overlays, cell `z-index` and each other all had to go for the layout to disappear.
- Moving overlays to pixel or transform placement (0.6 to 0.1 ms in isolation): overlays place by grid lines, and the public `OverlayPluginCtx` and pinned zones depend on that. Costs an API change and pinned-zone rework; not taken.
- Avoiding the forced style flush from the `tabindex` switch on the focused old cell: ordering is React's; no simple handle.

## Where it stays

Near the orientation number at 1x. The remaining cost is the forced `focus()` flush and a single commit; a further cut needs the pixel-placed overlay redesign above.
