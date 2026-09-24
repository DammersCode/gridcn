# E2E install spot-check: `data-grid` in a fresh Next.js + shadcn project

Date: 2026-09-23 · Plan 014, Task 2, part 4 · Worktree `gridcn-docs-improvements` (branch `docs/improvements`, at `689a49b`)

**Result: PASS.** `data-grid` is installed via a real `shadcn add` from local registry hosting into a
fresh, minimal Next.js 16 + Tailwind v4 + shadcn project, builds with zero manual changes
(exit 0), and renders on `/` without extra configuration (`role=grid`, 3 data rows visible).

## Walkthrough

1. Test project set up manually and minimally (create-next-app skipped — its flags do not cover
   all prompts of the current version): `package.json` with next 16.3.5 / react 19.3.0 / react-dom 19.3.0
   + Tailwind v4 (4.3.3, `@tailwindcss/postcss`), `tsconfig.json` with the `@/*` alias, `postcss.config.mjs`,
   `next.config.ts`, `app/layout.tsx`, `app/globals.css` (`@import "tailwindcss"`), placeholder `app/page.tsx`.
2. `pnpm install`.
3. `npx shadcn@latest init -y -b base --preset nova` (CLI 4.21.0). Wrote `components.json`
   (style `base-nova`, default aliases), `lib/utils.ts`, extended `app/globals.css` with theme tokens,
   installed `@base-ui/react`, `class-variance-authority`, `cn`, `lucide-react`, `tw-animate-css`.
   (Note: `-y` alone is NOT enough in 4.21.0 — without `-b`/`--preset` the prompt hangs;
   `--preset base-nova` is invalid, the correct preset name is `nova`.)
4. Local registry hosting: `npx serve` is NOT sufficient (CLI 4.x expects item payloads under the
   registry entry's URL template, but the payloads live under `public/r/`). Instead a
   Node inline server (`e2e-install-check/registry-server.mjs`, port 8490):
   - `GET /registry.json` → worktree-root `registry.json`
   - `GET /<name>.json` → worktree `public/r/<name>.json`

   Verified: `registry.json` 200 (55 items), `data-grid.json` 200 (768 kB, content embedded),
   unknown name 404.
5. Test project `components.json`: added the entry
   `"registries": { "@gridcn": "http://localhost:8490/{name}.json" }` (the only
   harness configuration — in production the CLI resolves `@gridcn` via gridcn.vercel.app, see deviation 2).
6. Baseline commit in the test project (`git init` + commit before the install).
7. `npx -y shadcn@latest add @gridcn/data-grid -y`.
8. `pnpm build` (once right after install with the placeholder page, then once with the quick-start page).
9. `next start -p 3111` + browser check via agent-browser + screenshot.
10. `npx shadcn@latest registry validate --cwd <worktree>`: `√ Registry is valid. (55 items)`, exit 0.

## CLI 4.21.0 mechanics (verified from the CLI dist code, relevant to the install contract)

- The `registry` field and the `--registry` flag no longer exist (the plan's assumption from the 2.x era).
  Instead: a `registries` map in `components.json`, key `@<name>`, value a URL template with a `{name}`
  placeholder (exactly the format the gridcn repo itself uses in its `components.json` for
  `@diceui`/`@ncdai`).
- The add command is namespaced: `npx shadcn add @gridcn/data-grid`. A bare `data-grid`
  would resolve against the official @shadcn registry (ui.shadcn.com), not the local server.
- The item's `registryDependencies` (`button`, `input`, `select`, `checkbox`, `popover`, `calendar`,
  `dropdown-menu`, `context-menu`, `separator`, `tooltip`) were resolved by the CLI via the official
  @shadcn registry (style `base-nova`, over the network). The `data-grid` payload itself came
  100% from the local server.

## Install result

**104 files created** (CLI output "Created 104 files"):

- 94 × `components/data-grid/**` (93 code files + `LICENSE.md`) — exactly the `files[]` list of
  the `data-grid` item.
- 10 × `components/ui/{button,input,select,checkbox,popover,dropdown-menu,context-menu,separator,tooltip,calendar}.tsx`
  (official shadcn registry, style `base-nova`).

**`package.json` delta** (written by the CLI via `pnpm add`):

| Dependency | Version | Origin |
|---|---|---|
| `zustand` | `^5.0.15` | declared by `data-grid` (the one gridcn-specific dependency) |
| `react-day-picker` | `^10.0.1` | own dependency of the shadcn `calendar` item |
| `date-fns` | `^4.4.0` | own dependency of the shadcn `calendar` item |

`pnpm-lock.yaml`: +67 lines. No other changes from the install.

**Integrity check:** 94/94 payload files installed, 0 missing. Content: 74/94 byte-identical
(EOL-normalized). For 20 files the CLI removed the **leading file-header comment**
(proven: diff = exactly the header-comment removal, code parts identical). That is CLI behavior
(cosmetic, no semantic change), not a registry defect.

## Build result

- **Build 1** (right after install, placeholder `page.tsx`, **zero manual changes**):
  `pnpm build` → **exit 0** (Next.js 16.3.5 Turbopack, TypeScript check over all installed
  files green). Next adjusted `tsconfig.json` itself (`jsx` → `react-jsx`, `.next/dev/types`
  into `include`) — that is Next build behavior, not a manual change.
- **Build 2** (after the quick-start page, see below): `pnpm build` → **exit 0**.

## Render result

`app/page.tsx` + `app/columns.ts` = the quick-start snippet from `content/docs/quick-start.mdx`
copied 1:1 (the documented "Verify" procedure from `installation.mdx`). That is
usage code, not configuration — the `data-grid` item deliberately ships no page.

`next start -p 3111` (production server), agent-browser snapshot of `/`:

- `role=grid` present
- 3 × `columnheader`: Name / Age / Active
- 3 × data rows: Ada Lovelace (28, checkbox checked), Grace Hopper (34, checked),
  Katherine Johnson (41, unchecked)
- Screenshot: `C:\Users\dahe\AppData\Local\Temp\opencode\e2e-install-check\data-grid-e2e-screenshot.png`

CLI hint after the add: the `TooltipProvider` wrapper (standard shadcn tooltip contract). The page
renders **without** that wrapper reliably — the provider is not needed for grid rendering.

## Deviations from the task/plan text (CLI version, not registry defects)

1. The `components.json` field `registry` / the `--registry` flag no longer exist in CLI 4.21.0 →
   the `registries` map with the `{name}` template. The single entry in the test project is test harness
   (points at localhost instead of gridcn.vercel.app), not app configuration.
2. Install command: `npx shadcn add @gridcn/data-grid` (namespaced) instead of `add data-grid` —
   exactly matches the command documented in `installation.mdx`/`quick-start.mdx`.
3. `npx serve` on the worktree root is not suitable (payloads under `public/r/`) → Node inline server
   (the plan's "or a Node inline server" variant).
4. The CLI strips leading file-header comments from 20/94 installed files (comments only).

## Cleanup status

- Registry server (8490) and Next server (3111) stopped.
- The test project remains at `C:\Users\dahe\AppData\Local\Temp\opencode\e2e-install-check\`
  (`test-app/` + `registry-server.mjs`, `registry-server.log`, `next-server.log`,
  `data-grid-e2e-screenshot.png`).
- Exactly one new file was created in the worktree: this report.
