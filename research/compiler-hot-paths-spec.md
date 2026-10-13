# Compiler hot-paths: remove the bail-outs (R-81)

`next.config.mjs` runs the app with `reactCompiler: true`, and the
`unit-compiled`/`browser-compiled` test projects mirror that. Today 31 functions under
`registry/` bail out of compilation (`scripts/compiler-bailouts.baseline.json`); 12 of them are
the render hot paths — `DataGridBody`, `DataGridCellImpl`, `useGridInteraction`,
`DataGridOverlays`, `DataGridContextMenu`, and the seven windowing-hook functions. They ship
uncompiled, so the compiler's memoization never protects the per-tick and per-cell render paths.
This spec records how each bail-out is removed with no behavior change.

## Scope

Hot paths only. The other 19 bailing functions (reorder/resize hooks, fill, history, io, lazy,
presence, url-state, dropzone, examples) stay in the baseline. No public API change: every hook
keeps its signature and return shape.

## Per-file decisions

1. **`body.tsx` — `DataGridBody`** (`Globals: Cannot reassign variables declared outside of the
   component/hook`). The dev-only warn-once flag is a module-level `let` reassigned inside
   `useMemo`. A module-level `const` object with a flipped property is rejected too
   (`Immutability: This value cannot be modified` — the compiler treats const objects as
   immutable), so the reassignment moves into a plain module function
   (`warnRowCountMismatch`): plain functions are not compiled, so the `let` sits outside the
   compiler's scope. Same warn-once semantics, same message. House pattern: `use-row-window.ts`
   already keeps `warnedUnboundedHeight` in plain `computeWindow` for exactly this reason.
  
  Clearing the Globals bail surfaces a previously-masked `Refs` event: `getRowRefCallback`
  (the stable per-key row ref callbacks that keep `DataGridRow` memoized) read/wrote two refs
  while called from the rows JSX. The elements Map, the callback cache, and the prune sweep
  move verbatim to a plain module (`row-element-registry.ts`); the component holds one
  `useMemo(() => createRowElementRegistry(), [])`. The compiler compiles per file and cannot
  see through a foreign module's Maps, so the render-time `getCallback(key)` call is opaque.
  Callback identity, the unmount-removal semantics, and the prune behavior are unchanged.

2. **`cell.tsx` — `DataGridCellImpl`** (`Refs: Cannot access refs during render`, 3 events).
   The pending-value seed block writes `pendingValueRef`/`pendingSessionRef` during render
   (re-seed while not editing / on a new session). Move the seed into a `useLayoutEffect`
   keyed on `[isEditing, editSession]` (the `value` closure is read deliberately — the value at
   the session flip, oxlint-disabled). Semantics preserved:
   - Layout effects flush before any passive effect, so the seed lands before the checkbox
     editor's on-mount `tryCommit()` (the only editor that commits without user input).
   - A mid-edit re-render (stream tick, cellError) does not re-run the effect (deps
   unchanged), so the typed draft is never reset — same as the render-time guard.
   - A session flip while editing re-seeds (rejection), same as today.
   - `commit()` still reads the ref synchronously right after `onChange` wrote it; the ref is
   the contract, only the seed site moves.

3. **`interaction/use-grid-interaction.ts` — `useGridInteraction`**
   (`Immutability: Cannot access variable before it is declared`). `runDragFrame` is a
   `useCallback` arrow that references itself in its own `requestAnimationFrame` (line 753) —
   a use-before-declare at the IR level. A hoisted function declaration is rejected too
   (`Todo: [PruneHoistedContexts] Rewrite hoisted function references`), so the next frame
   re-enters through `dragFrameRef` (`useRef`, written by a `useEffect` keyed on
   `[runDragFrame]`): `requestAnimationFrame(() => dragFrameRef.current?.())`. No
   self-reference remains, `runDragFrame` keeps its stable `useCallback` identity (deps
   unchanged), and `beginDrag` keeps it in its dep array as before — zero handler churn. The
   ref is set before any drag can start (effects flush at mount, `beginDrag` only runs from
   pointer events); the indirection also makes a mid-drag deps change pick up the fresh
   instance within a frame, which the direct self-reference could not.
   
   Clearing the Immutability bail surfaces two previously-masked `Refs` events: `isMacRef` and
   `layoutRef` were written during render (latest-ref pattern). Both are read only inside event
   handlers, so the writes move into a `useLayoutEffect` keyed on `[layout]` (effects run
   before any event can fire; `isMacPlatform()` is pure and stable, recomputed idempotently).
   No handler identity or dep array changes.

4. **`overlays.tsx` — `DataGridOverlays`** (`Todo: (BuildHIR::node.lowerReorderableExpression)
   Expression type BinaryExpression cannot be safely reordered` at the destructure default
   `clampRowEnd = windowStart + rowCount`). Hoist both defaults out of the destructure:
   `const clampedRowStart = clampRowStart ?? windowStart;` /
   `const clampedRowEnd = clampRowEnd ?? windowStart + rowCount;`, and use the resolved names
   everywhere (band rects, `clampRectToWindow`, and the `clampRowStart`/`clampRowEnd` props
   passed to plugin overlays — values identical to the old defaults).

5. **`data-grid-context-menu/context-menu.tsx` — `DataGridContextMenu`** (`Refs: Cannot access
   refs during render`). Two render-path ref touches:
   - `selectionRef` (latest-ref write in render) is read only inside `onContextMenu`, where
     `storeApi.getState()` is already read — use `storeApi.getState().selection` there and
     delete the ref and the `useDataGridSelection` subscription (the component re-rendered on
     selection changes only to feed that ref).
   - `scrollRootRef` (written in the handler, read in JSX at line 180) becomes a `useState`
     value set in the same handler as `setTarget` — same commit, same render reads it.
   - `targetRef` stays a ref: it is touched only in `onContextMenu`/`onOpenChange` (event
     time), which the compiler allows; the synchronous cancel check is untouched.

6. **`windowing/use-scrolled-edges.ts` — `useScrolledEdges`** and **`windowing/
   use-pin-shadow-edges.ts` — `usePinShadowEdges`** (`.current` read in the dep arrays).
   Both hooks subscribe to the grid's own scroll/viewport elements, which are stable for the
   grid's lifetime (a swap is a remount, which re-runs the effect from scratch). Read the
   refs inside the effect; key the effects on the value deps only (`[]` for
   `useScrolledEdges`, `[hasPinnedLeft, hasPinnedRight, direction, pinSignature]` for
   `usePinShadowEdges`). Re-subscription on element change was never exercised by the grid's
   own elements.

7. **`windowing/use-scroll-snapshot.ts` — `useScrollSnapshot`, `useElementDimensions`,
   `useViewportElement`** (render-time `scrollRef.current` reads + `forceUpdate` reducer +
   `.current` deps). Shared shape for all three:
   - Track the element in a `useState`, fed by a no-deps `useLayoutEffect` watcher that
     compares `scrollRef.current` against the state and `setElement`s on change. This keeps
     the "ref attaches after mount, then a re-render heals" behavior the
     `use-row-window.test.ts` tests exercise (empty-deps would miss it), without a
     render-time ref read.
   - `useScrollSnapshot`: snapshot in state; the subscription effect (keyed on `[element]`)
     seeds from `store.getSnapshot()` and re-sets on every store notify. Callers see the last
     notified snapshot instead of a live render-time read — equivalent, because any store
     change notifies (a silent re-render would read the identical object).
   - `useElementDimensions`: dimensions in state; the listener uses a functional `setDims`
     with the same equality check as today's `lastRef` comparison (bails on unchanged
     size, so no per-tick re-render — the documented resize-rate guarantee).
   - `useViewportElement`: both elements tracked in state; the registration effect is keyed
     on `[element, viewport]`.
   First-render values are unchanged (`INITIAL_SNAPSHOT` / `{0,0}` / no-op).

8. **`windowing/use-row-window.ts` — `useRowWindow`** and **`windowing/use-column-window.ts`
   — `useColumnWindow`** (render-time element read, `optsRef` render write, `velocityEstimateRef`
   render read, `windowRef`/`indicesRef` render write, `.current` dep). The window is computed
   in render today so any re-render picks up the live store snapshot; the compiler-safe
   equivalent keeps exactly that render-time compute and removes only the ref touches:
   - The element is tracked in state via the §7 watcher (no render-time ref read).
   - The velocity estimate AND the scroll snapshot live in one `useState` tick object
     (`{ estimate, snapshot, token }`); the store listener is its sole writer (a tick is
     observed once), so the feed discipline is unchanged. The snapshot CANNOT be a
     render-time store read: the compiler memoizes a `getSnapshot()` call per element
     identity and serves the cached (pre-scroll) snapshot on tick re-renders — verified in
     `test:compiler`, where the window then never left its initial value. The token forces
     the memo to recompute on a write whose values happen to be unchanged (velocity-cap
     plateau: the estimate stays at its cap across consecutive fast ticks, and a plain
     `setEstimate` would bail the re-render).
   - The window/indices stay a render-time `useMemo` over (element state, tick state,
     fresh opts inlined in the callback) — the memo deps must cover every callback read,
     which the `PreserveManualMemo` pass enforces (a per-render `resolvedOpts` object in
     the callback with only its primitives declared bails). `optsRef` and
     `velocityEstimateRef` are deleted.
   - The memo IS the heal: element attach, an opts change, or a flushed tick (new tick
     state) all recompute in the same render. An effect-based heal instead renders one
     frame with a stale window/indices after a change that shrinks the grid (a hidden
     column's index points at nothing — crash; a shrunken rowCount renders phantom
     skeleton rows) — verified against `data-grid-presence`'s hide/reorder tests.
   - `windowRef`/`indicesRef` become listener-side skip-compare caches synced post-commit
     (pre-paint) by a no-deps layout effect — the listener compares a fresh compute against
     the last committed window to skip no-op ticks (the "scroll within the overscan buffer
     does not re-render" guarantee), and a tick can never compare against a superseded
     window.
   - The subscription effect keeps the same `recompute`/`onIdleReset` listener bodies, but
     the flush is `store.requestFlush(() => setTick(...))` — the re-render the single
     `flushSync` per tick triggers recomputes the identical window via the memo (same
     inputs), so the one-commit-per-tick contract and the pre-paint landing are unchanged.
     `onIdleReset` uses plain `setTick` (outside a `notify()` cycle). Deps: row
     `[element, ...opts primitives]`, column `[element, widths, pins, overscan, markerWidth,
     contentWidth]` — a re-subscribe on opts change is O(1) (both windows share the element
     store, so no DOM listener re-attach) and keeps the listener closure fresh.
   - Mount cost: the element state's `null → el` transition is one extra pre-paint render
     per hook (the old render-time ref read saw an already-set ref in render 1). The
     fallback window renders real rows, so nothing paints unwindowed; the heal lands in
     the layout-effect flush before paint.
   - Test adjustments forced by compilation: `composition-props.test.tsx`'s count-pinned
     assertions (`renderHeaderCell` call count, `emptyState` call count) now assert per
     column / per call (the mount heal render may render the header a second time);
     `data-grid.test.tsx`'s readOnly-flip test now asserts the cell's `data-readonly`
     attribute instead of `renderCell` re-invocation — the compiler legitimately skips
     re-invoking a cell type's render when none of its inputs changed (the cell content
     does not read `gridReadOnly`).
   - Commit timing: the memo recomputes exactly when its deps change (tick renders via the
     tick state, opts-change renders in the same commit). The `measured` flag and the
     `onRowWindowChange` gating are untouched.

## What does not change

- The element store contract (`subscribe`/`getSnapshot`/`requestFlush`/`setViewportElement`),
  the single-`flushSync`-per-tick drain, the velocity estimator, and `computeWindow`/
  `computeIndices` (including the module-level dev warns in plain functions — not compiled).
- The 19 non-hot-path baseline entries.
- `test:compiler` (the compiled mirror) and the FPS guardrails in
  `perf.browser.test.tsx` / `custom-marker-perf.browser.test.tsx` are the behavior nets: they
  run the whole suite, compiled and uncompiled.

## Measurement and gates

- Measure `perf.browser.test.tsx` + `custom-marker-perf.browser.test.tsx` in the `browser`
  and `browser-compiled` projects before and after; record the FPS values in the commit
  summary. A regression in the uncompiled `browser` project means the refactor changed
  behavior (investigate); the `browser-compiled` project is where the compiler win shows.
- Gates in house order: `pnpm types:check`, `pnpm types:check:ts5`, `pnpm lint:typed`,
  unit suite (targeted first: `rows`, `windowing`, `test/data-grid.test.tsx`), browser suite
  (targeted: `row-reorder`, `row-markers`, `data-grid` first), `pnpm test:compiler`,
  `pnpm build`, registry rebuild + normalize + stage, full `pnpm lint` (bail-out baseline),
  `pnpm registry:verify`, `pnpm test:e2e-install`.
- Baseline: delete exactly the 10 hot-path file entries (12 functions) from
  `scripts/compiler-bailouts.baseline.json`; `check-compiler-bailouts.mjs` fails on any new
  bail-out or stale entry, which is the drift guard.
