# TanStack Virtual — Why Their Demos Don't Blank on Fast Scroll (Code Study)

Studied: `references/table/examples/react/virtualized-*` + `references/virtual/packages/{virtual-core,react-virtual}/src`. Companion to research/scroll-blanking.md.

## The finding: no dedicated anti-blank logic exists — it's three mechanisms combined

Grep for blank/flicker/prerender/placeholder across virtual-core and react-virtual: zero matches. The behavior is emergent from:

1. **Generous symmetric overscan** — core default is 1, but every example overrides: rows 5, columns 3. No direction-awareness, no velocity logic anywhere (`velocity` doesn't appear in the source). `scrollDirection` exists only to sign scroll-position compensation when item sizes change.
2. **Fully synchronous scroll pipeline** — passive `scroll` listener on the real scroll element → `_willUpdate` reads `scrollTop`, sets `isScrolling=true` → `maybeNotify()` → `calculateRange()` (binary search) → `notify(isScrolling)` — all in the same tick, no rAF, no debounce, no microtask gap.
3. **`flushSync` while scrolling** (the smoking gun) — react-virtual re-renders via a `useReducer` counter, NOT `useSyncExternalStore`, and its `onChange` does:
   ```tsx
   if (useFlushSync && sync) { flushSync(rerender) } else { rerender() }
   ```
   `useFlushSync` defaults to **true**; `sync === isScrolling`. So during active scrolling every range change commits to the DOM synchronously **before the scroll handler returns** — the compositor never gets to paint a frame with the stale row set. `useSyncExternalStore` alone does NOT give this guarantee (React can still defer/batch the commit past the paint under concurrent scheduling).

Plus a supporting factor: example rows are deliberately dirt-cheap (border-bottom + padding, flex cells, 8 columns), so the flushSync reflow fits well inside a frame.

## DOM structure

- Scroll container (`overflow:auto; position:relative`) → sticky `<thead>` → `<tbody style="display:grid; position:relative; height:{getTotalSize()}px">` (the sizer) → only windowed `<tr>`s, each `position:absolute; transform:translateY({row.start}px); display:flex`.
- **Rows are positioned by `transform`** — a compositor-cheap property. No layout recalculation to move a row.
- Column virtualization: not per-cell transforms — two spacer divs (left/right padding widths) at row edges, real cells flow between them via flex.
- `isScrolling` reset: debounced 150ms (default) or native `scrollend` when `useScrollendEvent: true`. Used to gate sync-vs-deferred row measurement, iOS momentum-safe scroll adjustment, and the flushSync path — NOT to widen overscan.

## Deltas vs gridcn's engine (what to adopt)

| Aspect | TanStack | gridcn today | Action |
|---|---|---|---|
| Commit timing during scroll | `flushSync(rerender)` when isScrolling | `useSyncExternalStore` (no sync-commit guarantee) | **Adopt: flushSync the window update during active scroll** |
| Row positioning | `transform: translateY` (composite-only) | `gridRowStart` (layout-bound: every window shift re-runs grid layout) | Consider hybrid or sticky-layer transform (see scroll-blanking.md); at minimum keep row content cheap |
| Overscan | 5 symmetric | 4 symmetric | Raise to ~8-10; optionally direction-biased (MUI-style) |
| Scroll pipeline | sync in scroll event | sync in scroll event (same) | Keep |
| isScrolling flag | yes (drives flushSync + measurement deferral) | none | Add (scrollend + 150ms debounce fallback) |

## Recommended gridcn scroll-fix stack (ordered)

1. `isScrolling` tracking + **flushSync window commits during scroll** + overscan 8-10. Low effort; replicates the exact mechanism behind the demo the user tested and found smooth.
2. If blanks persist at extreme scrollbar-drag speeds (layout-bound `gridRowStart` repositioning may still slip a frame where translateY wouldn't): move the row window into a sticky viewport layer positioned by a single transform (research/scroll-blanking.md §fix design) — the hard guarantee.
3. Measure with the dev page FPS meter + react-scan before/after each step; only escalate to (2) if (1) measurably fails.
