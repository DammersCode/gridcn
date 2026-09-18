# gridcn — Planning & Orchestration Workflow

How this project is planned, implemented, and reviewed with a multi-agent setup. PLAN.md says *what* to build; this file says *who builds it and how*.

## Roles & model assignment

| Role | Model | Effort | Responsibility |
|---|---|---|---|
| **Planner / Orchestrator** | planner model (main session) | session default | Owns PLAN.md, decomposes phases into precise task specs, authors workflow scripts, runs the phase gate (tests/typecheck/build/live check), integrates results, commits milestones |
| **Implementer (base)** | **builder** | **high** | Writes code/tests/docs for one tightly-scoped task with named files and a spec reference; returns file list + test results |
| **Reviewer (base)** | **builder** | **high** | Adversarial review with an explicit hunt list from the planner; verdicts gate the merge |
| **Low-risk implementer** | light model | high | Mechanical, well-templated tasks: demo pages, boilerplate wiring, docs stubs, config files |
| **Escalation reviewer** | planner model | session default | Only when a task fails review twice, or the planner flags a task as architecture-defining with no precise spec to review against |

Cost rule: builder-high is the base for everything; light model below it for mechanical work; planner above it only as the main-loop planner/gatekeeper and for explicit escalations. The compensating control for cheaper reviews is spec precision: the planner's task prompts must contain the invariants and an explicit hunt list, so review quality depends on the checklist, not the reviewer's intuition.

Rationale: planning and review are the leverage points where the strongest model pays for itself; well-specified implementation tasks are builder-shaped when the spec is precise. High effort on implementers compensates for the smaller model on tricky code.

## The loop (per PLAN.md phase)

1. **Plan (planner, main loop).** Break the phase into tasks. Every task prompt must name: the exact files to create/edit, the spec sections that govern it (PLAN.md §, research/*.md §), the invariants that must hold, and the test expectations. No task may require an implementer to make an architectural decision.
2. **Implement (builder, high, fan-out).** `pipeline()` over tasks — independent tasks run concurrently; dependent stages chain without barriers. Implementers write code + colocated tests, run them, and return `{files, testsPassed, notes}` as structured output.
3. **Review (planner, per task, no barrier).** Each task's output is reviewed as soon as it lands (same pipeline, next stage). The reviewer's prompt is adversarial: "find where this violates the spec or breaks; default to rejecting if uncertain." Findings → a fix task (builder, high) → re-review. Max two fix rounds; after that the orchestrator takes over the task itself.
4. **Gate (main loop).** `pnpm build`, `pnpm test` (unit + **browser projects** — Vitest Browser Mode in real Chromium; jsdom has no layout engine and misses rendering bugs), typecheck must be green, plus a live check of the running app (agent-browser or manual) for anything touching rendering. Phase-level invariants spot-checked. Then one conventional commit per phase.
5. **User QA (async, non-blocking).** Every phase report still ends with a "what you need to do" + "what to test for me" checklist, but phases proceed autonomously — gate green → commit → next phase launches immediately. User feedback is folded in whenever it arrives, as fix tasks against the relevant phase.

```js
// canonical phase script shape
const results = await pipeline(
  TASKS,
  t => agent(implementPrompt(t), { model: 'builder', effort: 'high', phase: 'Implement' }),
  (out, t) => agent(reviewPrompt(t, out), { phase: 'Review', schema: VERDICT }),   // inherits planner
  (verdict, t) => verdict.ok ? verdict
    : agent(fixPrompt(t, verdict), { model: 'builder', effort: 'high', phase: 'Fix' })
)
```

## Task-writing rules (for the planner)

- One task = one coherent unit an implementer can finish without asking questions (typically 1–4 files).
- Prompts are self-contained: agents don't share this conversation's context, so every prompt restates or points to everything needed (`Read PLAN.md §4.3 and research/glide-behavior-spec.md §1 first`).
- Pure `lib/` modules are implemented test-first and in parallel; components that share the reducer/context are sequenced.
- Parallel agents never write the same file. If they must, the task split is wrong — re-split.

## Review rules (for reviewers)

- Review against the spec, not taste: PLAN.md decisions are settled; don't re-litigate architecture.
- Check the traps the research flagged: index-space mixing, `isComposing`, quoted-TSV edge cases, id-vs-index keying, document-level listener leaks, per-cell re-renders.
- Style gate: shadcn tokens only, data-attribute states, one-line why-comments only, JSDoc on exports.
- Verdict is structured: `{ok, findings: [{file, line, problem, mustFix}]}`. `mustFix` findings block; nits are applied by the fixer but never block twice.

## Escalation

- Implementer fails twice on the same task → orchestrator (planner) implements it directly.
- Reviewer and implementer disagree → orchestrator decides; if it's a spec gap, PLAN.md gets amended first, then the task re-runs.
- Anything touching public API shape mid-phase → stop, update PLAN.md §5, then continue.
