# Contributing to gridcn

## Development

Contributions are licensed under the GridCN Source Available License — see LICENSE §8.

```bash
pnpm install        # deps (pnpm 10+)
pnpm dev            # docs site + demos at http://localhost:3000
```

Useful pages while developing: `/dev` (configurable 100k-row grid), `/docs` (every demo).

```bash
pnpm test -- --project=unit      # jsdom suite
pnpm test -- --project=browser   # real-Chromium suite (Playwright provider)
pnpm types:check
pnpm lint
```

After changing anything under `registry/` or `registry.json`:

```bash
pnpm registry:build   # shadcn build + import rewrite
pnpm registry:verify  # payload-content + manifest gates
```

Commit the regenerated `public/r/` payloads together with the source change.

## Repository structure & file granularity

These rules govern every block under `registry/default/blocks/`. They exist so a block stays
navigable as it grows past ~100 files, and so `npx shadcn add` ships a tree consumers can
actually find their way around in.

1. **Group by domain inside a block.** The block root keeps only the *spine*: the barrel
   (`<block>.ts` — or the root component file `<block>.tsx` doubles as the entry point when one
   exists, e.g. `data-grid.tsx`/`data-grid-url-state.tsx`, so there's no separate `-index` file),
   the provider/store, root/header/body/row/cell/overlays components, `types.ts`,
   `layout-context.ts`, and `labels.ts`. Everything else lives in a domain folder (`selection/`,
   `clipboard/`, `columns/`, `cell-types/`, `keyboard/`, `windowing/`, `sort-filter/`,
   `rows/`, `interaction/`, …).
2. **No single-file directories.** A folder must contain 2+ files or it doesn't exist — if a
   domain would only ever hold one file, that file stays at the block root instead.
3. **Tests live in a `test/` subfolder inside their domain folder** — except when a domain has
   only *one* test file, which stays colocated next to the source it tests (rule 2 applies to
   `test/` too: no single-file `test/` folders). Cross-domain integration/browser tests that
   exercise the whole block (not one domain) live in a block-root `test/` folder instead.
4. **Max two folder levels inside a block** — `data-grid/clipboard/test/` is the floor; nothing
   nests deeper.
5. **Merge tiny sibling files into one concept-named file.** Closely-related small functions
   belong together in one file; a symbol only earns its own file when it's large (roughly
   200+ lines) or genuinely standalone. This replaces the older one-symbol-per-file rule — see
   `selection/rects.ts` (six ~10-line rect-geometry functions merged into one file) and
   `columns/pin-offsets.ts` (`pinLeftOffsets` + `pinRightOffsets`) for the canonical examples.
   All of the merged file's exports are preserved; nothing that was previously importable stops
   being importable, it just moves to a new path.
6. **Every domain folder gets an `index.ts` barrel.** The block-root barrel
   (e.g. `data-grid-toolbar.ts`) remains the **only** public entry point — docs, consumer code, and
   other registry items must never deep-import a domain's internals directly. If you need a
   symbol from inside a domain, it must be re-exported from the block-root barrel (add it there
   if it's missing).

   The one exception is server/client boundary hygiene: a Server Component that only needs a
   leaf value (e.g. a plain constant with no React dependency) may import that leaf file directly
   instead of through the barrel, specifically to avoid pulling client-only sibling modules into
   a server-rendered tree. Leave a one-line comment explaining why when you do this — see
   `components/keymap-table.tsx` for the existing example.
7. **Registry target paths mirror the repo structure.** `registry.json`'s `files[].path` entries
   for a block always match that block's on-disk tree exactly; there's no separate flat
   `target` override. Item names never change when files move.
8. **Kebab-case filenames.** Soft caps of ~200 lines for component files and ~100 lines for
   function files apply to *new* code; a merged file (rule 5) is allowed to exceed these since
   it's still several small, distinct concerns living together, not one sprawling one.

### How to add a new file or domain

- **Adding a function/component to an existing domain:** put the file in that domain folder,
  export it from the domain's `index.ts`, and re-export it from the block-root barrel if it's
  part of the public API. Add a colocated `*.test.ts(x)` next to it.
- **Adding a genuinely new domain:** only create a new top-level folder once you have 2+ files
  that belong together (rule 2). Give it an `index.ts` barrel from the start.
- **Unsure whether a new file deserves its own file or should merge into an existing one:**
  default to merging (rule 5) unless the new code is large or has no natural sibling.
- **Cycle check:** before wiring a domain's `index.ts` into another module's imports, check
  whether that module is itself a dependency of anything inside the domain (`store.tsx` is the
  usual culprit — it's imported by several domains, so those domains' files should import
  `../store` directly rather than through a barrel that could re-import back into `store.tsx`'s
  own dependency chain). When in doubt, import the specific file you need rather than a barrel.
- **Registry bookkeeping:** after moving/adding files, regenerate `registry.json`'s `files` array
  for the affected item(s) so it matches the filesystem (see `scripts/verify-registry.mjs`,
  which is the CI-enforced source of truth for "does the registry item match disk").

See `PLAN.md` §12 for the rest of the project's coding conventions (naming, comments, coverage
bar, commit style).
