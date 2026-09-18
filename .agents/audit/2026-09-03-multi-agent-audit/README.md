# Multi-agent audit — 2026-09-03

Read-only audit of gridcn across three dimensions: **features**, **performance**, **bugs**.
No source changes in this pass — findings land as docs/plans only.

## Baseline

- Branch `dev`, HEAD `a4a303a` (working tree clean at start).
- 133 commits since 2026-08-01; the 2026-08-02 optimization audit
  (`docs/agent-work/2026-08-02-optimization-audit.md`) has been substantially worked through:
  `d694765` fixed 19 verified audit defects, the streamGeneration token bug and the
  cell-type `compare` sort bug (the two top HIGHs) are confirmed fixed in source,
  `fix-registry-imports.mjs` now uses the generic regex.
- This audit therefore has two jobs: (1) verify what is still open from the prior audit,
  (2) find what is new.

## Method

Three parallel read-only agents (task tool, `general` type, research-only mandate),
one per dimension. Each agent prompt carries: the governing specs (absolute paths),
the settled-decisions register (so by-design behavior is not reported), the prior audit
findings to re-verify, and the finding format. Per the `improve` skill, every surviving
finding is vetted against source by the orchestrator before it enters a report.

No git worktrees: the audit is read-only over a clean tree and writes no source files,
so isolation buys nothing (decision recorded per the "worktrees if needed" instruction).

## Skills used

| Skill | Role |
|---|---|
| `brainstorming` | tracking-doc + spec conventions (`docs/agent-work/specs/`, commit per artifact) |
| `improve` | audit discipline: recon → parallel fan-out → vet-before-present → self-contained plans |
| `find-skills` | skill discovery sweep (see decision log D4) |

## Artifacts & commit map

| # | Artifact | Commit | Status |
|---|---|---|---|
| 1 | This tracking doc + traces scaffold | `b620e4a` | done |
| 2 | Features report → `docs/agent-work/2026-09-03-audit-features.md` + trace | `f490d5a` | done |
| 3 | Performance report → `docs/agent-work/2026-09-03-audit-performance.md` + trace | `d01beeb` | done |
| 4 | Bugs report → `docs/agent-work/2026-09-03-audit-bugs.md` + trace | `e663850` | done |
| 5 | PLAN.md feature-goal checklist updated to reality | `5a75068` | done |
| 6 | Follow-up workplan → `docs/agent-work/plans/2026-09-03-audit-followups.md` | `2bf8d71` | done |
| 7 | Trace files → `traces/` (one per agent: prompt ref + raw return) | with #2–#4 | done |
| 8 | Full self-contained handoff plans → `plans/README.md` + `plans/001-…-010` (executor-ready: drift check, verified refs, step gates, STOP conditions) | one commit per plan + index | done |
| 9 | Workplan + this doc: pointer from the condensed queue to `plans/` | with #8 | done |

## Results summary

- Prior audit re-verification: **all verified 08-02 findings are fixed** (bugs + perf
  reports carry the evidence tables, incl. the two gating compare-wiring follow-ups).
  ~25 tail items re-verified: 20 fixed/moot, 12 refuted-unchanged (rejections listed in
  the follow-up workplan so they are not re-audited).
- New findings: **2 HIGH** (unbounded full-selection delete + paste into large range —
  shared `visibleColumns.find`-per-write root cause), **1 MEDIUM** (rect-scope copy
  uncapped despite two-stage Ctrl+A), **1 MEDIUM decision** (`aria-selected` prop
  churn violates the zero-render budget), **1 HIGH-mechanism** (undo/redo O(n²) row
  lookup at scale), 3 LOW spec-gap bindings + 1 LOW lazy edge case + 1 spec-doc fix.
- Forward queue: 10 self-contained plans (P1×4, P2×2, P3×4) + 6 decision items with
  recorded defaults — `docs/agent-work/plans/2026-09-03-audit-followups.md`.
- User-visible decision flagged for review (D6 bar, non-blocking): plan 005
  (`aria-selected` vs the zero-render invariant). Vetting during the plan expansion
  REVERSED the original recommendation: the imperative-write fix would reintroduce
  ~544 per-cell store subscriptions (exactly what the spec-4b per-row consolidation
  eliminated), while the churn is bounded by membership flips — the recorded decision
  is now: accept the churn, scope the invariant, guard it with render-count tests
  (`plans/005-selection-churn-invariant.md`).

## Decision log (autonomous calls, per user instruction: recommend and proceed; ask only on criticals)

| # | Decision | Chosen | Rationale |
|---|---|---|---|
| D1 | Scope | review only, zero source edits | explicit user instruction ("noch nicht umsetzen, nur review") |
| D2 | Worktrees | not used | read-only audit, clean tree; see Method |
| D3 | Plan placement | queue/overview in repo workplan convention (`docs/agent-work/plans/`); the full executor-ready handoff plans (written after the user asked for "alles aufschreiben für später") in repo-root `plans/` per the `improve` skill | repo already maintains PLAN.md + workplans + specs there; the expansion the user requested is the skill's `plans/NNN-slug.md` format, so it lives at the root with its own index |
| D4 | Skill discovery | existing skills suffice (`improve`, `brainstorming`, `code-review` later for fix-pass); no external skill installs | `find-skills` sweep: the three dimensions map 1:1 to already-installed skills; installing third-party skills mid-audit adds unreviewed instructions to the flow |
| D5 | Interactive brainstorming questions | skipped | user instruction: proceed with recommended options, ask only on criticals. Assumptions are logged here instead |
| D6 | Criticality bar for user questions | only findings that change public API shape or imply data loss in shipped add-ons get surfaced for confirmation before a plan is written | matches PLAN.md §11 escalation rule ("anything touching public API shape → stop, update PLAN.md first") |

## Open questions (none blocking — defaults recorded, applied)

- O1: follow-up workplan scope? Applied default: all confirmed HIGH + MEDIUM became
  plans (001–008); the rest (LOW/dx) went into 009/010; product-level items became
  decision items. → applied in `2026-09-03-audit-followups.md`.
- O2: PLAN.md §3 treatment? Applied default: check shipped in place, keep the text,
  add status annotations; strike shipped v2 entries with a "struck as shipped" line.
  → applied in `5a75068`.
