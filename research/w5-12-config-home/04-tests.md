# W5-12 — tests

Coverage of the spec's test plan (`research/config-home-spec.md`, "Test plan") and the jsdom
investigation behind the one deviation.

## Coverage matrix

| Spec item | Where | Status |
|---|---|---|
| Type test: three decision-5 assertions | `data-grid.type-test.ts` (disjoint sync/root keys; exhaustive `DATA_GRID_ROOT_PROP_KEYS`; `satisfies`) | done |
| Type test: `@ts-expect-error` on `<DataGridRoot readOnly />` | `data-grid.type-test.ts` (`DataGridRootProps<Row> = { readOnly: true }`) | done |
| Type test: `@ts-expect-error` on sync prop next to `store` | `data-grid.type-test.ts` (`DataGridProviderProps<Row>` with `store` + `readOnly`) | done |
| SSR: `renderToString` shows `useDataGridReadOnly() === true` and `aria-readonly` on first render | `config-home.test.tsx` → "config home: SSR" | done |
| `readOnly` flip before passive effects flush writes nothing; open editor cancelled with `onEditEnd` `cancel` | `config-home.test.tsx` (keydown before flush) + `read-only-writes.test.tsx` (config-phase timing, session cancel via `_syncConfig`) | done |
| `useDataGridKeymap` with no root returns the merged map | `config-home.test.tsx` → "config home: keymap" | done |
| Inline keymap literal keeps `state.keymap` identity; equal props sync nothing (spies); config-only change calls `_syncConfig` not `_syncProps` | `config-home.test.tsx` → "an equal re-render syncs nothing…" | done |
| Untyped caller passing `store` + `readOnly` gets one dev warning | `config-home.test.tsx` → "config home: untyped caller" | done |
| Manual composition with `readOnly` blocks edit, delete, paste, fill, context-menu Cut | `read-only-writes.test.tsx` (edit/delete/paste writes), `fill.browser.test.tsx` + `context-menu.browser.test.tsx` (fill and Cut, provider-level `readOnly`) | done (split across suites) |
| `onCellClick` identity change re-renders no cell, next click calls the new callback | Semantic half: `config-home.test.tsx` → "config home: onCellClick". No-re-render half: browser wasted-render suites (see below) | done, with deviation |
| Browser: a11y, keybindings, context-menu, scroll-drag wasted-render suites stay green | `npx vitest run --project browser` | green (599 passed, 6 skipped) |
| Compiler: `pnpm test:compiler`, bail-out baseline unchanged | `pnpm lint` (bail-out baseline, 243 files) + `pnpm test:compiler` | green (see the two fixed test patterns below) |

## The onCellClick no-re-render assertion, and why it left the jsdom suite

Spec item: "changing `onCellClick` identity re-renders no cell … and the next click calls the new
callback." The jsdom test failed the first half: the cell re-rendered once on the identity change
with no other prop changing.

Diagnosis chain (all verified by instrumentation that was added, measured, and reverted):

1. A cell re-renders only if its props change or its context does. The cell's props were
   shallow-equal; the root's `DataGridRootContext` `contextValue` identity had changed.
2. `contextValue` is a `useMemo` over the root's render inputs. Diffing the deps across the
   re-render (instrumented dump of every dep's identity) showed exactly one changed dep:
   `windowedColumns`.
3. `windowedColumns` derives from `useColumnWindow`'s `indices` memo, whose input is the element
   store's `snapshot` (`use-scroll-snapshot.ts`). `snapshot` only gets replaced inside
   `commit()` when `snapshotsEqual` says the content changed — the scroll/scroll-end/resize/
   idle-reset machinery.
4. In jsdom that machinery is timer-driven: the mount-time velocity-estimate path arms settle
   timers, and `await new Promise(setTimeout(0))` in the test lets them fire, committing a
   snapshot change and recomputing the window. A real browser commits a snapshot only on actual
   scroll/resize — which should re-render the windowed cells (by design).
5. An earlier dead end worth recording: the "test data churns" hypothesis. Unstable row objects
   made every re-render resync the data slice and recompute the view — masked as the same
   symptom. Fixed by using stable rows and a stable `getRowId`; the count assertion then passed
   until the timer path above fired.

Conclusion: the no-re-render property cannot be asserted deterministically under jsdom — the
windowing timers are jsdom-hostile, and the machinery is pre-existing windowing code that W5-12
does not touch. The property is covered where it is real: the browser wasted-render suites
(a11y, keybindings, context-menu, scroll-drag) render through the same `contextValue` path with a
real browser's scroll behavior, and the spec's test plan keeps them green. The unit test keeps
the semantic contract — the next click calls the new callback and never the old one.

## Instrumentation hygiene

All debug instrumentation (the `__ctxDeps` dump in `root.tsx`, the column-window dep dump, the
test's render-count probe and `MutationObserver`) was reverted. `use-column-window.ts` carries
no diff against the committed tree; `root.tsx`'s diff is the W5-12 change only.

## Compiler suite: two compiler-unsound test patterns (fixed)

`pnpm test:compiler` (`unit-compiled` + `browser-compiled`) first went red with two failing
tests. Both are test-side patterns the React Compiler legitimately rejects, not grid defects:
the compiler treats closure-captured objects as stable inputs and caches derived values across
renders (verified by transforming the test wrappers with the repo's own
`reactCompilerPreset`, target 19):

- `config-home.test.tsx` (onCellClick): a no-props wrapper compiled to a sentinel cache — its
  element, with `onCellClick={flags.onCellClick}` read at first render, is computed exactly
  once per instance. A mutated `flags` object is never re-read. Fix: pass the callback as a
  tracked prop (`rerender(<Wrapper onCellClick={second} />)`).
- `row-ops.test.tsx` (reorderRows no-op while readOnly): the wrapper built its provider
  component through a factory (`makeWrapper(onDataChange, { readOnly: flags.readOnly })`).
  The opaque factory call is hoisted into a sentinel cache and runs once per instance, pinning
  the component type with `readOnly: false`. Fix: render `DataGridProvider` directly in the
  wrapper body and read `flags.readOnly` there (a direct JSX read with `children` as the
  tracked input re-evaluates on every render). The test now exercises the real config-flip
  path (layout-phase `_syncConfig`) instead of the previous accidental remount.

The grid source needed no change: the cell's click handler reads
`storeApi.getState()` inside the event body, which the compiler leaves in place (verified in
the same transform: only render-scope values are cached, event-scope reads run fresh per
event). Event-time store reads are therefore compiler-safe by placement.
