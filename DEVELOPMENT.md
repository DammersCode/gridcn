# Local development

How to run, test, and consume this repo on your own machine. Structure/code rules live in
[CONTRIBUTING.md](CONTRIBUTING.md); this file is the day-to-day operations manual.

## Prerequisites

- Node 24+ and **pnpm** (this repo is pnpm — `pnpm-lock.yaml` is the lockfile; never `npm install`).
- One-time: `pnpm install`.

## Run the docs site

```powershell
pnpm dev            # Next.js (Turbopack) on http://localhost:3000
```

| Page | What it's for |
|---|---|
| `/` | Landing page (animated hero background, embedded grid demo) |
| `/docs` | The full documentation site |
| `/dev` | Feature playground: every core feature + toggles (density, markers, header click, German labels, sort/filter popovers) |
| `/dev/examples` | Every registry example demo on one page |

## Tests & gates

The full gate set (run all of these before considering a change done — every lane in this
repo's history was held to them):

```powershell
npx tsc --noEmit                        # type-check, must be clean
pnpm lint                               # oxlint + import-boundary script (fast, <1s)
pnpm lint:typed                         # type-checked no-unsafe-* on registry source (slow)
npx vitest run --project=unit           # jsdom unit tests
npx vitest run --project=browser        # real-Chromium browser tests (Vitest Browser Mode)
node scripts/verify-registry.mjs        # registry.json <-> filesystem consistency
```

Single file: `npx vitest run --project=browser sort-list` (substring-matches the path).

### Gotchas (all real, all hit before)

- **Uppercase drive letter.** If the browser suite fails at *import* with doubled-drive-letter
  paths (`c:\C:\...`, usually via a fumadocs typography resolve error), your shell's cwd uses a
  lowercase drive letter. Run suites from the repo root spelled with a capital drive letter
  (e.g. `cd C:/path/to/gridcn`).
- **Stale Vite cache.** A different flavor of the same doubled-drive-letter error is cache
  corruption: `Remove-Item -Recurse -Force node_modules/.vite`, rerun.
- **Stale Turbopack CSS.** If a CSS change doesn't show up in the browser (even after restart),
  delete `.next` and restart `pnpm dev` — Turbopack's persistent cache can serve old CSS.
- **perf.browser.test.tsx is load-sensitive.** Under concurrent machine load it can dip below
  its FPS floor. Rerun it isolated (`npx vitest run --project=browser perf`) and compare;
  **never lower the thresholds**. If it fails isolated too, verify against a clean checkout
  (`git stash`) before blaming your change.

## The registry (how the shipped components are built)

Source of truth: `registry/default/blocks/*` + `registry/default/examples/*`, indexed by
`registry.json`. What consumers actually download are the **payloads** in `public/r/*.json`.

After ANY change to files under `registry/` or to `registry.json`:

```powershell
npx shadcn build                        # regenerate public/r/*.json from registry.json
node scripts/fix-registry-imports.mjs   # rewrite cross-item imports in the payloads
node scripts/verify-registry.mjs        # must print "All items match the filesystem."
```

Commit `public/r/` together with (or right after) the source change — the payloads are
checked in, so the deployed site serves them statically.

Rules that bite if forgotten:

- Every new shipped file under `registry/` MUST be listed in `registry.json` (`verify-registry`
  gates it). Test files (`*.test.ts*`, `*.browser.test.tsx`) are never listed.
- npm dependencies a component needs (e.g. `@dnd-kit/react` for the toolbar/sort-list) are
  declared per item in `registry.json` → consumers get them installed automatically.
- `registry.json` is also the manifest of the **GitHub registry**: the shadcn CLI reads it
  straight from `github.com/DammersCode/gridcn` and consumers install items as
  `npx shadcn add DammersCode/gridcn/<item>` (no namespace, no server). Same-repo
  `registryDependencies` MUST use the full GitHub item address
  (`DammersCode/gridcn/<item>`), never a `@gridcn/` scope — the CLI resolves only the
  full address without a namespace mapping. After any `registry.json` change, push and validate:

  ```powershell
  npx shadcn@latest registry validate DammersCode/gridcn   # default branch
  npx shadcn@latest registry validate DammersCode/gridcn#<branch>
  ```

  (while the repository is private the CLI needs `gh auth login` or a `GH_TOKEN` with read access)

## Testing the registry install on your own PC

The dev server serves the payloads at `http://localhost:3000/r/<item>.json`. To install into a
**different local project**:

1. Keep `pnpm dev` running here.
2. In the consuming project (any Next/Vite React app with Tailwind v4): initialize shadcn once
   if it isn't (`npx shadcn@latest init`).
3. Point the `@gridcn` namespace at your local server:

   ```powershell
   npx shadcn@latest registry add @gridcn=http://localhost:3000/r/{name}.json
   ```

   (or by hand in the consumer's `components.json`:
   `"registries": { "@gridcn": "http://localhost:3000/r/{name}.json" }`)

4. Install exactly like a real consumer:

   ```powershell
   npx shadcn@latest add @gridcn/data-grid          # core
   npx shadcn@latest add @gridcn/data-grid-toolbar  # any add-on, each depends only on core
   ```

   One-off alternative without the namespace: `npx shadcn@latest add http://localhost:3000/r/data-grid.json`.

5. Files land under the consumer's alias path (`components/data-grid/*` by default), npm deps
   from the payload are installed, and you use the components per `/docs/quick-start`.

For production there are two equivalent paths (what `/docs/installation` tells real users):

- Hosted registry: `npx shadcn add @gridcn/data-grid` — the CLI resolves the `@gridcn` scope
  from the deployed documentation site (Vercel free plan), which serves the committed `public/r/`
  payloads. This is the primary documented path.
- GitHub registry: `npx shadcn add DammersCode/gridcn/data-grid` — reads the pushed
  repository directly; the only path with ref pinning (`#<ref>`).

This flow is the honest end-to-end test of the registry: it exercises the payloads, the
cross-item import rewriting, and the declared dependencies exactly as a consumer would.

## Testing the GitHub registry locally (your own React project)

The honest test of the GitHub registry is to install from `github.com` exactly like a consumer
would, into a project you start yourself. While the repository is private the CLI needs
credentials: `gh auth login` once (GitHub CLI), or a `GH_TOKEN` environment variable with read
access. Public repository: no credentials at all.

1. Push the branch you want to test, then note the ref (`<branch>`, a tag, or a commit SHA).
   Quick checks without any app:

   ```powershell
   npx shadcn@latest registry validate DammersCode/gridcn#<branch>   # schema + files exist
   npx shadcn@latest list  DammersCode/gridcn#<branch>               # every item
   npx shadcn@latest view  DammersCode/gridcn/data-grid#<branch>     # one item's resolved payload
   ```

2. Start your own Vite + React project (the documented consumer prerequisite: React 19 +
   Tailwind v4 + shadcn):

   ```powershell
   npm create vite@latest gridcn-play -- --template react-ts
   Set-Location gridcn-play
   pnpm install
   pnpm add tailwindcss @tailwindcss/vite
   ```

3. Add the Tailwind plugin to `vite.config.ts` (`plugins: [react(), tailwindcss()]`), replace
   `src/index.css` with `@import "tailwindcss";`, and add the alias mapping to the ROOT
   `tsconfig.json` (`"paths": { "@/*": ["./src/*"] }`) — the shadcn CLI reads that file
   directly and does not follow `references`.

4. Initialize shadcn (same style this repo uses), then install from the GitHub registry — the
   ref goes AFTER the item name:

   ```powershell
   npx shadcn@latest init -y -b base -p nova -t vite
   npx shadcn@latest add DammersCode/gridcn/data-grid#<branch>          # core
   npx shadcn@latest add DammersCode/gridcn/data-grid-history#<branch>  # any add-on
   ```

   Preview without writing: `npx shadcn@latest add <addr> --dry-run`, or inspect one file with
   `--view src/components/data-grid/data-grid.tsx` after install.

5. Copy the two files from the [quick start](content/docs/quick-start.mdx) (`src/columns.ts`,
   `src/people-grid.tsx`) into `src/`, render `<PeopleGrid />` in `src/App.tsx`, then:

   ```powershell
   npx tsc --noEmit -p tsconfig.app.json   # gate: imports + types resolve
   pnpm dev                                # click a cell, type, press Enter
   ```

   What to check: files land in `src/components/data-grid/*` with imports rewritten to your
   `@/components/...` alias (no `@/registry/...` leftovers), declared npm deps (e.g. `zustand`)
   are in `package.json`, and the grid renders and edits. That is the full consumer experience.

   For a bigger sweep (all items, two consumer flavors, typecheck + build), run
   `pwsh scripts/registry-smoke.ps1` (hosted flow via the local dev server).

## Benchmarking

Interactive stress test: `pnpm dev`, then `/dev` (100k-row playground — fling the scrollbar,
wheel-scroll hard, hold Shift+ArrowDown, type in search; the failure to look for is bare
background where cells should be) and `/dev/examples` (all registry demos incl. 100k rows).

The measured suites run in real Chromium (jsdom has no layout engine and misses rendering bugs):

```bash
# blank detector + FPS probe + keyboard repro (randomized 200-1500px drag deltas)
npx vitest run registry/default/blocks/data-grid/test/scroll-drag.browser.test.tsx --project=browser

# full-window-swap vs idle FPS ratio + absolute FPS floor (100k rows)
npx vitest run registry/default/blocks/data-grid/test/perf.browser.test.tsx --project=browser
```

Both log their measured numbers (`[scroll-drag baseline] ...`, `spec 6c-8 perf ratio ...`) so you
can compare machines or changes without touching assertions. Thresholds and their history live in
comment blocks inside the test files — read them before changing anything. Enforced invariants: no
observable blank rows after a 3-tick velocity warm-up, a full-swap FPS floor, and a one-row scroll
step rendering at most two rows' worth of cells.

## Consumer-install troubleshooting

### Vite + a non-default import alias (e.g. `~/`): set `paths` in BOTH tsconfig files

If your Vite project uses a custom alias like `~/components` instead of the default `@/components`,
you must add the `baseUrl`/`paths` config to **both** `tsconfig.json` (the root, references-only
file) **and** `tsconfig.app.json` — not just the latter. This matches shadcn's own Vite docs, but
it's easy to miss since your editor and `vite dev` both work fine with only `tsconfig.app.json`
configured (Vite reads `tsconfig.app.json` directly; only the shadcn CLI needs the root file too).

```jsonc
// tsconfig.json
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }],
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "~/*": ["./src/*"] }
  }
}
```

**Why this is required, not optional:** the shadcn CLI resolves your `components.json` aliases via
the `tsconfig-paths` package, which reads `tsconfig.json` directly and does not follow its
`references` array. If `tsconfig.json` has no `paths`, the CLI cannot resolve `~/components` to a
real directory — `shadcn init` will still report success, but `components.json` ends up with the
**literal alias string** unresolved, and the next `shadcn add` will write files into a directory
literally named `~` at your project root (e.g. `./~/components/ui/button.tsx`) instead of
`src/components/ui/button.tsx`. This is a CLI-side resolution gap (not something a registry can
work around from its own `registry.json`) — the fix has to happen in the consumer project's
tsconfig, as shown above. `scripts/registry-smoke.ps1` in this repo encodes the working
Vite + non-default-alias setup end-to-end, including this fix, and is the fastest way to confirm
a from-scratch consumer install is green.

### Base UI `select` may need `@floating-ui/react-dom`

`data-grid` pulls in shadcn's `select` primitive (used by the `select` cell type). On the Base UI
style, `@base-ui/react`'s select popup imports `@floating-ui/react-dom`. In some fresh consumer
setups this transitive dependency isn't hoisted and a production `next build` fails with
`Module not found: @floating-ui/react-dom`. If you hit this, add it explicitly:

```bash
pnpm add @floating-ui/react-dom
```

This is a Base UI / shadcn packaging gap, not gridcn-specific.
