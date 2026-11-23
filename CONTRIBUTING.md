# Contributing to gridcn

## Language

Everything in this repository is written in English: code, comments, documentation, plans, the changelog, commit messages, and pull-request text.

## Vocabulary

Use the words in [GLOSSARY.md](GLOSSARY.md) in code, comments, docs, and commit messages. Add a term there before you introduce it. `pnpm lint` rejects the words the glossary replaces.

## Development

Contributions are licensed under the Apache License 2.0. See section 5 of `LICENSE`.

```bash
pnpm install        # deps (pnpm 10+)
git config core.hooksPath .githooks   # once per clone: commit-msg hook rejects AI attribution
pnpm dev            # docs site + demos at http://localhost:3000
```

Useful pages while developing: `/dev` (configurable 100k-row grid), `/docs` (every demo).

```bash
pnpm types:check
pnpm types:check:ts5             # consumer TypeScript 5.9 baseline
pnpm lint
pnpm lint:typed
npx vitest run registry tests --exclude "**/*.browser.test.*" --project unit --coverage   # jsdom suite
npx vitest run --project browser --bail=1   # real-Chromium suite
```

[DEVELOPMENT.md](DEVELOPMENT.md) and `AGENTS.md` list the full gate order and the extra CI steps to mirror before a push.

After changing anything under `registry/` or `registry.json`:

```bash
pnpm registry:build   # shadcn build + import rewrite
pnpm registry:verify  # payload-content + manifest gates
```

Commit the regenerated `public/r/` payloads together with the source change.

## Before you commit

A change carries its duties in the same commit:

- A user-facing change to the registry or to the docs examples gets an entry under `## Unreleased` in `CHANGELOG.md`.
- A feature that touches a data mode updates its row in `research/parity-matrix.json`. Then run `node scripts/verify-parity.mjs --write`.
- A new demo gets an entry in `components/registry-examples.tsx`.
- The gates in the `Workflow` section of `AGENTS.md` are green.

## Repository structure and file granularity

These rules apply to every block under `registry/default/blocks/`. They keep a block easy to navigate when it grows past about 100 files. They also keep the tree that `npx shadcn add` ships easy for consumers to read.

1. **Group by domain inside a block.** The block root keeps only the spine:
   - the barrel (`<block>.ts`, or the root component file `<block>.tsx` when one exists, such as `data-grid.tsx` or `data-grid-url-state.tsx`, so there is no separate `-index` file)
   - the provider and the store
   - the root, header, body, row, cell, and overlay components
   - `types.ts`, `layout-context.ts`, and `labels.ts`

   Everything else lives in a domain folder, such as `selection/`, `clipboard/`, `columns/`, `cell-types/`, `keyboard/`, `virtualization/`, `sort-filter/`, `rows/`, or `interaction/`.
2. **No single-file directories.** A folder holds two or more files. If a domain holds one file, that file stays at the block root.
3. **Tests sit next to the source they test.** A domain can group its tests in a `test/` subfolder. Rule 2 applies to it: no single-file `test/` folders. A test that exercises the whole block, not one domain, lives in a block-root `test/` folder.
4. **Nest at most two folder levels inside a block.** `data-grid/validation/test/` is the deepest allowed path.
5. **Merge tiny sibling files into one file named for the concept.** Small related functions belong together. A symbol gets its own file only when it is large (about 200 lines or more) or stands alone. See `selection/rects.ts` (six rect-geometry functions of about 10 lines each) and `columns/pin-offsets.ts` (`pinLeftOffsets` and `pinRightOffsets`). A merge keeps every export. The code moves to a new path and stays importable.
6. **A domain folder that other domains import gets an `index.ts` barrel.** The block-root barrel (for example `data-grid-toolbar.ts`) is the consumer's import surface:
   - Export from it only what the docs teach the reader to call. See "Registry exports" in `AGENTS.md`.
   - Add-ons import the internals of the core through `data-grid-sdk`.
   - Inside a block, import the file that defines the symbol. Use the `index.ts` of a domain where several other domains import from it.

   One exception keeps the server and client boundary clean. A Server Component that needs only a leaf value, such as a plain constant with no React dependency, can import the leaf file directly. This keeps client-only sibling modules out of the server tree. Add a one-line comment that says why. `components/keymap-table.tsx` shows the pattern.
7. **Registry target paths mirror the repository structure.** Each `files[].path` entry of a block in `registry.json` matches the file on disk. The `target` field of a file sets where it installs. Update `target` together with `path`. Item names never change when files move.
8. **Use kebab-case filenames.** A source file has at most 800 lines and a test file at most 1500 (`scripts/verify-source-size.mjs`). A larger file keeps its ceiling in `scripts/source-size-baseline.json` and never grows past it.

### How to add a new file or domain

- **A function or component in an existing domain:** put the file in that domain folder. Export it from the `index.ts` of the domain if the domain has one. Re-export it from the block-root barrel if it is part of the public API. Add a `*.test.ts(x)` file next to it.
- **A new domain:** create a top-level folder only when two or more files belong together (rule 2). Give it an `index.ts` barrel from the start.
- **A new file that might merge into an existing one:** merge it (rule 5), unless the new code is large or has no natural sibling.
- **Cycle check:** before you wire the `index.ts` of a domain into another module, check that the module is not a dependency of anything inside the domain. `store/` is the usual cause: several domains import it, so they import `../store` directly and not through a barrel that can import back into the dependency chain of `store/`. When in doubt, import the specific file you need.
- **Registry bookkeeping:** after you move or add files, regenerate the `files` array of the affected item in `registry.json`, so it matches the filesystem. `scripts/verify-registry.mjs` is the CI check for this.

See `PLAN.md` section 12 for the other coding conventions: naming, comments, the coverage bar, and commit style.
