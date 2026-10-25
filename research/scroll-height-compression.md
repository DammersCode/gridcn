# Scroll height compression — decision record

**Status: deferred.** The limit starts near 930,000 rows at 36 px. Until demand justifies a change to the hottest scroll path, the grid warns in development and the docs state the limit.

**Problem (measured, Chrome):** 1,000,000 rows x 36 px = 36,000,000 px of rows, but Chrome clamps element height to 33,554,428 px. The last 67,934 rows are unreachable, Ctrl+End activates row 999,999 at top 637 px in a 633 px viewport, and 90 % of the scroll range lands on row 838,843. At 500k rows (18 M px) all rows are reachable. Firefox clamps near 17.9 M px (inferred, unmeasured), so 500k x 36 likely already fails there.

**Decision:** above a fixed threshold, the spacer gets a capped real height and one linear map converts real `scrollTop` to a virtual (content) offset. Rendering, hit testing, and navigation work in virtual px. Wheel and touch move content 1:1 through a drift offset that is folded back into `scrollTop` at settle. Below the threshold every code path returns the real value untouched (bit-identical).

## 1. Mapping
- `MAX_SCROLL_EXTENT_PX = 15_000_000` (internal constant, below the Firefox clamp; a later slice may raise it per engine). `Dv = rowCount * rowHeight`; `compressed = Dv > MAX`; `Dr = compressed ? MAX : Dv`. `root.tsx:412` uses `Dr` in place of `rowCount * rowHeight`.
- `h = max(0, clientHeight - dataRowTop - bottomInset)`; `Mr = max(0, Dr - h)` (equals `scrollHeight - clientHeight` by `root.tsx:412`); `Mv = max(0, Dv - h)`; `k = Mv / Mr` (1.07 at 33.5 M, 2.4 at 15 M for 1M x 36). Recompute `k` on resize; keep `v` fixed and re-derive the offset so a resize never moves content.
- `base(r) = r >= Mr ? Mv : Math.round(r * k)`; `v = clamp(base(r) + offset, 0, Mv)`, with `r <= 0 -> 0` and `r >= Mr -> Mv`. Integer `v` keeps the canvas translate integral; the `r >= Mr` branch makes the last row land exactly at the viewport bottom (`Mv + h = Dv`).
- Inverse for programmatic targets: `r = clamp(Math.round(v / k), 0, Mr)`, `offset = v - base(r)` (|offset| <= k/2). Store `pendingVirtual = v`; the next `commit` re-derives `offset` from the observed `r`, which absorbs browser rounding of fractional `scrollTop`.
- No gaps: one real px moves `k` virtual px. `k < rowHeight` holds up to `MAX` rows (15 M at any row height >= 1); above that, warn once in dev (`isDev`). Keyboard still reaches every row.
- Canvas: the store writes `translate = canvasBaseOffset - v` (`use-scroll-snapshot.ts:160,196`), where `canvasBaseOffset = header + gridOrigin * rowHeight` (`body.tsx:161,247`). Both terms reach 36 M but their difference is small and exact in doubles. `gridOrigin` and `gridRowStart` (`body.tsx:152-160,235`) stay in row indexes and need no change.

## 2. Input
- **Snapshot:** `readGeometry` stays the single layout read per tick (`use-scroll-snapshot.ts:49,194`). `toSnapshot` adds `virtualTop`; `deltaTop` becomes the virtual delta (content px), so `computeWindow` (`use-row-window.ts:51,70-71`) reads `virtualTop`. `use-scrolled-edges.ts:43` keeps real `scrollTop`/`scrollHeight` (the edges coincide).
- **Wheel and touch:** passive `wheel` and `touchmove` listeners on the scroll element stamp `lastInputAt` (no `preventDefault`; compositor scrolling and momentum stay native). A tick is *relative* when `now - lastInputAt < 100 ms` and `|dr| < h` (thresholds inferred). A relative tick adds `dr` to `v` (1:1) and moves the difference into `offset`.
- **Edge convergence:** inside the last `h` real px before an edge in the travel direction, a relative tick uses gain `(Mv - v) / (Mr - r)` (or `v / r` upward), so `v` reaches `0`/`Mv` exactly when `r` does. No jump at the ends.
- **Settle resync:** on the settle commit (`isScrolling` false, `use-scroll-snapshot.ts:216,227`) with `|offset| >= k`, write `scrollTop = round(v / k)` through the programmatic path. Content does not move; the thumb moves `(k-1)/k` of the gesture distance in a 15 M px range, under 0.1 track px for a 1,000 px gesture. Skip the write when the target equals `r` (no event loop).
- **Thumb drag, middle-click autoscroll, find-in-page:** ticks without recent wheel/touch input are *absolute*: `offset = 0`, `v = base(r)`. After a settle resync the residual offset is under `k` px, so the switch is invisible.
- **Keyboard and `scrollToCell`:** `scrollCellIntoView` (`use-grid-interaction.ts:178-201`) computes `cellTop = row * rowHeight` in virtual px, reads `viewTop` as `store.toVirtual(scrollTop)`, and calls `store.scrollToVirtual(target)`. Page keys (`:384-388`), Ctrl+End, and search (`data-grid-toolbar/search.tsx:142`) move the active row by index and then call it, so they land the row fully visible. `pointerToCoord` (`:158`) uses `store.toVirtual` too. Cell focus already uses `preventScroll` (`cell.tsx:179`).
- **Auto-scroll** (`use-grid-interaction.ts:781-784`, `rows/use-row-reorder.ts:91-94`, `data-grid-fill/use-fill-handle.ts:212-213`): unchanged. Their real px steps are absolute ticks and run `k` times faster when compressed. This keeps the fill add-on off any new barrel export.

## 3. Interactions
- Origin trail (96 rows, rebase past 192, `body.tsx:65,153`): index space, unaffected. Overlays receive `windowStart={gridOrigin}` and clamp rows (`body.tsx:293-298`): unaffected. Row reorder hit test uses `elementFromPoint` (`body.tsx:182-190`): unaffected.
- Velocity estimator: fed virtual deltas. The teleport rule `|d| > viewportPx + 1600` (`velocity-estimator.ts:116`) and the 72 px trigger (`:34`) are content px. Compressed thumb drags teleport more often, which only renders a smaller window.
- Pinned bands and the sticky header: fixed px (`root.tsx:231-232`) inside `dataRowTop`/`bottomInset`, so `h` excludes them. Unaffected.
- State anchoring, compact selection channels, `readOnly`, `sortMode="server"`: untouched (no new write path). SSR: `Dr` is a pure function of props, so server and client render the same spacer height.

## 4. API, docs, changelog
- Public API: none. `MAX_SCROLL_EXTENT_PX`, `toVirtual`, `scrollToVirtual` stay internal to `virtualization/` and off the barrel.
- `CHANGELOG.md` Unreleased, Fixed: "All rows are reachable in grids taller than the browser's maximum element height (about 930,000 rows at 36 px in Chrome)."
- Docs: one sentence on the virtualization or performance page (marked by `pnpm docs:changes` at release): above 15,000,000 px of rows the scrollbar covers the rows proportionally; wheel, touch, and keyboard still move by pixels and rows. Public copy stays at "smooth at 100k+" until the sort fix lands.

## 5. Test plan (no 36 M px element needed except one test)
- Unit (`virtualization/scroll-extent.test.ts`, pure module): identity below `MAX` including fractional `r`; `base(0) = 0`; `base(Mr) = Mv`; monotonic over every `r` in a sweep; max step `<= ceil(k) < rowHeight`; `base(toReal(v)) + offset === v`; first and last row reachable; edge convergence ends at `Mv` from any offset; resize keeps `v`.
- Browser, compression without the clamp: 600,000 x 36 = 21.6 M px (compressed, below every engine clamp). The real compressed path runs, so no test-only option is needed.
- Browser, real clamp: 1,000,000 x 36. Scroll to 100 % and Ctrl+End: row 1,000,000 (`aria-rowindex`) is fully inside `[header bottom, viewport bottom - bottom band]`.
- Regression: the existing scroll suites (origin rebase, blanking, overlays after rebase) pass unchanged; below `MAX` they exercise the bit-identical path.

## 6. Risks and go/no-go
- Biggest risk: the relative/absolute classifier. A thumb drag within 100 ms of a wheel tick counts as relative until it exceeds `h` per tick (inferred to be rare; the settle resync bounds the damage to one gesture).
- The settle `scrollTop` write could cancel trackpad momentum if `scrollend` fires early (inferred; Chrome fires it after momentum).
- Go only if: (a) last row fully visible at 100 % and after Ctrl+End at 1M x 36; (b) a 100 px wheel step moves content 100 +/- 1 px at 1M rows; (c) no content jump > 1 px across a settle resync; (d) still one `readGeometry` and one `translate` write per tick, no new style writes, no layout read in the scroll handler; (e) existing scroll and perf suites green and identical below `MAX`; (f) Firefox reaches the last row at 600k and 1M rows.

## 7. Slices (failing test first, in order)
1. **Mapping module.** Red: unit test "1M x 36 maps `Mr` to `Mv` and every step stays below one row". Measures the math only.
2. **Wire the store, spacer, row window, canvas.** Red: the 1M x 36 clamp test, scrolled to `scrollHeight - clientHeight` (today the last reachable row is about 932,000). Then the 600k x 36 test, which passes today and must stay green on the compressed path. Measures last-row rect and the per-tick write count.
3. **Index-based navigation.** Red: Ctrl+End at 1M x 36 leaves row 999,999 at top 637 px (today) instead of fully visible; plus a click at 50 % activates the row under the pointer. Measures the active row rect and the clicked row index.
4. **Wheel 1:1, edge convergence, settle resync.** Red: a 100 px wheel step at 1M rows moves content by `100 * k`. Measures content delta per wheel step, the row rect before and after settle, and the end-of-fling jump.
