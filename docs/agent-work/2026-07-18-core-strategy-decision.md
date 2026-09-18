# Core strategy decision: keep the from-scratch core, do not adopt TanStack Table (2026-07-18)

Advisor decision on workplan #42's strategic question (rebuild vs build-on-TanStack), based on
the 2026-07-18 research pass. User may override; until then this is settled like the canvas
pivot (2026-07-16) and row pooling (2026-07-17) decisions.

## The facts that decide it

1. **TanStack Table provides none of gridcn's hard parts, in any version.** No virtualization
   (separate library), no rendering, no clipboard, no fill handle, no overlay painting, no
   imperative scroll. Confirmed from their own docs AND from tablecn's shipping code: a real
   TanStack-based grid still hand-built ~4,000 lines of interaction/selection/clipboard
   (use-data-grid.ts 3,643 lines + undo-redo 501) because Table only supplied sort/filter/pin
   STATE and row models.
2. **What TanStack could replace is our best-measured code.** Sort/filter/view-index was
   perf-audited as near-optimal (decorate-once sort, shared Collator, single-pass filter with
   pre-parsed matchers). Swapping it buys an adapter layer + beta churn (v9 is beta, state
   rewrite mid-flight) for edge-case coverage we don't currently need.
3. **The re-render models conflict.** v9's selling point is fine-grained React re-render
   control; our core principle is ZERO React renders on scroll via CSS-var writes. We bypass
   the problem they optimize.
4. **The "TanStack spreadsheet" sighting is unconfirmed.** v9 beta adds `cellSelectionFeature`
   — a headless range-selection STATE primitive (drag/shift/multi-range semantics), not a
   rendered spreadsheet. No official spreadsheet product exists; community add-ons do. If
   anything, their v9 direction validates our selection design (we already ship RLE
   CompactSelection + rangeStack, measured O(slices) hot paths).

## What we keep watching

- v9 `cellSelectionFeature` GA: if consumer familiarity with TanStack's selection API becomes
  an adoption factor, revisit an OPTIONAL thin interop (e.g. a spec-compat adapter), never a
  core swap.
- The strongest counter-argument on record: ecosystem familiarity lowers onboarding friction.
  Softened for us by the registry model (consumers own the source), but it is real — revisit
  if adoption data says so.

## Consequences

- The benchmark page (workplan #42 build) includes a thin "TanStack Table + react-virtual
  assembled baseline" column — labeled as what raw TanStack gives you before building the
  spreadsheet layer — which keeps this decision honest with numbers.
- Vision unchanged: Excel-like grid (ranges, clipboard, fill, editing) as first-class core,
  shadcn-registry distribution, performance via the zero-render scroll architecture.
