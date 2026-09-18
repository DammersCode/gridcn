# Fast-Scroll Blank Cells in DOM Virtualization — Research & Fix Design

Why DOM grids show blank/pop-in cells on fast scroll, why canvas grids (glide) don't, and what actually fixes it. Sources verified 2026-07-03.

## Root cause (confirmed, primary sources)

Chrome scrolls on the **compositor thread**, independent of the main thread. The compositor repositions already-rasterized layers without waiting for JS; scroll events are coalesced to rAF-rate and delivered just before pre-paint. If the virtualizer's React commit hasn't painted by the next compositor frame, the compositor **presents the previous DOM content at the new scroll offset** — blank tracks appear. Crucially, instrumentation (thecandidstartup.org, two-post series) shows the race persists even with 2–5ms renders and `flushSync`: the scroll *event dispatch itself* can arrive ~13ms late, so "render faster" and "flush sync" **cannot** fully fix it. React 18 concurrent scheduling makes it worse (continuous events deprioritized).

Canvas grids never blank because the canvas sits sticky over the viewport and repaints per frame — the compositor cannot reveal unrendered area.

- Chromium compositor docs: chromium.org/developers/design-documents/compositor-thread-architecture
- developer.chrome.com/blog/inside-browser-part4
- engineering.monday.com/our-journey-to-understand-scrolling-across-different-browsers
- thecandidstartup.org/2024/11/11/react-glitchy-virtual-scroll.html (Performance-panel trace of the race)

## Technique catalog (evidence-ranked)

| Technique | Verdict | Evidence |
|---|---|---|
| Flat overscan | Partial; fails at fling/scrollbar-drag speed | AG Grid rowBuffer default 10 admits blanks; react-virtualized overscanUsage.md concedes it |
| **Direction-biased, pixel/velocity-based overscan** | Real improvement, cheap | MUI X shipped it (issue #11344, PR #12353) |
| isScrolling → cheap placeholder | Masks, doesn't fix; we don't want visible placeholders | react-virtualized List.md |
| **Sticky-viewport + transform ("controlled" positioning)** | **The only technique with documented full resolution** | thecandidstartup.org 0.6.x "Consciously Uncoupling" ("browser can no longer scroll stale content out of view") + MUI X `virtualizerLayoutMode: 'controlled'` ("eliminates render gaps under fast scrolling") |
| Ref-based scroll tracking (state only for render triggers) | Required companion to the above — naive version glitches (stuck scrollbar) from stale React state reads | thecandidstartup.org "State Considered Harmful" |
| content-visibility / contain / overflow-anchor / ScrollTimeline | Orthogonal (render cost, anchoring); none touch the compositor race | LogRocket, MDN |
| Background pattern on scroller | Cosmetic mask | TanStack/virtual discussion #694 |

Infragistics article (Kevin Van Cott 2026): general grid-selection guidance (dual-axis virtualization, explicit heights, windowed fetch); nothing on the blanking race.

## The fix design for gridcn (implement in a dedicated scroll-perf phase)

Keep: the outer element stays the REAL scroll container (native scrollbar/wheel/momentum untouched), and the CSS grid `repeat()` track list stays as the scroll-height source. Change: stop letting native scroll reposition row children directly.

1. **Sticky rendering layer**: inside the scroll container, a `position: sticky; inset-block-start: 0; height: <viewport>` layer holds the windowed rows. Rows are positioned by `transform: translateY(rowTop - scrollTop)` (one transform on the layer, computed in the scroll handler) instead of `gridRowStart` flow placement. The compositor can then never reveal unrendered area — worst case is one frame of stale-but-painted rows (identical to canvas behavior).
2. **Ref-authoritative scroll**: live scrollTop lives in a ref updated in the scroll handler (and drives the layer transform imperatively via `style.transform` — no React render needed for pure translation). React state (useSyncExternalStore) only receives the derived row-window when it actually changes → re-render only mounts/unmounts edge rows.
3. **Direction-biased velocity overscan**: buffer sized in px from recent scroll velocity, biased toward scroll direction (MUI-style), on top of the sticky layer.
4. Column pinning: horizontal `position: sticky` composes with the vertical transform layer (two independent axes); needs care, not a conflict.

Consequences to handle: header remains sticky in the outer grid; subgrid column alignment must move into the sticky layer (the layer itself becomes a grid with the same `grid-template-columns`, or per-row subgrid against it); selection overlays move into the layer so they translate with rows; scroll-into-view logic unchanged (still native scrollTop writes).

Costs: implementation complexity + the ref/state subtlety above. A11y and find-in-page: unchanged vs any virtualized grid.

## Effort→impact order

1. Direction-biased velocity overscan (cheap, do first).
2. Sticky-viewport transform layer (the guarantee; medium-high effort).
3. Skip: content-visibility/ScrollTimeline/anchoring for this bug.

See also: research/tanstack-virtual-study.md (code-level study of how TanStack's demos behave).
