# Agent skills: A/B evals (2026-09-26)

Decision record for the five skills under `skills/`. Rerun this before a larger skill change.

## Method

- Fixture: a Vite consumer app from `node scripts/verify-e2e-install.mjs --vite --reuse` with core,
  fill, history, pinned rows, presence, lazy, pagination, and keybindings installed.
- 10 scenarios, 2 per skill, each with seeded code that compiles and a rubric. Each scenario ran
  twice: `base` (no skill) and `skill` (the five descriptions listed, bodies on demand).
- Independent graders scored the git diffs against the rubric and listed skill defects. Upgrade scenarios
  were scored from the transcripts.

## Results (first round)

| Scenario | Base | Skill | What made the difference |
| --- | --- | --- | --- |
| perf-1: slow grid | 5/6.5 | 6/6.5 | Only the skill run bounded the grid height (virtualization off otherwise). |
| perf-2: live feed review | 5/5.5 | 5/5.5 | Skill run used `updateCells` + `skipValidation`; wrote a ref during render. |
| cell-1: currency type | 7.5/8 | 7.5/8 | Skill run put the type inside `components/data-grid/` (upgrade risk). |
| cell-2: broken rating type | 3.5/5 | 3.5/5 | Only the skill run found the `cellTypes` registry replacement. |
| data-1: lazy + server sort | 6/7 | 6/7 | Both correct; the lazy-loading page covers this case well. |
| data-2: paged bugs + sort | 3.5/5 | 3.5/5 | Both echoed the spec into `sortState`; base also missed `headerClickBehavior`. |
| addons-1: fill + undo + totals | 7/7 | 7/7 | Equal; the installed demos are a strong reference. |
| addons-2: presence + fill bugs | 3.5/5 | 5/5 | Base kept an inline `overlayPlugins` literal. |
| upgrade-1: Git, local edit | fail | pass | Only the skill run asked for the branch before writing. |
| upgrade-2: no Git | pass | fail | Skill run overwrote without consent (rule sat in step 0, far from the write). |

## Skill fixes, then verified by rerun

- data-source: `sortState={EMPTY_SORT}` in lazy and paged mode alike, `headerClickBehavior="sort"`,
  page reset on sort. Rerun: correct.
- custom-cell-type: own folder + barrel-only imports, empty-string `fromText` trap, 3-decimal
  round-trip test, `as never` symptom, editor bounds. Reruns: correct placement, cast removed.
- performance: store the `onDataChange` array unchanged (echo check), feed as a child component
  reading `getState()`, consistent data mode. Rerun: correct; data-mode rule added after it.
- addons: undo/redo as a provider hook, totals-row recipe, correct aggregate warning.
- upgrade: consent gate moved into step 3, next to the write, naming the excuses agents used
  ("re-derivable", "backed up", "re-add afterwards"). Two reruns: both stopped and asked.

## Docs bugs the evals exposed

- fill, presence, and broadcasting-presence examples passed an inline `overlayPlugins={[plugin]}`.
- The lazy-loading sort example lacked `headerClickBehavior="sort"`.
