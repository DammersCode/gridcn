# 011 — OSS readiness: GitHub registry, Vercel docs hosting, publish checklist

Status: IN PROGRESS (work carried on `dev`; `oss/github-registry` is stale)
Date: 2026-09-07
Scope: make the repository open-source ready — installable from a shadcn **GitHub registry**,
hostable on Vercel (free tier), with every non-OSS-ready finding written down and planned.

## What is done on this branch

- `registry.json` is now the manifest of a **GitHub registry**: same-repo `registryDependencies`
  use full GitHub item addresses (`DammersCode/gridcn/<item>`) instead of the `@gridcn/`
  scope, so the shadcn CLI resolves them without any namespace mapping.
  `homepage` + the core item's `docs` field point at the GitHub repository (gridcn.dev is dead:
  NXDOMAIN as of 2026-09-07).
- Gates run green: `node scripts/verify-registry.mjs`, `pnpm lint`, `pnpm registry:build`
  (payload gate), `node scripts/verify-payload-content.mjs`, and
  `npx shadcn@latest registry validate DammersCode/gridcn#oss/github-registry`
  ("Registry is valid, 42 items").
- End-to-end consumer test: a throwaway Vite + React 19 + Tailwind v4 app (temp dir, untracked)
  ran `shadcn init`, then `npx shadcn add DammersCode/gridcn/data-grid#oss/github-registry`
  and `.../data-grid-history#oss/github-registry`. Cross-item imports landed as
  `@/components/data-grid/data-grid` (0 broken `@/registry/...` or `blocks/` imports), declared
  npm deps (`zustand`) installed automatically, `tsc --noEmit` and `vite build` both pass.
- Docs teach the GitHub registry as the primary path: `content/docs/installation.mdx`,
  `content/docs/quick-start.mdx`, `content/docs/index.mdx`, `README.md`, `DEVELOPMENT.md`,
  `components/install-command.tsx`, `components/manual-install.tsx` (deps filter now matches the
  `DammersCode/gridcn/` prefix). The hosted `@gridcn` namespace is documented as an
  optional alternative served by the deployed docs site (`/r/{name}.json`).
- Vercel readiness: standard Next.js (Fumadocs) app, no env vars required (only optional
  `NEXT_PUBLIC_COMMIT_SHA` / `GRIDCN_DEV_URL` with defaults), Node 22 works with Next 16,
  `pnpm build` is the deploy gate. No `vercel.json` needed. The hosted host is the free Vercel
  Hobby subdomain (`<project>.vercel.app`), documented in README + `/docs/installation`
  (gridcn.dev is retired).
- CI is on again: `push: [main]` + `pull_request` triggers restored, plus a new
  `Validate GitHub registry (shadcn CLI)` step (`GITHUB_TOKEN` can read the owning repo;
  validates the exact commit SHA).
- The unit-coverage gate was red on two files (pre-existing, below their 90% branch threshold):
  `data-grid/labels.ts` and `data-grid-context-menu/resolve-context-menu-target.ts`. Added the
  missing branch tests (default label functions, resolver null-branches) — gate green again
  (1455 unit tests).
- `DEVELOPMENT.md` now has "Testing the GitHub registry locally (your own React project)":
  validate/list/view without an app, then a from-scratch Vite + React project that installs
  from the pushed branch ref exactly like a consumer.

## Findings: not OSS-ready yet

| # | Finding | Severity | Plan |
|---|---------|----------|------|
| 1 | Repository is **private**. The GitHub registry only resolves anonymously once public; until then consumers need `gh auth login` or `GH_TOKEN` (CI: fine-grained PAT, Contents: Read). | Blocking for public distribution | Owner makes `DammersCode/gridcn` public on GitHub. No code change. |
| 2 | **gridcn.dev is dead** (NXDOMAIN). The old hosted-registry host. | Blocking for the old install path | Done on this branch: docs/README/registry.json no longer depend on it. The Vercel deployment becomes the new host of the site and of `/r/` payloads. |
| 3 | Default branch is `main`, active dev happens on `dev`. A ref-less `shadcn add` reads the **default branch**, which still has the old `registry.json`. | Blocking for ref-less installs | Merge `oss/github-registry` into `main` (then optionally make `main` the active branch). |
| 4 | CI was disabled (`workflow_dispatch` only, user-disabled 2026-07-16). | **Done** on this branch | `push: [main]` + `pull_request` restored + `registry validate` step added (uses `GITHUB_TOKEN`; anon-validated once public). |
| 5 | Internal process docs are tracked: `.agents/audit/**`, `.agents/skills/**`, `skills-lock.json`, `docs/agent-work/**`, `plans/**`, `research/**`. | Cosmetic | Decision for the owner: keep (transparent process, harmless) or move out of the public repo. Default: keep for now, revisit at the public announcement. |
| 6 | No LICENSE header per file; single MIT `LICENSE` at root. | OK | No action — MIT root license covers the registry distribution. |
| 7 | No secrets, local absolute paths, or machine-specific settings in tracked files (grep-verified 2026-09-07). | OK | No action. |
| 8 | Build artifacts are gitignored (`.next/`, `*.tsbuildinfo`, `**/__screenshots__/`, `.source/`, `coverage/`). | OK | No action. |
| 9 | Browser-test screenshot baselines are gitignored, so a fresh CI checkout has no baselines on the first `--project browser` run. | Known, pre-existing | Verify on CI re-enable (finding 4): if first-run baselines fail the suite, commit a baseline generation step or the baseline set. |
| 10 | `pnpm-workspace.yaml` defines a single-package workspace. | OK | Vercel handles pnpm workspaces; no change. |
| 11 | `package.json` is `"private": true`. | OK | Intended — distribution is via registry, not npm. |
| 12 | `app/dev/*` (100k-row playground, benchmark) is part of the production build and would be publicly visible on Vercel. | OK / by design | Keep — it is the live demo surface the docs reference. |

## Ordered plan (after this branch merges)

1. Merge `oss/github-registry` → `main` (registry + docs + payloads together).
2. Make the repository public (finding 1). Verify ref-less:
   `npx shadcn@latest registry validate DammersCode/gridcn` and
   `npx shadcn add DammersCode/gridcn/data-grid` from a clean machine without any token.
3. Deploy the docs site to Vercel (free Hobby plan, `vercel.com/new`, Next.js preset) — the
   free subdomain `<project>.vercel.app` is the docs host AND the hosted-registry host.
4. CI is on (finding 4): watch the first green run; check the screenshot-baseline behavior
   (finding 9).
5. Optional polish: point `registry.json` `docs`/`homepage` and the README docs link at the
   Vercel URL once it exists; decide on internal docs visibility (finding 5).

## Gates to run before merging

| Gate | Command | Expected |
|------|---------|----------|
| Registry ↔ filesystem | `node scripts/verify-registry.mjs` | "All items match the filesystem." |
| Lint | `pnpm lint` | 0 errors |
| Registry payloads | `pnpm registry:build` | payload gate green |
| Payload ↔ source | `node scripts/verify-payload-content.mjs` | "Payload content matches source" |
| Docs site build (Vercel proxy) | `pnpm build` | exit 0 |
| GitHub registry schema | `npx shadcn@latest registry validate DammersCode/gridcn#<branch>` | "Registry is valid" (GH_TOKEN while private) |
| Consumer install E2E | throwaway Vite app: `shadcn init` + `shadcn add <addr>/data-grid[#ref]` + quick-start code, then `tsc --noEmit` + `vite build` | both exit 0 |
