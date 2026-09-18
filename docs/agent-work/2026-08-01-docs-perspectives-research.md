# Docs multi-perspective research (workplan #64)

Five reviewer personas read all 23 docs pages independently (2026-08-01, post-STE pass
4866b24, post-restructure af490a2): a React beginner with zero shadcn experience, a mid-level
integrator wiring server data, a senior doing perf due-diligence, a B1-English reader
verifying the STE pass, and a skeptical tech lead comparing against MUI X / AG Grid.

## Verdicts

| Persona | Verdict |
|---|---|
| React beginner | Works WITH FRICTION — blocks on the unexplained shadcn-init prerequisite |
| Mid-level integrator | Core gap: the server round-trip recipe does not exist |
| Senior / perf | CONDITIONAL YES — docs are honest; gaps are "go deeper", not "wrong" |
| B1 reader | 15/23 pages pass STE; the dense API/architecture pages fail |
| Skeptical tech lead | NEED MORE INFO — engineering substance strong, maturity signals absent |

## Convergent themes (multiple personas hit the same wall)

1. **No trust/status surface.** Version, semver/breaking-change policy, changelog link,
   browser matrix, a11y conformance statement, test-coverage signal — none surfaced in docs.
   The regression suite (a real trust asset) is buried on the performance page. (skeptic 1-4,
   7, 14; senior 3, 15)
2. **The central production recipe is missing.** Fetch → grid → edit → `change.ops` →
   mutation (optimistic vs refetch, rollback) has no worked example; the literal `DataOp`
   shape is never shown in code anywhere. TanStack Query and react-hook-form dialog editing
   recipes also absent. (mid-level 1-3, 12)
3. **Beginner on-ramp assumes shadcn.** `shadcn init` prerequisite unexplained and unlinked;
   `components.json` edited before its provenance is stated; no troubleshooting page;
   installation's Verify step forward-references quick-start content. (beginner 1, 2, 12, 13)
4. **Dense pages failed the STE bar.** api-reference (the TValidate paragraph is unreadable
   at B1), custom-cell-types, events-state, virtualization, multiplayer-presence,
   styling-theming, columns, pinned-rows, fill-handle. One actionable-instruction bug:
   fill-handle says "hold the modifier" and never names the key. (B1 1-20)
5. **Terms never defined centrally.** "controlled/uncontrolled" (canonical definition exists
   only as a mid-page table), "registry", "barrel", "state" (React vs grid), `getRowId`
   contract, `as const` idiom in quick-start. Define once, link everywhere. (beginner 3-8,
   14; B1 15-16; mid-level 7, 10)
6. **Silence where an explicit "not supported" belongs.** Tree data, master-detail, pivot,
   column spanning, JSON/PDF export, column-layout URL sync — silence reads as oversight;
   competitors hand evaluators the checklist. (skeptic 5, 6, 8; mid-level 13)
7. **Extension surface under-documented.** `OverlayPluginCtx` fields never enumerated; no
   "build your own overlay plugin" guide despite two first-party consumers. (senior 4)
8. **Numbers missing where claims live.** performance.mdx defers methodology to the README;
   no memory figures (100k/1M rows), no column-count guidance, no per-add-on bundle sizes.
   (senior 3, 6, 15)
9. **The registry model's maintenance question is unanswered.** "You own the code" pitched as
   pure positive; no "how do I pull an upstream fix" section (shadcn diff workflow).
   (skeptic 13)
10. **First-party seam gap disclosed but unresolved:** pagination + url-state composition is
    DIY; async validation skipped on bulk paths is disclosed in one page but undercuts the
    clipboard pitch and belongs on the Introduction/clipboard as a known limitation too.
    (skeptic 10, 11; mid-level 4, 5)

## Positive signals worth keeping (do not regress)

Honest scope-cut callouts everywhere (lazy-loading degradation story is the model);
CHANGELOG↔docs consistency verified across all three extractions; AutoTypeTable-from-source
is a structural advantage over MUI/AG's hand-maintained tables; events-state's gap-check
section reads as engineering honesty; no synonym rotation survived the STE pass.

## Fix-now list (small, mechanical — one lane)

- fill-handle.mdx: name the actual modifier key (Ctrl/Cmd) — actionable-instruction bug.
- events-state.mdx: need→callback→anchor lookup table at the top; show the literal
  `DataOp` shape in section 1.
- installation.mdx: link shadcn's own install guide beside the prerequisite; state that
  `shadcn init` created components.json; before/after example for the broken-import fix;
  small per-add-on dependency table.
- quick-start.mdx: "DataGrid is shorthand for Provider+Root+Header+Body" bridge paragraph;
  one-line `as const`/double-call callout; bold one-line controlled definition; getRowId
  one-line contract.
- index.mdx: gloss "registry" at first use; extend "What gridcn is not" with tree data,
  master-detail, pivot, column spanning.
- import-export.mdx: explicit out-of-scope formats line. url-state.mdx: column-layout
  not-synced callout. pagination.mdx: inline the id-keyed merge snippet.
- styling-theming.mdx: one sentence — the grid reuses YOUR ui/* primitives, re-theming them
  restyles the grid.
- B1 repairs on the nine failing pages: split the quoted 30+-word sentences, gloss or replace
  "no-op"/"over the wire"/"black box"/"hot path"/"friction point", fix the vague "falls back
  inconsistently", de-jargonize the api-reference TValidate paragraph.
- clipboard/editing cross-links: bulk-path validation caveat ↔ processPaste escape hatch;
  pending=readOnly note restated in editing-cell-types.

## Queued items (new pages / need measurement — workplan #66-#69)

- #66 Project status & compatibility page: version + semver/breaking policy + changelog link,
  browser matrix, React 19 rationale (and 18 stance), Node/TS floors, "updating installed
  code" section (shadcn diff workflow), support/security pointers.
- #67 Accessibility page: consolidate the scattered a11y content into one page with a stated
  conformance target and screen-reader test matrix (requires actual SR verification before
  claiming).
- #68 Recipes expansion: server round-trip (ops→mutation, optimistic + rollback), TanStack
  Query wiring, react-hook-form dialog editing, auth-gated cells.
- #69 Overlay-plugin author guide + OverlayPluginCtx AutoTypeTable in api-reference.
- Deferred with note: perf-numbers/memory/bundle-size inline on performance.mdx (needs a
  measurement run — pair with the comparison report's bundle-byte-weight lever); feature
  matrix page (fold into #66 or the comparison report's public version).
