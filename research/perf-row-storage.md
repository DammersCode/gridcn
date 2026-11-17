# Row storage (chunked `data`): stage 0 record

Package D4-1, stage 0. No product code changed. Machine: Windows 11, Node 24, other lanes running, so absolute numbers carry noise; shares and ratios are what the decision rests on. Base: `stable/2.0-merge` (96380a5b).

## Measurements (100,000 rows, `scripts/bench-sort.mjs --live`, 5 runs)

| Case | ms per 1,000 ticks |
|---|---|
| live, immediate, 1000 x 1, non-sort column | 205 to 215 (range 201 to 221) |
| live, immediate, 1000 x 1, sort column | 840 (range 809 to 925) |
| live, frame, 1000 x 1, sort column | 213 |

CPU profile of the non-sort case (`--profile` now also covers `--live`):

| Share | Function |
|---|---|
| 75% | `computeCellPatchBatch` self time (the `s.data.slice()` of 100,000 references) |
| 19% | garbage collector (the 800 KB copies) |
| 4% | profiler overhead |
| under 2% | all else (`patchesLeaveViewAlone`, `updateCellsCore`, emit) |

The `data` copy and its collection are about 90% of the tick. Kill criterion "copy under 30%": **passed**. Target in the plan (173 to 60 ms/s) is reachable in principle: the rest of the tick is about 0.02 ms.

Sort-column profile (immediate): `moveRow` 22% (the view order copy), `computeCellPatchBatch` 21% (the data copy), GC 18%, number keys and radix 15%. The order copy is above the 20% gate of D4-3.

## Spike of the prototype accessor (zustand 5)

1. `setState(next, true)` keeps the prototype of `next`. Pass. A default merge `setState(partial)` copies into a fresh `{}` and loses the prototype (and the lazy `data`). The `create-store.ts` wrapper from the plan is mandatory, and every `store.setState` call site must go through it.
2. Whole-state spreads: seven non-test sites (`create-store.ts:165`, `group-actions.ts:49,51`, `dispatch-grid-action.ts:101`, `sync-props.ts:569`, the find-replace hook, `use-data-grid-import`). A spread skips a prototype accessor, so `data` would be absent. The receiving functions take `Pick<...>` types that exclude `data`, so this holds by type today. Pass, with the types as the guard.
3. Selector reads: **fail**. `Object.assign(Object.create(proto), fields)` puts the state object into dictionary mode (`%HasFastProperties` is false at 40, 100, and 150 fields). A read of an ordinary field is 40 to 70% slower (about 1.7 ns more per read, 3e7-read loop), and a `data` read through the accessor is about 3.5 times slower. `scripts/perf-interaction.mjs` needs a build and was not run.

Variant checked: an own non-enumerable accessor defined with `Object.defineProperty` on a fresh object literal stays in fast mode (`true`), but copying descriptors with `getOwnPropertyDescriptors` returns a dictionary-mode object again. A fast object needs `{ ...prev, ...partial }` (the accessor is skipped as non-enumerable) followed by one `defineProperty` per write. That shape is untested against the real store.

## Decision

Applied as written in `PLAN-D4.md`: the spike fails proof 3, so D4-1 to D4-3 stop and the arrays stay. The numbers go to `deferred-not-2.0.md`. Reopen with the own-accessor variant: measure `perf-interaction.mjs` on it first; the gain (a tick from 0.2 ms to about 0.03 ms at 100k) is large enough to justify one more spike.
