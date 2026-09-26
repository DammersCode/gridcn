---
name: gridcn-upgrade
description: "gridcn upgrades: update gridcn source installed in this project to a newer upstream release. Use when pulling a newer gridcn version or one upstream fix, or when installed files carry local edits that must survive."
---

gridcn ships no npm package and no semver: `npm update` touches nothing, and a breaking change can
land in any 0.x minor (see the changelog's `**Breaking:**` entries). "Updating" means re-running the
install command and reconciling upstream's copy against your local one, file by file.

Scope: updating installed gridcn source. Adding an add-on for the first time → `gridcn-addons`.

## 0. Ask where the upgrade happens

Run `git rev-parse --abbrev-ref HEAD`.

- **Command fails (no Git repository):** work in place. Step 3 then starts with a consent gate.
- **Command prints a branch name:** ask the user one question before any other step, and wait for
  the answer: "Upgrade gridcn on the current branch `<branch>`, or on a new branch
  `chore/gridcn-upgrade`?" Then switch to the branch the user picks
  (`git switch -c chore/gridcn-upgrade` for a new branch).
- **Command prints `HEAD` (detached):** ask only for the new branch name, then create it.

Done when the user answered and the working branch is the one they picked, or the project has no Git.

## 1. Find what changed

Read gridcn's changelog
(`https://raw.githubusercontent.com/DammersCode/gridcn/main/CHANGELOG.md`) top to bottom. If you don't know
which version is installed, there is no version file to check — compare against `git log` on your
installed files instead (`git log -- components/data-grid`) and match the oldest relevant commit
date to the changelog's entries. Note every `**Breaking:**` entry between that point and now; each
names the exact replacement. Done when you have a list of Added/Changed/Fixed entries and which
`**Breaking:**` ones apply to items you have installed.

## 2. Classify every installed file before touching it

For each installed item (check `components.json` for your aliases, then look under
`aliases.components` for `data-grid*` folders), run:

```
npx shadcn add @gridcn/<item> --dry-run
```

This prints a per-file status (identical, changed, new) without writing anything. In a Git
project, commit or stash uncommitted work first: the next steps overwrite files. Sort the output into two piles:

- **Identical or upstream-only-changed** (you never touched it): safe to overwrite outright.
- **Locally edited** (status shows a diff against your copy): needs reconciliation, not a blind
  overwrite.

Done when every file the dry-run lists has a pile.

## 3. Apply the update per pile

**Consent gate, projects without Git only.** Before the first write, list every file the reinstall
will overwrite (including `components/ui/*`), end your turn with the question "Overwrite these
files?", and wait for the user's yes. The gate holds even when the files look re-derivable from the
registry, when you made a backup, or when you plan to re-add local edits afterwards: without Git,
the user decides.

A reinstall with `--overwrite` rewrites every file of the item, edited ones included, and the shadcn/ui
primitives it depends on (`components/ui/*`). Save the locally edited files first, and review every
`components/ui/*` change afterwards: restore any primitive the user customized.

- **Unmodified files**: re-run the real install command for the item to pick up upstream:
  ```
  npx shadcn add @gridcn/<item>
  ```
  To pin a specific tag, branch, or commit (for grabbing one upstream fix without moving to the
  latest of everything), use the GitHub registry path with a `#<ref>` suffix instead of `@gridcn`:
  ```
  npx shadcn add DammersCode/gridcn/data-grid#v1.0.0
  ```
  Without `#<ref>` this path installs the repository's default branch — same content as `@gridcn`.
- **Locally edited files**: never let the reinstall silently clobber them. Inspect first with:
  ```
  npx shadcn add @gridcn/<item> --diff <path-to-file>
  ```
  For a file with many local edits, a single `--diff` is hard to read; instead install the item into
  a scratch branch and compare the two trees (`git diff --no-index <old> <new>`), then re-apply your
  edits on top of the upstream version by hand or with `git merge-file`.

Done when every locally edited file's upstream changes are merged in and your local edits still
apply, and every unmodified file matches the new upstream content.

## 4. Re-check the seams the CLI can silently get wrong

- **Barrel imports**: keep importing from the item's public barrel (e.g.
  `@/components/data-grid/data-grid`, `@/components/data-grid-history/data-grid-history`), never
  from an individual file inside the folder — file-level layout inside an item can change between
  releases even when the barrel's exports don't.
- **Non-default aliases**: if `components.json` uses non-default `aliases.components`/`ui`/`lib`/
  `hooks`, re-check that the reinstall rewrote internal imports to your aliases correctly. A missing
  alias entry makes some CLI versions leave an import unresolved and others rewrite it wrong — fix
  any bad import lines by hand rather than fighting the resolver.
- **New npm dependency**: an add-on's dependency table can gain an entry between releases; check
  `package.json` against the current table in the installation doc, not just against what you
  remember installing.

## Done when

Every installed file is either confirmed identical to upstream or has its local edits re-applied on
top of the new upstream version; every `**Breaking:**` changelog entry between your old and new state
has its replacement applied; your project's typecheck and build pass; and the smoke test from the
installation doc's Verify section (add the quick-start columns/data to a page, click a cell, type a
value, press Enter, confirm the grid renders styled) passes.

## Docs

- Update procedure and changelog discipline: `https://gridcn.vercel.app/docs/project-status.md`
- Install commands, aliases, barrel import paths, non-default alias pitfalls, and the Verify smoke
  test: `https://gridcn.vercel.app/docs/installation.md`
- Full changelog: `https://github.com/DammersCode/gridcn/blob/main/CHANGELOG.md`
