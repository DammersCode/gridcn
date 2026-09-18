# RTL support — draft design

Date: 2026-08-01 · Workplan item #65 · **DRAFT — awaiting go/no-go from the user.**

> **Status: this is a proposal, not an agreed plan.** Nothing here is implemented and nothing
> should be implemented until the user decides. The recommendation at the end is the author's
> opinion, offered for a decision.

Research backing this spec: `docs/agent-work/2026-08-01-rtl-research.md`. The key claims below
were verified by scripted browser probes against a reduced model of our scroll architecture, not
by reasoning alone.

---

## 1. Goal

Let a consumer render gridcn in a right-to-left layout (Arabic, Hebrew, Persian, Urdu) with
correct visual layout, pointer behaviour, and keyboard semantics — while keeping LTR the
zero-cost default and leaving the hot scroll path's performance contract intact.

## 2. Constraints

1. **The scroll path is hot.** `writeScrollVars` runs on every scroll tick. Any per-frame branch
   must be justified. (The recommended design adds none.)
2. **LTR must not regress**, in behaviour or performance.
3. **Registry-distributed.** Consumers copy source into their projects, so the seam must be
   comprehensible, not clever.
4. **No new runtime dependency.**

## 3. The core technical finding

Two facts, both measured in Chromium, define the whole design:

1. **CSS Grid and logical properties mirror automatically.** Track layout, `insetInlineStart`
   pinning, `place-self-end`, and grid-line-placed overlays are all correct under `dir=rtl` with
   no change.
2. **CSS `transform` is always physical.** `translate3d(-x)` moves content toward the physical
   left in both directions. Our entire scroll architecture rides on such a transform.

So the mismatch is narrow and specific: **logical layout meeting a physical transform.**

Applying today's pipeline under RTL puts a pinned column fully off-screen at x `-300..-200`
(two compounding sign errors). Signing the transform by direction and leaving the logical pin
formula untouched produces **bit-identical geometry in both directions**:

```text
LTR [{scroll:0,c0:0,c1:100,c3:300}, {scroll:250,c0:0,c1:-150,c3:50}, {scroll:700,c0:0,c1:-600,c3:-400}]
RTL [{scroll:0,c0:0,c1:100,c3:300}, {scroll:250,c0:0,c1:-150,c3:50}, {scroll:700,c0:0,c1:-600,c3:-400}]
MATCH: true
```

The fix is a CSS variable, resolved by the browser during compositing. **The per-frame JavaScript
path does not change at all** — this is what makes the perf constraint a non-issue rather than a
tradeoff to manage.

---

## 4. Approach options

### Option A — full logical conversion plus dir-aware core

Convert every remaining physical CSS usage to logical, thread direction through all coordinate
math, and make direction a first-class concept everywhere.

| Subsystem | Effort |
|---|---|
| CSS logical conversion (mostly done already) | S |
| Scroll transform signing | S |
| Pointer hit-testing | M |
| Resize / reorder / auto-scroll | M |
| Pin shadows and edge flags | S |
| Keyboard semantics | S |
| Chrome (`DirectionProvider`) | S |
| Tests and fixtures | M |

**Total: M–L.** **Risk to perf contracts: low** (the transform fix is CSS-level).
**Verdict: over-scoped.** Most of the "full conversion" is already done — the census found
physical Tailwind utilities only in `ml-auto`, `ml-1`, and demo files. Option A mostly pays for
work already complete, and encourages sprinkling direction awareness broadly, which is exactly
the MUI X failure mode the research warns about.

*Note on the shadcn codemod.* shadcn solves RTL with a build-time transformer that rewrites
physical classes to logical ones at `add` time (research §1.1). We should **not** adopt it. That
codemod exists because their source is 246-physical-to-8-logical legacy; ours is already
logical-first. Adopting it would import machinery to solve a problem we do not have. The one
thing worth borrowing is the `components.json` `"rtl"` flag as *precedent* that registry
consumers already understand a direction switch.

### Option B — `dir` prop with normalization at the coordinate seams (recommended)

Accept one governing idea: **direction is resolved at a small number of seams; everything
downstream stays direction-agnostic.** This is `react-data-grid`'s approach, and our
architecture already fits it.

**B1. Direction resolution (S).** A `direction?: 'ltr' | 'rtl'` prop on the provider, resolved
`prop ?? context ?? 'ltr'` (the Radix/diceui precedence convention — an explicit prop wins over a
provider). It must do **both** of the following, since neither substitutes for the other
(research §1.2):

- set `dir` on the grid root — drives every Tailwind `rtl:` variant and all logical CSS;
- wrap the subtree in Base UI's `DirectionProvider` — drives all Base UI JavaScript positioning
  and keyboard navigation, making **all chrome** correct in one step.

Set `dir` on the element that is simultaneously the scroll container and the CSS grid, matching
`react-data-grid`. Portaled chrome (menus, popovers, dialogs) needs explicit `dir` propagation
because of the known `tw-animate-css` bug (research §1.3).

**B2. Scroll axis normalization (S).** `Math.abs` in `writeScrollVars` so both directions share a
positive inline-start-relative axis. This reconciles the existing contradiction where
`use-column-window.ts` already normalizes but the writer feeding it is explicitly LTR-only. Also
fixes `use-scrolled-edges.ts`.

**B3. Transform signing (S).** Emit `--grid-dir: 1 | -1` once on the viewport; change the three
transforms (`body.tsx`, `header.tsx`, `pinned-row-band.tsx`) from `-1 *` to `var(--grid-dir) *`.
**No per-frame JavaScript change.** Verified by probe.

**B4. Pointer coordinate normalization (M).** One helper converting a client x into an
inline-start-relative x:

```js
inlineStartX = rtl ? (rect.right - clientX) : (clientX - rect.left)
```

Applied at `pointerToCoord`, then `columnAtX` works unchanged — including its pinned-band
reasoning, since it becomes inline-start-relative. This is the largest genuine work item and the
one needing care.

**B5. Direction-signed gestures (S–M).** Column-resize delta, drag auto-scroll edge tests and
step signs, and the reorder before/after half test. Each is a sign flip at a known line. Copy
`react-data-grid`'s resize formulation, which captures the offset at `pointerdown` and mirrors
both capture and move (research §2.2) — resize is the one unavoidable manual mirror, because
`clientX` is always physical.

**B6. Scroll-into-view (S).** Replace `scrollCellIntoView`'s absolute writes and LTR-only
`Math.max(0, …)` clamp with `tablecn`'s relative `scrollLeft += delta`. This is
convention-agnostic and is an improvement in LTR too, independent of RTL.

**B7. Pin-shadow edges and gradients (S).** Direction-aware boundary-cell selection in
`use-pin-shadow-edges.ts`; for the physically-unavoidable gradients in `root.tsx`, prefer
`react-data-grid`'s `&:dir(rtl) { transform: scaleX(-1); }` over a JS branch.

**B8. Keyboard semantics (S).** Map `ArrowLeft`/`ArrowRight` to `moveRight`/`moveLeft` under RTL
at the single existing keymap-resolution seam — key remapping, not forked index arithmetic.
`Tab`/`Shift+Tab` must **not** be flipped (already reading-order logical), and Home/End need no
change (our actions are already logically named). **Decision required — see §5.**

**B9. Cell content direction (S).** `dir="auto"` on cell content wrappers so mixed-script data
renders correctly. Valuable to LTR users with multilingual data too, so it can ship independently.

**B10. Tests (M).** See §6.

**Total: M.** **Risk to perf contracts: negligible** — no new per-frame work; the only additions
are a CSS variable and pointer-time normalization that runs on user gestures, not on frames.

### Option C — defer, document LTR-only

Keep the existing "not yet supported" callouts and revisit later.

**Effort: none.** **Risk: none technically**, but it leaves a known gap in a component whose
whole premise is being a complete Excel-like grid for the shadcn ecosystem, and RTL affects a
large user population. The two existing doc callouts already promise it "may come in a future
version".

Worth noting: option C gets *cheaper to reverse* the longer the codebase stays disciplined about
logical properties, and *more expensive* if new physical coordinate math accumulates. The census
is clean today. That argues for either doing it now or adding a lint guard to keep the door open.

---

## 5. Open decision — keyboard semantics

This needs a product call, not an engineering one, and it is the one place where references
disagree.

Under RTL, when the user presses **ArrowRight**, should the active cell move:

- **(a) visually right** — toward the *previous* column (lower index); or
- **(b) to the next column** (higher index), which is visually left?

**Recommendation: (a), visual movement.** The evidence converges:

- It matches native spreadsheet behaviour on RTL Windows/Excel.
- **Every RTL-supporting reference does this** — `react-data-grid` by remapping keys, MUI X and
  `tablecn` by flipping index arithmetic. Different implementations, identical semantics.
- Base UI's composite roving focus already behaves this way, and our chrome inherits it.
  Mixed semantics between grid and menus would be worse than either choice applied uniformly.

Implement it as **key remapping**, following `react-data-grid`, rather than forking index
arithmetic in every navigation helper (MUI X's approach, and a large part of why their RTL
surface is seventeen files). Two details from the references: **`Tab`/`Shift+Tab` must not be
flipped** — they are already reading-order logical — and Home/End need no change here, since our
actions are already logically named.

Because the keymap already names actions logically (`moveLeft`, `moveRight`, `extendLeft`,
`jumpLeft`), this is a swap at one resolution point. Consumers with custom keymaps keep working
unchanged.

---

## 6. Test strategy

The references' RTL bugs cluster at coordinate seams (research §2.3), so tests should target
seams, not screenshots.

1. **Dual-direction unit tests** for the normalization helpers — scroll axis, pointer
   normalization, resize delta sign, reorder half test. Pure functions, cheap, high value.
2. **Browser tests with `dir=rtl` fixtures** (Vitest browser mode is already in use):
   - pinned columns land at the correct inline-start/end position at several scroll offsets;
   - clicking a visible cell selects **that** cell (the highest-value test — it catches the whole
     hit-test class);
   - selection rectangles align with their cells;
   - column resize grows the column when dragged toward the inline-end;
   - arrow keys move per the §5 decision, and `Tab` still advances in reading order;
   - one portaled chrome surface (a header menu) opens on the correct side;
   - **columns narrower than the viewport** — MUI X shipped a regression test for exactly this
     after an RTL clamping bug skipped columns, and our `min(viewportWidth, contentWidth)`
     pin-right anchor makes us susceptible to the same class.
3. **Boundary tests specifically.** Probe 4 showed RTL sub-pixel rounding can resolve a point
   exactly on a shared cell edge to the neighbouring cell. Underlying geometry was identical in
   both directions, so this is a rounding artifact — but it warrants half-open interval
   discipline (`>= start && < end`) and explicit on-the-boundary cases.
4. **An LTR regression pass** — the existing suite must stay green unchanged. This is the
   guardrail for constraint #2.
5. **Perf check.** Re-run the existing scroll benchmark in LTR to confirm no regression. RTL is
   not expected to differ, since the per-frame path is shared and unbranched.

## 7. Rollout

RTL can ship **incrementally and safely**, because `dir` defaults to `ltr` and every change is
inert until a consumer opts in:

1. B1–B3 (direction plumbing, scroll axis, transform) — the grid renders and scrolls correctly.
2. B4–B6 (pointer, gestures, scroll-into-view) — interaction correct.
3. B7–B9 (shadows, keyboard, content direction) — polish and semantics.
4. Docs: replace the two "not yet supported" callouts (`content/docs/i18n.mdx`,
   `content/docs/index.mdx`) with real guidance, including the required two-switch setup from B1.

Each stage is independently testable and independently shippable.

---

## 8. Recommendation

**Adopt Option B, contingent on the user's go-ahead**, and take the §5 keyboard decision as
"visual movement" unless the user prefers otherwise.

Reasoning:

1. **The hard part is already solved and verified.** The risk everyone assumes with a
   CSS-variable scroll architecture — that RTL would force per-frame branching and threaten the
   perf contract — is measurably not the case. One CSS variable, zero JavaScript hot-path change,
   bit-identical geometry in both directions.
2. **We are already on the cheap side of the decisive architectural split.** The reference study
   shows one variable dominates RTL cost: *logical-first CSS versus physical CSS mirrored in
   JavaScript*. `react-data-grid` chose logical and needs about four direction-aware sites; MUI X
   chose physical and pays across seventeen files plus years of recurring bugs. Our registry is
   already logical-first, so Option B is mostly *connecting* an approach we have been following
   by instinct — not adopting a new one.
3. **The architecture happens to be well-suited.** Grid-line-placed overlays make selection
   rectangles correct for free, and those are among the most common and most visible RTL bugs in
   the references. Pin math is already written in logical terms, and Home/End actions are already
   logically named. This is luck worth banking.
4. **Base UI does the chrome for free**, removing roughly half the visible surface from scope —
   and it already models direction-aware grid traversal and scroll-into-view.
5. **The blast radius is enumerable** — 59 physical-coordinate occurrences across 11 files, about
   a third already correct. Option B centralizes direction at a few seams, precisely the
   discipline MUI X's bug history shows separates a bounded change from a permanent bug class.
6. **Option A pays for finished work**; Option C leaves a real gap in a product that positions
   itself as complete, and the codebase is in the cleanest state it will ever be in for this
   change.

**Two items are worth doing regardless of the RTL decision**, since each improves LTR on its own
merits: B6 (relative `scrollLeft += delta` is more robust than absolute writes) and B9
(`dir="auto"` on cell content helps any user with multilingual data). If the answer to RTL is
"not now", these two are still worth taking.

**Effort: M** (medium) overall — with pointer hit-testing (B4) as the only genuinely non-trivial
item and the one to schedule most carefully.

### Top risks

1. **Pointer hit-testing under RTL (B4)** — the one place needing real thought rather than a sign
   flip; pinned-band reasoning must be re-verified in inline-start space. *Mitigation:* the
   normalization is proven by probe; cover with the click-selects-that-cell browser test.
2. **Sub-pixel boundary rounding** — RTL fractional layout can resolve a point on a shared cell
   edge to the neighbour. *Mitigation:* half-open intervals plus explicit boundary tests.
3. **Silent partial adoption** — a later contributor adds physical `clientX`/`left` math and
   quietly breaks RTL, the failure mode visible across MUI X's issue history. *Mitigation:*
   centralize normalization in named helpers, and consider a lint rule flagging raw `scrollLeft`
   or `rect.left` outside them. This risk is the reason the recommendation is "centralize", not
   merely "convert".

Two secondary risks worth naming:

- **Portaled chrome.** `tw-animate-css` ^1.4.0 (a direct dependency) has a known bug with logical
  slide utilities, and `rtl:` variants only reach portals whose root is inside a `[dir]`
  ancestor. *Mitigation:* propagate `dir` explicitly to portal content, as shadcn's own docs
  prescribe, and cover one portaled surface in the RTL browser tests.
- **Scope creep into bidirectional text.** This spec covers RTL *layout*. Text shaping inside
  cells is the browser's job. B9 (`dir="auto"`) is the deliberate boundary: we mark content
  direction and let the browser do the rest.

---

## 9. What is NOT proposed

- No change to the scroll architecture itself.
- No per-frame JavaScript branching.
- No bidirectional text-shaping work — the browser handles text; we handle layout (B9 marks
  content direction and stops there).
- No change to the public API beyond one optional `direction` prop.
- No legacy `scrollLeft` feature detection — unnecessary on evergreen browsers, and MUI X has
  deleted its own (research §2.4).
- **No build-time codemod.** shadcn's physical-to-logical transformer solves a legacy problem we
  do not have; our registry is already logical-first (research §1.1).
- No mirroring of column order in JavaScript. Every reference that supports RTL lets the browser
  mirror via `dir`; none reverses order manually (research §2.5).

---

**Awaiting the user's go/no-go decision.** If approved, the open question in §5 should be settled
first, since it affects B7 and the test matrix.
