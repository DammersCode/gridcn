# WebGPU hero shader — docs landing page (workplan #21)

> **Amended 2026-07-17 (workplan #25):** after seeing cf4a435 live, the user judged the WebGPU
> rendition "not even close" to the approved mockup and lifted the WebGPU requirement — fidelity
> to the artifact's F study now outranks the tech choice. The implementation is a faithful
> Canvas-2D port of the mockup sketch (value text + skeletons render natively there), as a
> full-page fixed background rather than a hero-block layer. The architecture sections below
> describe the superseded WebGPU path; the behavior/interaction/guardrail sections still bind.

## What it is

An interactive, always-scrolling "living grid" rendered behind (or above) the docs landing hero.
It dramatizes the library's own mechanics — virtualized render windows, presence collaborators,
lazy skeleton→value resolution, velocity overscan — as ambient motion themed to the paper docs
look. Direction locked with the user through four mockup rounds (final = variant **F** + **H**'s
scan band); the grayscale mockups live only as design artifacts, this spec is the build contract.

## The picked behaviour (variant F + H)

A field of grid cells drifts upward on its own. Each cell is either a **value** (a short mono
number) or a **skeleton** (a rounded bar), decided by which render windows currently cover it:

- **User scan band** — a full-width horizontal band that follows the pointer's Y, eases back to
  mid-frame when the pointer leaves, and **stretches with scroll velocity** (overscan): fast to
  expand, slow to settle. Rows inside are fully inked across all columns; rows at the edges fade
  to skeletons.
- **Ghost column windows** — three simulated collaborators (Ada, Kim, Rio) each carry a smaller
  window scoped to a few columns, drifting on their own sine paths, plus a **row-anchored
  selection rectangle** that travels with the sheet content. Dashed borders distinguish them.
- Cells outside every window are blank paper (grid lines only).

### Interaction (all required by the user)

| Input | Behaviour |
|---|---|
| Idle | Sheet auto-scrolls upward at a slow constant drift; ghosts animate; scan band rests mid-frame. |
| Hover | Auto-scroll eases to a stop (decelerate, not hard-cut). Scan band follows pointer Y. |
| Pointer leave | Drift eases back up; scan band glides back to mid-frame. |
| Drag (pointerdown + move) | Sheet follows the hand 1:1 vertically; cursor → grabbing. |
| Flick + release | Momentum continues the scroll, decays back into the idle drift. |
| Fast scroll (drag or momentum) | Scan band height grows with `abs(velocity)`, shrinks back on settle. |

## Architecture

### Rendering: WebGPU with a graceful ladder

WebGPU is not universal (Safari shipped it 2024, older browsers/Linux configs lack it). Ladder:

1. **WebGPU** (`navigator.gpu.requestAdapter()` succeeds) — full effect, cells rasterized in a
   fragment shader over a single fullscreen quad; window math + cell hashing done in WGSL, driven
   by a small uniform buffer (scrollOffset, pointer x/y, bandHalf, time, 3× ghost {c0,c1,cy,selRow,selW}).
2. **No WebGPU** — a static, non-animated CSS/SVG rendition of one representative frame (grid lines
   + a scatter of skeleton bars + a hint of the scan band), so the hero never looks broken. No
   Canvas-2D animated fallback — not worth the second code path for a decorative element.
3. `prefers-reduced-motion: reduce` — render the WebGPU path but hold time constant (single frame,
   no drift, no rAF loop); pointer still moves the band so it stays interactive but never
   self-animates.

Rationale: the mockups proved the effect in Canvas-2D, but the real hero targets WebGPU per the
user ask, and a fragment-shader implementation is where the per-cell math (thousands of cells,
60fps) belongs — it is exactly the kind of workload WebGPU exists for and keeps the main thread free.

### Component shape

- New `components/hero-shader.tsx` — a `"use client"` component. Owns the canvas, the device/context
  init (async, in an effect with cleanup), the uniform state (mutated imperatively in the rAF loop,
  **not** React state — zero React renders per frame, matching the grid's own scroll discipline),
  and all pointer handlers.
- WGSL kept inline as a template string in the same file (one decorative shader; a separate `.wgsl`
  asset + loader is over-engineering for this).
- Mounted in `app/(home)/page.tsx` as a positioned layer in the hero block. It sits **behind** the
  headline/buttons with a low opacity and a paper-colored mask/fade at the edges so text stays
  legible; `pointer-events` enabled only on the canvas region below the CTA row so it doesn't eat
  button clicks. Exact placement (full-bleed background vs. a framed panel under the fold) decided
  by the builder against the live paper theme — must not fight the hero text contrast.

### Theme integration

Colors come from the live CSS tokens, never hardcoded — read `--foreground`/`--background`/
`--border` (and the paper warm tint) off `getComputedStyle(document.documentElement)` at init and
on theme change (MutationObserver on `data-theme` + `prefers-color-scheme` listener), push them
into the uniform buffer as vec3s. This is what makes it flip cleanly between the paper light and
warm-charcoal dark themes and stay coherent with the #5 docs theme.

### Performance guardrails

- rAF loop **paused when off-screen** (IntersectionObserver) and when the tab is hidden
  (`visibilitychange`) — a background hero must cost nothing when unseen. This protects docs INP.
- Single fullscreen quad, one draw call per frame; all per-cell work in the fragment shader.
- No allocations in the frame loop; uniforms written into a reused `Float32Array` + one
  `queue.writeBuffer`.
- Device-loss handler (`device.lost`) → tear down and fall back to the static frame rather than throw.
- SSR-safe: all `navigator.gpu` / canvas access guarded behind the client effect; server renders
  the static fallback markup.

## Scope

- **In:** the hero shader component, its WGSL, the static fallback, mounting + masking on the home
  page, theme-token wiring, reduced-motion + off-screen + device-loss handling.
- **Out (this lane):** the docs-site chrome (owned by #5, shipped), the actual grid (`registry/`,
  untouched — this is docs-site-only decoration), any real data/multiplayer transport (it's
  simulated), and a WebGL2 fallback (static frame is the only fallback).

## Acceptance

- Renders and animates on a WebGPU browser; both themes coherent; text stays legible over it.
- Hover pauses drift; drag scrolls with momentum; scan band follows pointer Y and stretches with
  velocity; ghost windows + row-anchored selections animate.
- Zero React re-renders during animation (verify: no state setter in the loop).
- Loop pauses off-screen and on hidden tab.
- No-WebGPU browsers get the static frame, not a blank/broken hero.
- `prefers-reduced-motion` holds a static frame.
- Gates green: `tsc`, unit, browser, `verify-registry` (must stay green — registry untouched).
