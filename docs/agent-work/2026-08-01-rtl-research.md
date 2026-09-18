# RTL / LTR support research

Date: 2026-08-01 · Workplan item #65 · Research only, no implementation.

This report answers one question: **can gridcn support right-to-left (RTL) layouts, and at what
cost?** It has three parts — how the ecosystem we build on solves RTL, how the collected grid
references solve it, and a census of our own blockers.

The companion draft spec is `docs/agent-work/specs/2026-08-01-rtl-support-design.md`.

**Headline verdict: feasible, and cheaper than expected.** The architecture that looked most
at-risk (the CSS-variable scroll transform) turns out to be the part that fixes itself most
cleanly. The empirical browser probes in Part 3 confirm a single direction-signed CSS variable
makes the whole scroll and pin layer direction-correct with no per-frame JavaScript branch, so
the hot scroll path stays untouched.

---

## Part 1 — how the ecosystem we build on solves RTL

### 1.1 shadcn/ui (`references/ui`)

**shadcn/ui ships first-class RTL support — as a build-time source transformation, not runtime
CSS.** This is the single most consequential ecosystem finding, and it directly affects how we
should distribute RTL through the registry.

The mechanism: shadcn authors components in **physical LTR source**, then rewrites them to
logical properties **at `npx shadcn add` time** via a codemod, gated on a config flag.

- Transformer: `references/ui/packages/shadcn/src/utils/transformers/transform-rtl.ts`
- Gate: `components.json` → `"rtl": true` (schema default `false`)
- Migration for existing projects: `npx shadcn@latest migrate rtl [path]`

The codemod does five distinct classes of work:

1. **Physical → logical replacement** (39 ordered pairs): `pl-`→`ps-`, `mr-`→`me-`,
   `left-`→`start-`, `border-l-`→`border-s-`, `rounded-tl-`→`rounded-ss-`,
   `text-left`→`text-start`, and so on.
2. **Additive `rtl:` variants** where no logical form exists: `-translate-x-N` keeps the original
   and gains `rtl:translate-x-N`; `space-x-*` gains `rtl:space-x-reverse`.
3. **Cursor swaps** for resize affordances: `cursor-w-resize` ↔ `cursor-e-resize`.
4. **Icon flip marker** — a pseudo-class `cn-rtl-flip` that never reaches CSS; it becomes
   `rtl:rotate-180` in RTL builds and is stripped in LTR builds.
5. **`side` prop rewriting** — `side="right"` → `side="inline-end"` on menu sub-content
   components.

Critically, the transformer **skips** positioning rewrites inside physical side variants, so
`data-[side=left]:-right-1` is left alone. Physical `data-[side=left/right]` refers to real
screen sides and must not be mirrored — a distinction our own design has to respect too (§1.2).

**Evidence of how thoroughly this works.** shadcn materializes parallel `ui/` and `ui-rtl/` trees.
Counted across `.tsx` files in `base-nova`:

| | LTR source | RTL output |
|---|---|---|
| Logical utilities | 8 | **183** |
| Physical utilities | 246 | **72** |
| `rtl:` variants | 4 | **40** |

`pl-`, `pr-`, `ml-`, `mr-`, `border-l`, `rounded-r`, and `text-left` all reach exactly **zero** in
the RTL output. The residual physical classes are deliberate — protected side-variant and
keyframe cases.

Only two styles have full `ui-rtl/` coverage upstream: `base-nova` and `radix-nova`. **This repo
is on `base-nova`** (`components.json`), so we are on a supported style. Our `components.json`
already carries `"rtl": false` — the switch exists and is simply off.

Three components are documented as **not** auto-migratable and needing manual work: calendar,
pagination, sidebar.

**Conclusion for us — revised.** shadcn is *not* merely a convention source; it is real
infrastructure with a distribution model we should consciously choose to match or diverge from.
But note the asymmetry: their codemod exists because their source is 246-physical-to-8-logical
legacy. **Our registry is already logical-first** (Part 3), so we do not need the codemod — we
need only to not regress. That is a meaningfully cheaper position than shadcn's own.

### 1.2 Base UI (`@base-ui/react`, version `1.6.0`)

This is where our chrome gets RTL for free. Base UI has first-class direction support:

- **`DirectionProvider`** — exported from `@base-ui/react/direction-provider`, with a
  `direction: 'ltr' | 'rtl'` prop (note: `direction`, not Radix's `dir`).
- **`useDirection()`** — returns the bare string `'ltr' | 'rtl'`.

**Seventeen runtime modules consume the direction context**, including `useAnchorPositioning`,
`CompositeRoot`, `ScrollAreaViewport`, `ScrollAreaScrollbar`, `MenuRoot`, `SelectPopup`,
`SliderControl`, and the combobox family.

**Positioning mirrors automatically — but only for logical sides.** Base UI has six sides, and
the distinction is semantic, not cosmetic:

- `side="right"` is **never** mirrored — it stays screen-right in RTL.
- `side="inline-end"` **is** mirrored — screen-right in LTR, screen-left in RTL.
- The emitted `data-side` attribute stays in whichever vocabulary you passed in.

Since `useAnchorPositioning` is the shared foundation for all anchored popups, **Popover, Select,
Menu, Tooltip, ContextMenu, Combobox and NavigationMenu inherit this together**.

**Two findings especially relevant to a data grid:**

1. **Composite roving focus takes `direction` as a *required* parameter** (`useCompositeRoot`,
   no `?` in the type). Base UI treats direction as first-class input to arrow-key navigation, so
   Left/Right semantics invert automatically. It even ships a `CompositeGridNavigator` for
   two-dimensional grid traversal.
2. **`scrollIntoViewIfNeeded(container, element, direction, orientation)`** — Base UI already
   models direction-aware scrolling, the exact trap described in §2.4.

**Conclusion for us:** the entire chrome layer — toolbar menus, filter and sort popovers, header
dropdown, context menu, import/export dialogs — is RTL-correct as soon as a `DirectionProvider`
wraps it. That is roughly half the visible surface, for the cost of one provider. **This is the
single biggest cost saving in the whole effort.**

**Two switches are mandatory, and they are not interchangeable:** `dir="rtl"` on the document
drives all Tailwind CSS variants; `<DirectionProvider>` drives all Base UI JavaScript positioning
and keyboard navigation. React context cannot see the DOM attribute, and CSS cannot see React
context. Neither substitutes for the other.

Caveat: Base UI solves *chrome*. It does nothing for the grid canvas — scroll transforms, pinned
offsets, hit-testing, overlays. Those are ours, and they are the real work.

### 1.3 Tailwind v4 logical properties (`tailwindcss` 4.3.2 installed)

Tailwind v4 ships the full logical-utility family we need, and it is stable:

- Spacing: `ps-*`, `pe-*`, `ms-*`, `me-*`
- Positioning: `start-*`, `end-*` (aliases of `inset-s-*`/`inset-e-*`), `inset-inline-*`,
  `inset-block-*`
- Borders: `border-s-*`, `border-e-*`; radii: `rounded-s-*`, `rounded-e-*`, plus logical corners
  `rounded-ss-*`, `rounded-se-*`, `rounded-es-*`, `rounded-ee-*`
- Text/float/clear: `text-start`, `text-end`, `float-start`, `float-end`, `clear-start`,
  `clear-end`
- Scroll: `scroll-ms-*`, `scroll-me-*`, `scroll-ps-*`, `scroll-pe-*`
- Variants: `rtl:` and `ltr:`

**The `rtl:` variant is better than assumed.** Inspecting the compiled Tailwind 4.3.2 source, the
variant is a **three-way union** led by the native `:dir()` pseudo-class:

```css
&:where(:dir(rtl), [dir="rtl"], [dir="rtl"] *)
```

Three practical consequences:

1. `:dir(rtl)` inherits direction through the DOM **without** requiring an explicit attribute on
   an ancestor — so setting `dir` on `<html>` alone is sufficient for CSS.
2. The `:where()` wrapper adds **zero specificity**, so `rtl:` variants weigh the same as their
   base utility. Ordering decides, not specificity — predictable and safe to compose.
3. The `[dir="rtl"] *` branch covers **portaled content**, provided the portal root sits inside a
   `[dir]` ancestor.

**Two traps worth stating plainly.**

*Transforms are always physical.* Logical CSS mirrors automatically, but `translate3d(-50px,0,0)`
moves content toward the physical left in both directions. Our scroll architecture rides on
exactly such a transform. Part 3 proves this empirically and gives the fix.

*The residual `rtl:` surface.* Some concerns have no logical CSS equivalent and always need an
explicit variant: transforms (sign flip), `space-x-*`/`divide-x-*` (need `rtl:*-reverse`), resize
cursors, directional icons (`rtl:rotate-180`), gradients and shadows, and physical slide
animations.

That last one is on our critical path. This repo depends on **`tw-animate-css` ^1.4.0**, which
has a known bug where logical slide utilities do not work as expected. shadcn's own docs work
around it by passing `dir` explicitly to portal elements. Our chrome uses portaled surfaces
(menus, popovers, dialogs), so this needs handling rather than assuming inheritance.

---

## Part 2 — how the grid references handle RTL

### 2.1 Per-reference verdicts

| Reference | Verdict | How |
|---|---|---|
| `react-data-grid` | **SUPPORTS** (cleanest model) | `direction` prop; `dir` on the container; logical CSS throughout; `Math.abs` on `scrollLeft`; arrow keys remapped at one seam |
| `mui-x` | **SUPPORTS** (most mature, most costly) | `useRtl()`; physical styles mirrored in JS via `rtlFlipSide`; signed scroll normalized at point of use |
| `tablecn` | **SUPPORTS** (closest stack to ours) | `DirectionProvider`; manual `left`/`right` swap over TanStack's physical pinning API |
| `virtual` (TanStack Virtual) | **PARTIAL** | Sign-flips `scrollLeft` via an `isRtl` option; nothing else |
| `diceui` | **PARTIAL** | Clean `useDirection` primitive; no grid RTL logic |
| `table` (TanStack Table) | **N/A** | Headless — correctly has no direction concept |
| `react-datasheet-grid` | **NONE** | Hard-locks `direction: ltr` in CSS |
| `glide-data-grid` | **PARTIAL** | Canvas; hard-locks layout to LTR, but does per-cell **bidi text** detection |

The two that matter most are `react-data-grid` (closest architecture: DOM rows plus sticky
columns) and `mui-x` (most complete, and most instructive as a warning). `tablecn` deserves
attention as the closest match to our actual stack.

### 2.2 What `react-data-grid` does — the closest analogue and the model to copy

Their entire RTL strategy is: **set `dir` on the scroll container, use logical properties
everywhere, and `Math.abs()` the `scrollLeft`.** There is no manual mirroring math anywhere. This
gives them the smallest RTL surface area of any reference — roughly four direction-aware sites,
against MUI's seventeen files.

1. A **`direction` prop**, defaulting to `'ltr'`, flowing by **prop drilling, not context**.
2. It sets `dir` on the element that is *simultaneously* the `overflow: auto` scroller and the
   CSS grid. The browser does the mirroring.
3. Frozen column offsets are accumulated in **logical inline space**, emitted as CSS custom
   properties, and consumed via `insetInlineStart`. **Zero RTL branches**:

```js
   insetInlineStart: column.frozen ? `var(--rdg-frozen-left-${column.idx})` : undefined
```

4. `scrollLeft` normalized at **one** boundary:

```js
   // scrollLeft is negative when direction is rtl
   const scrollLeft = abs(el.scrollLeft);
```

5. Arrow keys **remapped once**, rather than forking index arithmetic:

```js
   return {
     leftKey:  isRtl ? 'ArrowRight' : 'ArrowLeft',
     rightKey: isRtl ? 'ArrowLeft'  : 'ArrowRight'
   };
```

Three further details worth importing:

- **`Tab` is deliberately not flipped** — it is already reading-order logical.
- **Column reorder uses key-based HTML5 drag-and-drop**, not coordinates, so RTL is free. Our
  reorder is already element-based (`elementFromPoint`), so we inherit the same benefit.
- **Column resize is the one unavoidable manual mirror**, because `clientX` is always physical:

```js
  resizingOffsetRef.current = isRtl ? event.clientX - left : right - event.clientX;
  let newWidth = isRtl ? right + offset - event.clientX : event.clientX + offset - left;
```

They also solve the physically-unavoidable shadow gradient with `&:dir(rtl) { transform: scaleX(-1); }`
rather than a JS branch, and toggle shadow visibility with **CSS scroll-state container queries**
(`scroll-state(scrollable: inline-start)`) — declarative and RTL-correct with no scroll listener.
Baseline is recent (Chrome 133+), so it would need an `@supports` gate, but it is worth noting as
a future simplification of our own `use-scrolled-edges.ts`.

The key design lesson is point 5 generalized: **resolve direction at a single seam, keep
everything downstream direction-agnostic.** Our keyboard layer already has this shape.

### 2.3 What MUI X does — and what it cost them

MUI X is the most complete RTL grid implementation available, and it is instructive mostly as a
warning about **scope creep**. Direction awareness reaches into pinned columns, virtualization,
keyboard navigation, column resize, column reorder, and scroll restoration. Their issue tracker
shows RTL bugs recurring for years in exactly the places you would predict:

- pinned columns mis-positioned or mirrored on the wrong side
- selection rectangles offset from the cells they should cover
- resize handles on the wrong edge, or dragging the wrong way
- horizontal scroll jumping on first render
- fill/drag operations extending the wrong direction

The **root cause** is architectural, and it is the crux of this whole report. MUI authors CSS
**physically** and machine-flips it with `stylis-plugin-rtl`. Because the styles are physical,
every consumer of them must be direction-aware in JS. Their central primitive is:

```js
// rtlFlipSide: maps a logical pin position to a physical CSS side
if (position === PinnedColumnPosition.LEFT) return isRtl ? 'right' : 'left';
```

That one decision cascades: `attachPinnedStyle`, `getPinnedWidthProperty`,
`findLeftPinnedCellsAfterCol`, `bufferForDirection`, and flipped index arithmetic in every
navigation helper. `react-data-grid` writes `insetInlineStart` once and needs **none** of it.

They also demonstrate the failure mode of normalizing more than once. In their scroll-shadow
code they call `Math.abs()` and *then still branch on `isRtl`*:

```js
const scroll = Math.abs(Math.round(scrollPosition));
const scrollIsNotAtStart = isRtl ? scroll < maxScroll : scroll > 0;
```

After `Math.abs`, `scroll > 0` already means "not at inline-start" in both directions. The extra
branch is redundant at best. **Normalize exactly once, at the boundary, then never re-branch.**

**The lesson we take:** these failures cluster at a small number of *coordinate seams* where
physical pixels meet logical layout. Centralize and test those seams and the bug class largely
disappears; sprinkle direction awareness across the codebase — how MUI X grew — and the bugs
recur for years. Our design must centralize, and must stay logical-first in CSS so there is less
to centralize in the first place.

### 2.3b `tablecn` — our own stack, and a technique worth stealing

`tablecn` is TanStack Table + TanStack Virtual + shadcn, i.e. essentially our stack, and it
implements RTL end-to-end. It mirrors manually (`left: isRtl ? rightPosition : leftPosition`)
where `insetInlineStart`/`insetInlineEnd` would have needed no branch at all — a concrete
simplification available to us.

But its scroll-into-view is genuinely better than absolute scroll math. It works in **viewport
coordinates** and applies a **relative delta**:

```js
container.scrollLeft += scrollDelta;   // sign-agnostic
```

A relative `+=` is correct under *every* historical scroll convention, which makes it the most
robust available technique for "scroll cell into view". Our `scrollCellIntoView` currently writes
absolute `scrollLeft` values, so this is a directly applicable improvement.

### 2.3c `glide-data-grid` — one finding that outlives the canvas verdict

Glide hard-locks layout to `direction: ltr`, so its layout approach is irrelevant to us. But it
hand-rolls a first-strong-character regex to detect **per-cell text direction**, and aligns and
sets `ctx.direction` per cell accordingly.

The transferable insight: **cell content direction is a separate axis from grid layout
direction.** An Arabic name in an LTR grid should still render right-to-left internally. Being
DOM-based we get this natively via `dir="auto"` on cell content wrappers — something glide had to
implement by hand and we get almost free. Worth an explicit note in the spec so it is not
forgotten.

### 2.4 The `scrollLeft` normalization trap

This deserves its own section, because it is the single most-cited source of RTL grid bugs and
the reason several libraries carry legacy complexity.

**The history.** Browsers historically disagreed on what `scrollLeft` means in an RTL container:

| Model | Inline-start value | Scrolling toward inline-end | Used by |
|---|---|---|---|
| `negative` (spec) | `0` | goes negative to `-max` | Firefox, modern Chrome/Edge/Safari |
| `reverse` | `max` | decreases to `0` | old IE, old Edge |
| `default`/positive | `0` | increases to `max` | old WebKit |

Libraries written during that era carry feature-detection helpers — MUI historically shipped
`detectScrollType()` and `getNormalizedScrollLeft()` to paper over the three models.

**The current state, which is what matters for a 2026 greenfield decision.** All evergreen
browsers now implement the spec `negative` model. `scrollLeft` is `0` at the inline-start edge
and becomes **negative** as the user scrolls toward the inline-end. The three-way detection
dance is **legacy** and we do not need to reproduce it.

This was confirmed directly rather than taken on faith. The Part 3 probe measured, in Chromium:

```text
dir=ltr : scrollLeft 0 → 700   (max = +700)
dir=rtl : scrollLeft 0 → -700  (min = -700)
```

**The decisive evidence: MUI X has deleted its own detection utility.** Searching their packages
for `detectScrollType`, `getNormalizedScrollLeft`, or `scrollType` returns **zero matches**. The
helper that classified `'negative' | 'reverse' | 'default'` by probing a throwaway `<div dir="rtl">`
is gone. MUI now assumes the negative-scrollLeft spec unconditionally.

This is the strongest single signal in the study: the **most conservative, most
enterprise-compatible** grid in the set has dropped browser-quirk detection entirely. We are a
2026 greenfield project and can do the same with more confidence than they had.

**Normalization strategies observed, ranked:**

| Technique | Used by | Assessment |
|---|---|---|
| `Math.abs()` at one read boundary | react-data-grid, MUI X | **Best.** Correct under both the modern spec *and* legacy positive-WebKit |
| Relative `scrollLeft += delta` | tablecn | **Best for scroll-into-view.** Convention-agnostic |
| `scrollLeft * (isRtl ? -1 : 1)` | TanStack Virtual | Correct only under the modern spec; silently wrong under legacy WebKit |
| `Math.abs()` *then* re-branch on `isRtl` | MUI X shadows | Redundant; a bug smell to avoid |

**Consequence for us:** normalization is one operation — `Math.abs(scrollLeft)` — putting both
directions on a single positive inline-start-relative axis that all existing math already
assumes. `Math.abs` is strictly better than the sign-multiply because it degrades gracefully. No
feature detection, no probe element, no browser matrix.

Notably, our `use-column-window.ts` **already does exactly this** (Part 3), with a comment citing
the adazzle/`react-data-grid` approach. Part of the work is done and simply not yet connected.

### 2.5 A negative result worth recording

**No reference keeps the scroll container LTR while manually reversing column order to simulate
RTL.** Every library that supports RTL sets `dir` on the container and lets the browser mirror;
the two that decline to support it (`glide-data-grid`, `react-datasheet-grid`) hard-lock
`direction: ltr` as an explicit opt-out.

The industry consensus is unanimous: **let the browser mirror.** That is also what our Probe 1
result (CSS Grid mirroring for free) makes cheapest for us.

---

## Part 3 — our blocker census

Read-only audit over `registry/default/blocks/`. Findings are ordered by severity, and the
critical claims are backed by browser probes rather than reasoning alone.

### 3.0 Empirical findings (Chromium, scripted probes)

Because the whole feasibility question rests on how the scroll transform behaves under `dir=rtl`,
this was measured rather than assumed. Four probes were run against a reduced model of our
scroll architecture (sticky viewport, absolutely-positioned grid canvas, `translate3d` driven by
a CSS variable, a pinned column using our `pinnedInsetStyle` formula).

**Probe 1 — scroll semantics and grid mirroring.**

- RTL `scrollLeft` runs `0 → -700`, confirming the spec `negative` model (§2.4).
- **CSS Grid mirrors automatically.** Column 0 renders at the inline-start (visually right) edge
  with no change to the template. Track layout costs us nothing.
- **`translate3d` does not mirror.** A negative X moves content toward the physical left in both
  directions. This is the core blocker.

**Probe 2 — the compound failure.** Applying our current pipeline (`Math.abs` normalization plus
the existing `-1 *` transform) under RTL puts a pinned column at screen x `-300..-200` — fully
off-screen. Two sign errors compound: the canvas transform moves the wrong way, and
`inset-inline-start` on the pinned cell now resolves right-to-left while the transform is still
physical.

**Probe 3 — the fix, verified.** Signing the transform by direction — `translate3d(calc(var(--grid-dir) * var(--grid-scroll-left)))`
with `--grid-dir: -1` in LTR and `1` in RTL — while leaving `pinnedInsetStyle`'s logical formula
completely unchanged, produces **bit-identical geometry** in both directions when measured in
inline-start-relative space:

```text
LTR [{scroll:0,c0:0,c1:100,c3:300}, {scroll:250,c0:0,c1:-150,c3:50}, {scroll:700,c0:0,c1:-600,c3:-400}]
RTL [{scroll:0,c0:0,c1:100,c3:300}, {scroll:250,c0:0,c1:-150,c3:50}, {scroll:700,c0:0,c1:-600,c3:-400}]
MATCH: true
```

This is the most important result in the report. **The fix is one CSS variable.** Because the
sign lives in a variable the browser resolves during compositing, the per-frame JavaScript path
is completely unchanged — no branch, no extra write, no measurable cost. The perf contract on
the hot scroll path is safe.

**Probe 4 — hit-test normalization.** Normalizing pointer coordinates with
`inlineStartX = rtl ? (rect.right - clientX) : (clientX - rect.left)` makes the existing
`columnAtX` math produce correct results under RTL. Sampling across the viewport matched the
element actually under the pointer, **except exactly on a shared cell boundary**, where RTL
sub-pixel rounding resolved to the neighbouring cell. Direct measurement showed the underlying
geometry is identical in both directions (c4 = 150–250, c5 = 250–350), so this is a rounding
artifact at the seam, not a formula error. It is a real risk though, and argues for half-open
interval discipline (`>= start && < end`) plus explicit boundary tests.

### 3.1 Blockers by subsystem

**A. Scroll transform — the central blocker (now solved).**

- `windowing/use-scroll-snapshot.ts:78` — `writeScrollVars` deliberately does a *signed* clamp
  and carries the comment *"engine is LTR-only for now"*. Under RTL, `scrollLeft` is negative,
  so this clamps every position to `0` and horizontal scrolling dies outright.
- `body.tsx:191` and `header.tsx:115` — `translate3d(calc(-1 * var(--grid-scroll-left)))`.
  Hard-coded physical sign.
- `data-grid-pinned-rows/pinned-row-band.tsx:51` — same transform, same fix.

Fix: `Math.abs` in the writer, `--grid-dir` in the three transforms. Verified by Probe 3.

**B. An existing inconsistency worth flagging.** `windowing/use-column-window.ts:93-95` **already**
normalizes with `Math.abs(snapshot.scrollLeft)` and documents it as RTL handling, with a passing
test at `use-column-window.test.ts:275`. So the column-windowing layer is already RTL-ready while
the var writer that feeds the same axis is explicitly LTR-only. These two contradict each other
today. Nothing is broken — RTL simply never runs — but it confirms RTL was anticipated, and it
means one of the trickier pieces is already done.

**C. Pointer hit-testing — the largest genuine work item.**
`interaction/use-grid-interaction.ts`, `pointerToCoord` (~line 130) and `columnAtX` (~line 77):

```js
const screenX = clientX - rect.left;
const contentX = screenX + scrollElement.scrollLeft;
```

Both lines are physically LTR. `columnAtX` additionally reasons about pinned-left and
pinned-right bands in physical screen space. This is the one place needing real thought rather
than a sign flip — but it is a *single function pair*, and Probe 4 shows the normalization that
makes the existing math work unchanged.

**D. Column resize — a genuine direction bug.**
`columns/use-column-resize.ts:73` — `clamp(drag.startWidth + (e.clientX - drag.startX))`. The
handle is already correctly placed via the logical `end-0` class (`header-cell.tsx:155`), so
under RTL it sits at the inline-end (visually left) edge, and dragging left must *grow* the
column. The delta needs a direction sign. Small fix, but silently wrong without it.

**E. Auto-scroll during drag.** `use-grid-interaction.ts:384-385` and
`data-grid-fill/use-fill-handle.ts:165-166` compare `clientX` against `rect.left`/`rect.right`
and add or subtract a fixed step. Both the edge test and the step sign need direction awareness.

**F. Edge-shadow gradients.** `root.tsx:463,475` use physical `linear-gradient(to right, …)` /
`(to left, …)`. The elements they sit on already use logical `insetInlineStart`/`insetInlineEnd`,
so under RTL the shadows would be positioned correctly but *fade the wrong way*. Cosmetic, easy.

**G. Scrolled-edge flags.** `windowing/use-scrolled-edges.ts:33-35` compares
`scrollLeft > EDGE_EPSILON` and `scrollLeft < maxLeft - EDGE_EPSILON`. With negative RTL values
both tests misfire. Fixed by the same `Math.abs` normalization.

**H. Pin-shadow measurement.** `windowing/use-pin-shadow-edges.ts:31,35` plus the `lastByRight`
/ `firstByLeft` helpers pick boundary cells by physical `getBoundingClientRect()` edges. Under
RTL the "last pinned-left" cell is the one with the smallest `left`, not the largest `right`, so
the selection inverts. Needs direction-aware comparison.

**I. Reorder drop-half.** `header.tsx:46` —
`clientX - rect.left < rect.width / 2 ? "before" : "after"`. Under RTL the halves invert. The
rest of the reorder machinery is element-based (`elementFromPoint` plus `closest`) and therefore
already direction-agnostic — only this one comparison needs the sign.

### 3.2 What already works — the good news

A large share of the grid needs **no change at all**, which is why the estimate is moderate
rather than large:

- **Overlays** (`overlays.tsx`) place purely by **grid line** (`gridColumnStart`/`gridColumnEnd`),
  never by pixel x. Since CSS Grid mirrors automatically (Probe 1), selection rectangles, column
  and row bands, and the active-cell ring are correct under RTL **for free**. Given that
  misaligned selection rectangles are one of the most common RTL grid bugs in the references
  (§2.3), this is a significant architectural win that fell out of an unrelated design choice.
- **`splitRectByPinZones` / `clampRectToWindow`** operate in data-index space, not pixels — no
  coordinate assumptions to fix.
- **Pin offset math** (`columns/pin-offsets.ts`) is already documented and written in *logical*
  terms ("inset-inline-start offsets", "inset-inline-end offsets").
- **`pinnedInsetStyle`** already uses `insetInlineStart`. Probe 3 confirmed the formula needs
  **no change** once the transform is signed.
- **Fill direction** (`data-grid-fill/fill-direction.ts`) is pure data-space column-index
  comparison — direction-agnostic.
- **Fill handle corner** uses the logical `place-self-end`, so it mirrors to the correct corner
  automatically.
- **Row markers** (`rows/marker-cell.tsx:35`, `marker-header.tsx:36`) already use
  `insetInlineStart`.
- **Keyboard** has a clean action layer — `moveLeft`/`moveRight`/`extendLeft`/`jumpLeft` in
  `keyboard/default-keymap.ts` — so direction can be resolved at one seam, exactly as
  `react-data-grid` does (§2.2), instead of touching handlers.

### 3.2b Additional items surfaced by the reference study

Three items the initial census did not cover, each cheap but easy to forget:

1. **`scrollCellIntoView` writes absolute `scrollLeft`** (`use-grid-interaction.ts`, ~line 173:
   `scrollElement.scrollLeft = Math.max(0, nextScrollLeft)`). The `Math.max(0, …)` clamp is
   LTR-only and would pin RTL scrolling to zero. `tablecn`'s relative `scrollLeft += delta`
   (§2.3b) is both the fix and an improvement, since it is convention-agnostic.
2. **Home/End semantics — already correct.** Both `tablecn` and `react-data-grid` must flip which
   column Home/End targets under RTL. We do **not**: our actions are already named logically
   (`moveRowStart`/`moveRowEnd`, `moveFirstCell`/`moveLastCell` in `keyboard/default-keymap.ts`),
   and "row start" means the first column in either direction. Worth an explicit test, but no
   code change. This is a good illustration of why logical *naming* — not just logical CSS —
   keeps RTL cost down.
3. **Cell content direction is a separate axis** (§2.3c). Consider `dir="auto"` on cell content
   wrappers so mixed-script data renders correctly regardless of grid direction. Cheap, and
   valuable even to LTR users with multilingual data.

### 3.3 Physical-vs-logical CSS census

**Tailwind utilities in `registry/`:** the codebase is already overwhelmingly logical. Physical
utilities appear only as `ml-auto` (`header-cell.tsx:142`), `ml-1` (`columns/sort-indicator.tsx:24`),
and a handful in `examples/` demo files — none in load-bearing layout. Logical usage is
established and idiomatic throughout: `end-0`, `inset-inline-start-0`, `inset-block-start-0`,
`ms-1`, `ps-7`, `insetInlineStart`, `insetInlineEnd`.

**JavaScript-side physical coordinates** (`scrollLeft`, `clientX`, `rect.left`/`rect.right`,
`getBoundingClientRect().left/right`), excluding tests:

**59 occurrences across exactly 11 source files.**

| File | Count |
|---|---|
| `interaction/use-grid-interaction.ts` | 14 |
| `windowing/use-scroll-snapshot.ts` | 9 |
| `windowing/use-column-window.ts` | 7 (already RTL-normalized) |
| `data-grid-fill/use-fill-handle.ts` | 6 |
| `columns/use-column-reorder.ts` | 5 |
| `header.tsx` | 4 |
| `windowing/use-pin-shadow-edges.ts` | 4 |
| `columns/pinned-inset-style.ts` | 4 (already logical) |
| `windowing/use-scrolled-edges.ts` | 3 |
| `columns/use-column-resize.ts` | 2 |
| `overlays.tsx` | 1 |

This is the whole blast radius, and it is enumerable. Roughly a third of these are already
correct or already logical. The concentration in `use-grid-interaction.ts` is expected — it owns
pointer-to-cell mapping — and confirms the work is *centralized rather than diffuse*, which is
precisely the opposite of the MUI X failure mode described in §2.3.

### 3.4 Current documented stance

Two docs already promise this may arrive later, so shipping RTL would fulfil an existing
commitment rather than expand scope:

- `content/docs/i18n.mdx:13` — *"Labels-only i18n — RTL not yet supported"*, noting layout is
  LTR-only for now.
- `content/docs/index.mdx:53` — *"RTL languages are not yet supported. A future version can add
  this."*

---

## Summary of findings

1. **Feasible.** No architectural rewrite is required. The scroll architecture that looked most
   at-risk is fixed by one direction-signed CSS variable, verified by browser probe.
2. **No perf cost on the hot path.** The sign lives in a CSS variable resolved during
   compositing, so the per-frame JavaScript path is unchanged — no branch, no extra write.
3. **Chrome is nearly free.** Base UI's `DirectionProvider` gives correct RTL behaviour to every
   menu, popover, and dialog for the cost of one provider — and it models direction-aware grid
   traversal and scroll-into-view already.
4. **Overlays are already correct.** Grid-line placement means selection rectangles — a
   notorious RTL bug source in the references — mirror automatically.
5. **The work is centralized.** 59 physical-coordinate occurrences across 11 files, concentrated
   in pointer hit-testing. Enumerable and testable, not diffuse.
6. **Partly started already.** Column windowing normalizes RTL scroll today and has a passing
   test; the var writer that feeds it is explicitly LTR-only. The two contradict each other, and
   reconciling them is part of the fix.
7. **Main genuine work:** pointer hit-testing (`pointerToCoord` / `columnAtX`), column-resize
   delta sign, drag auto-scroll, `scrollCellIntoView`'s LTR-only clamp, pin-shadow edge
   selection, and the reorder drop-half test.
8. **Known trap avoided.** Legacy three-model `scrollLeft` detection is unnecessary in 2026 —
   MUI X has deleted its own detection utility. `Math.abs` suffices, confirmed by measurement.
9. **We are architecturally closer to the good example than the bad one.** The decisive variable
   across references is *logical-first CSS versus physical CSS mirrored in JS*.
   `react-data-grid` chose logical and needs ~4 direction-aware sites; MUI X chose physical and
   pays for it across 17 files and years of recurring bugs. **Our registry is already
   logical-first**, so we inherit the cheap path by default.
10. **One ecosystem risk to plan around:** `tw-animate-css` ^1.4.0 (a direct dependency) has a
    known bug with logical slide utilities, so portaled chrome needs explicit `dir` propagation.
