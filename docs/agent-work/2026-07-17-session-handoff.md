# Session handoff — 2026-07-17 (QA burst / feature sprint)

Written for the NEXT session. Read this + the two linked files and you have full context.

## The two files that matter

1. **`docs/agent-work/plans/2026-07-17-qa-workplan.md`** — THE living master plan. Every open
   item, every decision, the done-list with commit hashes. Always read it first on resume.
2. **`git log --oneline -30`** — the burst's history; every lane landed as its own commit.

## How this project is worked (the process — follow it)

- **Advisor pattern (user's standing directive):** the main session (planner) is
  advisor/planner/gatekeeper/committer ONLY. All building is delegated to **builder
  agents**, one well-scoped lane each, with a detailed mandate (scope, constraints, gates,
  "report back" list). Small one-liners may be done inline by the advisor. Research lanes use
  read-only Explore agents.
- **Autonomous phases:** no human-in-the-loop between phases — gate → commit → launch next lane
  automatically. Auto-commit is authorized. The user drops in mid-turn with new asks; every ask
  gets a numbered workplan item ("everything I tell you, add it as a plan" is a standing rule).
- **Gates every lane must pass before commit:** `npx tsc --noEmit` · `npx vitest run
  --project=unit` · `npx vitest run --project=browser` · `node scripts/verify-registry.mjs`.
  After lanes that touch shipped registry files: `npx shadcn build && node
  scripts/fix-registry-imports.mjs && node scripts/verify-registry.mjs`, commit `public/r`.
- **Perf test discipline:** `perf.browser.test.tsx` is load-sensitive — under concurrent
  builders/dev-server load it dips below the 15fps floor; isolated it passes. NEVER lower
  thresholds (a builder once tried; rejected). Rerun isolated, report both numbers.
- **Builders must never:** commit, touch `public/r/`, kill node processes broadly (a builder
  once killed the user's dev server on port 3000 — always restart it with `npm run dev` in
  background if down, check with Get-NetTCPConnection -LocalPort 3000).
- **Vite cache gotcha:** browser tests failing with doubled-drive-letter imports (`c:\C:\...`)
  → `Remove-Item -Recurse node_modules/.vite`, rerun.
- **529/API overloads kill builders sometimes** — their disk work survives; resume them via the
  same agent (SendMessage) with "finish gates + report" instructions.
- **Registry drift bites:** every new shipped file under registry/ MUST be added to
  registry.json; verify-registry catches it — run it at every payload rebuild.

## Code/style rules in force

- Comments: only non-obvious WHY, one short line (user's global agent rules). Match existing
  narrative doc-comments in core files.
- shadcn tokens only; no new npm deps without explicit approval; Base UI (`data-active`, not
  data-selected; `nativeButton={false}` for anchor Buttons); "bun x" is the bun runner.
- Structure rules in CONTRIBUTING.md (domain dirs, no single-file dirs, merge tiny siblings,
  one-symbol-per-file only for ~200+ line symbols; entry file = `<block>.ts` or the root
  component `<block>.tsx` doubles as entry).
- All user-facing strings through the `labels` groups in core labels.ts. RTL: "not yet
  supported, may come in a future version" (exact wording the user wants).
- Docs snippets must model identity-stable callbacks (module-scope/useCallback) — the dev
  guardrail warns on churn.

## Architecture context (don't re-derive)

- Sticky-viewport + transform virtualization; scroll writes CSS vars imperatively (zero React
  renders on scroll); single flushSync per tick; velocity overscan WITH settle reset (9f0200b).
- Selection/fill/presence are OVERLAY-painted (overlays.tsx) — cells never subscribe to ranges;
  probe tests in test/data-grid.test.tsx enforce zero-render contracts. Root context value is
  useMemo-stable (click render-storm fix 9ddbf8b) — never add volatile fields to it.
- Row-level state subscription (useDataGridRowCellState) replaced per-cell subs; search-match
  lookup is a precomputed per-row Map (29x, 7e290dd).
- content-visibility on rows is REJECTED (conflicts with subgrid rows — pinned cells displace;
  see docs/agent-work/2026-07-17-perf-audit.md). Row pooling REJECTED (tablecn doesn't pool
  either; see docs/agent-work/2026-07-17-tablecn-comparison.md). Canvas pivot REJECTED
  (2026-07-16 12-agent eval).

## State at handoff (updated 2026-07-18, end of second burst)

- EVERYTHING committed, tree clean at d9d0528. The whole 2026-07-17/18 queue is DONE — see the
  workplan's done-list for items #5, #21-#33, #35 with commit hashes. Highlights landed this
  burst: paper docs theme + fd-token bridge, WebGPU→Canvas-2D full-page hero (approved F design,
  frosted-glass P2 text panels, oklch ink fix), composable pagination (breaking, Bar + parts),
  tablecn-parity filter/sort popovers (@dnd-kit/react reorder + full a11y), ColumnDef never→
  unknown erasure fix, noUncheckedIndexedAccess adopted repo-wide (487→0), createFilterMatcher
  perf win (28-56%), DateCell SSR locale fix, type-safety fleet (5 confirmed fixes + two real
  SelectValue/SelectIcon UI bugs found and fixed).
- New standing gotcha: browser suite import failures (`c:\C:\...`) can be drive-letter CASING —
  run suites from the repo root with an UPPERCASE drive letter; .vite clear alone won't fix it.
  Turbopack can also serve stale CSS across restarts → delete .next.
- The repo is pnpm (pnpm-lock.yaml) — never npm install.

## Next steps

1. **Workplan #34 (awaiting user):** tablecn-style global shortcuts (Ctrl+Shift+F/S opens the
   popovers, Backspace/Delete removes the last row) — needs a design call vs data-grid-keybindings.
2. **Workplan "Awaiting user input"** items (search-icon specifics, React Scan prod re-capture).
3. The planned structure refactor (memory: structure-refactor-planned) still runs LAST.
4. Whatever the user brings — every ask becomes a workplan item first.

## Skills/tools used this burst (for the new session's awareness)

- No repo-external skills were load-bearing; the work ran on the built-in flow (subagent
  task delegation for builders + research, plus the standard terminal and file tools).
- Useful available skills for upcoming lanes: `frontend-design` (paper theme lane),
  `vercel-react-best-practices` (already installed; perf/docs code), `code-review` (optional
  pre-commit deep review). Skill installs the user may still run: shadcn/ui@shadcn,
  addyosmani accessibility.
- The agent auto-memory dir for this project has the durable rules:
  workflow-model-tiering, autonomous-phases, browser-testing-gate, phase-handoff-checklist,
  canvas-pivot-rejected — the new session sees MEMORY.md automatically.

## Prompt to paste into the new session

```
Continue the gridcn QA/feature burst. Read docs/agent-work/2026-07-17-session-handoff.md
first — it has the process, rules, and state. Then read
docs/agent-work/plans/2026-07-17-qa-workplan.md (the living master plan) and
git log --oneline -20 to reconcile state. Keep the standing workflow: you (planner) are
advisor/gatekeeper/committer, builder agents build, autonomous phases, auto-commit
authorized, all design decisions delegated to you. Check git status first: if the
type-safety lane (workplan #7) left uncommitted work, gate it (tsc, unit, browser,
eslint, verify-registry), commit, rebuild payloads if registry/ changed. Then continue
with the next queued phase (paper docs theme) and the workplan queue. Every new thing I
tell you gets added to the workplan as an item before you build it.
```
