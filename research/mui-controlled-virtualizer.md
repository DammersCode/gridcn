# MUI X "Controlled" Virtualizer — Implementation Reference for gridcn's Sticky-Viewport Engine

Code study of `references/mui-x` (`packages/x-virtualizer`, `x-data-grid/src/components/virtualization`). MUI documents this mode as eliminating render gaps under fast scrolling. This is the blueprint for gridcn's zero-blank engine rework.

## The mechanism

DOM structure (controlled mode):

```text
Scroller (overflow:scroll — REAL scroll element)
  Content (in-flow, sized to FULL virtual width/height → provides native scroll extent)
    Viewport (position:sticky; top:0; left:0; inline-block; overflow:hidden — PINNED to scrollport)
      Header container (absolute; translate3d(-scrollLeft, 0, 0))
      RenderZone (absolute; translate3d(-scrollLeft, windowTop - scrollTop, 0)) — data rows
      Bottom pinned container (absolute)
```

Native scroll becomes a visual no-op (the sticky Viewport cancels it); 100% of visible motion is the JS-written transform. **Blank is impossible**: rows never move due to native scroll, so the compositor can't reveal unrendered area — worst case is one frame of stale rows (canvas-grid behavior).

## The scroll pipeline (the load-bearing details)

1. Passive `scroll` listener on the real scroller. Fully synchronous — no rAF/debounce.
2. Read scrollTop/scrollLeft, **clamp to [0, maxScroll]** (absorbs iOS/macOS rubber-band bounce).
3. **Transform updates on EVERY scroll tick** (rows track the pointer precisely between window recomputes).
4. **Render window recomputes only when accumulated scroll crosses a threshold** (~1 rowHeight vertically / 1 min column width horizontally) or scroll direction flips.
5. When the window changes: `ReactDOM.flushSync(() => updateRenderContext(...))` — new rows + transform commit in the SAME pass, inside the scroll event. This is the crux: transform and row-set never land in different frames.
6. **Zero overscan in controlled mode** (`bufferForDirection` returns EMPTY_BUFFER) — the window is derived exactly from live scroll position by binary search over row positions; buffers exist only to hide async lag, which controlled mode doesn't have. (Uncontrolled mode contrast: direction-aware buffer of rowHeight×15 in the scroll direction.)

## Pinned columns / header sync

- Vertical pinning (header, pinned rows): free — they sit absolutely inside the sticky Viewport; only counter-translated horizontally (`translate3d(-scrollLeft, 0, 0)`).
- Horizontal pinning: `position: sticky` CANNOT work for descendants of a transformed ancestor. MUI switches pinned cells to absolute and adds a live scroll term into their `left`/`right` style: `left = staticPinOffset + scrollLeft`, `right = max(totalW, viewportW) - viewportW - scrollLeft + scrollbar`. Updated from the same scrollPosition value in the same render pass — pinned and unpinned cells can never drift by a frame.
- gridcn adaptation: drive everything from TWO CSS custom properties written imperatively per scroll tick on the Viewport element (`--grid-scroll-left`, `--grid-scroll-top`); the canvas transform and pinned-cell insets are calc() expressions over them plus static per-column constants → one style write moves rows, header, and pinned cells atomically with zero React involvement between window changes.

## Documented tradeoffs

- Controlled: if the JS thread stalls, visual scroll stalls with it (feels laggy) instead of showing blanks. Same trade glide-data-grid makes — acceptable for gridcn's "never see rendering" goal.
- Safari caps scroll-driven repaint at 60Hz (WebKit bug 173434) even on ProMotion displays.
- MUI hides native scrollbars and ships a custom scrollbar (design choice + iOS swap quirk). gridcn keeps the native scrollbar — the sticky-viewport pattern doesn't require replacing it.

## gridcn port checklist

1. Root stays the real scroll container with native scrollbar. Replace root grid tracks with: in-flow Content div sized `totalColumnsWidth × (headerH + rowCount*rowHeight)` (kills the 1M grid-track cap), containing the sticky Viewport sized to clientWidth/Height (from the scroll snapshot).
2. Inside Viewport: header strip + rows canvas, both `display:grid` with the full `grid-template-columns` (subgrid row alignment preserved per container); rows placed at window-RELATIVE gridRowStart; aria-rowindex stays absolute.
3. Per-tick imperative CSS var writes (`--grid-scroll-left/top`) in the scroll listener; canvas transform + pinned insets are calc() over them. React re-render (flushSync while scrolling) only on window change.
4. Window: zero/1 overscan, recompute on row-boundary crossing or direction flip; keep MAX_RENDERED_ROWS cap + unbounded-height warning.
5. Clamp scroll reads for rubber-band.
6. scrollIntoView on cells no longer works under the transformed layer — Phase 4 keyboard nav must use imperative `scroller.scrollTo` computed from data coords (we own this in the ref API anyway).
