# Plan 009: Glide spec doc fix + store-barrel public-surface decision

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If anything
> in the "STOP conditions" section occurs, stop and report — do not improvise. When
> done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 037d895..HEAD -- research/glide-behavior-spec.md registry/default/blocks/data-grid/data-grid.tsx registry/default/blocks/data-grid/store/index.ts registry/default/blocks/data-grid/store/types.ts registry/default/blocks/data-grid/store/hooks.ts`
> If any changed, compare against the "Current state" notes; on a mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW (doc + additive exports + JSDoc tags)
- **Depends on**: none
- **Category**: docs + dx
- **Planned at**: commit `037d895`, 2026-09-03

## Why this matters

Two small findings from the 2026-09-03 audit that are one-line fixes in isolation but
compound: a spec that contradicts itself (drives future spec-conformance reviews
wrong), and a public surface that leaks six internal-ish hooks through the store
barrel without exposing them through the documented public entry.

## Current state

- `research/glide-behavior-spec.md:43,52` — line 43's NOTE mandates Excel-style
  data-boundary jumps for `primary+Arrow`; line 52 says `primary+Shift+Arrow`
  "grow to grid edge". gridcn implements data-boundary for the shift variant too
  (`keyboard/default-keymap.ts:29-32` → `jumpToDataBoundary` via
  `use-grid-interaction.ts:302`) — correct per Excel, wrong per line 52's wording.
- Store barrel vs public entry (bugs report, still-open dx item):
  `registry/default/blocks/data-grid/store/index.ts:24-39` exports six hooks the
  public entry `data-grid.tsx` does NOT re-export: `getFocusCell`,
  `useDataGridCellTypes`, `useDataGridFillHandlers`, `useDataGridActiveColumn`,
  `useDataGridOverlayPlugins`, `useDataGridRowBands`. Consumers who import the store
  barrel get them; the documented surface (data-grid.tsx + docs) does not mention
  them.
- Consumer-facing vs internal, per the audit: `useDataGridCellTypes` and
  `useDataGridActiveColumn` are legit consumer reads (cell-type lookup, active
  column for tooling); the other four are provider seams from the workplan #48
  extractions (fill handlers, overlay plugins, row bands) or internal helpers
  (`getFocusCell` — the interaction layer's focus query).
- Export pattern exemplar: `data-grid.tsx:137` (`ColumnDefOf` /
  `ClipboardProcessCtx` re-exports — the 08-02 audit fixed that exact class of gap).
- `@internal` JSDoc tag: check how the repo marks internal symbols (grep
  `@internal` in `registry/` — if the convention doesn't exist, use the tag anyway;
  it is standard TSDoc and costs nothing).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `pnpm types:check` | exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Tests (filter) | `pnpm test -- type-test` | exit 0 (the data-grid.type-test.ts file) |
| Tests (full) | `pnpm test` | exit 0 |
| Registry rebuild | `pnpm registry:build && pnpm registry:verify` | exit 0 |

## Scope

**In scope:**
- `research/glide-behavior-spec.md` (line 52 only)
- `registry/default/blocks/data-grid/data-grid.tsx` (two re-exports)
- `registry/default/blocks/data-grid/store/types.ts` or `store/hooks.ts` (whichever
  declares the four internal hooks — JSDoc `@internal` tags only)
- `content/docs/api-reference.mdx` (add the two re-exported hooks next to the other
  hook entries — find where `useDataGridActions` is documented and match its entry
  shape)

**Out of scope:**
- Removing the six exports from `store/index.ts` (additive-only plan — a consumer's
  private deep import today is a working pattern, just undocumented; removing is a
  breaking change and not warranted pre-1.0 without a consumer report)
- the keybindings/labels machinery

## Git workflow

- Branch `docs/009-surface-hygiene` or `dev`; conventional commits:
  `docs(spec): glide spec mod+shift+Arrow wording (data boundary)`,
  `feat(api): re-export useDataGridCellTypes/useDataGridActiveColumn, mark #48 seams internal`.
  No co-author trailer. Do not push.

## Steps

### Step 1: Spec fix

`research/glide-behavior-spec.md:52` — change "grow to grid edge" to "grow to the
data boundary in that direction (same Excel-style jump as primary+Arrow, line 43;
gridcn implements this)". One line, nothing else in the spec changes.

**Verify**: `git diff research/` shows exactly one line changed.

### Step 2: Re-export the two consumer-facing hooks

In `data-grid.tsx`, next to the existing re-export block at :137 (follow its exact
style): export `useDataGridCellTypes` and `useDataGridActiveColumn` (from the store
barrel or their source module — match how the neighboring exports are written).
JSDoc on both is already present at their declaration sites (verify; the repo rules
require JSDoc on every exported symbol — the re-export inherits the declaration's).

**Verify**: `pnpm types:check` → exit 0.

### Step 3: Tag the four seams internal

At the declaration sites of `getFocusCell`, `useDataGridFillHandlers`,
`useDataGridOverlayPlugins`, `useDataGridRowBands`: add `@internal` to the JSDoc,
plus one line: "provider seam from the workplan #48 extractions (or: internal focus
query) — not part of the public API; consumers should not import it."

**Verify**: `pnpm types:check` → exit 0; `pnpm lint` → exit 0.

### Step 4: Docs entry

In `content/docs/api-reference.mdx`, add `useDataGridCellTypes` and
`useDataGridActiveColumn` in the same section/shape as `useDataGridActions` (one
line each: signature + one-line description).

**Verify**: `pnpm lint` → exit 0; `git diff content/docs/` shows only the two entries.

### Step 5: Full gate

**Verify**: `pnpm test` exit 0 (the type-test file must still pass — it may assert
the public surface; if it fails because it pins the export list, ADD the two hooks to
that assertion — that is the test doing its job, not a drift);
`pnpm registry:build && pnpm registry:verify` exit 0 (the public entry changed —
the payload must carry the new exports).

## Test plan

- No new tests — the type-test file IS the surface test (extend it if it pins
  exports).
- Untouched: everything else.

## Done criteria

- [ ] `pnpm types:check` and `pnpm test` exit 0
- [ ] `pnpm registry:build && pnpm registry:verify` exit 0
- [ ] `git status` shows exactly: spec line, data-grid.tsx exports, 4 JSDoc tags, docs entries
- [ ] `plans/README.md` status row updated to DONE + commit SHA

## STOP conditions

- `useDataGridActiveColumn` or `useDataGridCellTypes` has a consumer-facing signature
  that is clearly internal (e.g. returns store-shape internals) — re-read the audit
  row; if ambiguous, tag BOTH internal instead of re-exporting, and note the
  deviation.
- The type-test file asserts an EXACT export list and the diff is larger than two
  lines (it may snapshot the whole barrel) — assess; if touching it requires
  understanding you don't have, STOP and report.

## Maintenance notes

- The #48 seam pattern repeats (overlayPlugins, rowBands, fillHandlers) — if a FIFTH
  seam appears, that is the signal to give the seams a named "provider API"
  sub-namespace instead of piling `@internal` tags; note it in the register, don't
  refactor here.
- Reviewers: additive-only was the point — if the diff shows a REMOVED export, STOP.
