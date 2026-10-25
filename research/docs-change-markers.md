# Docs change markers

Readers see which docs pages are new or updated in the current release series. The sidebar shows a dot; sections carry `<NewBadge />`.

## Rules

- A series is one minor version: 1.2.0, 1.2.1, 1.2.2 share markers. The next minor (1.3.0) starts a new series.
- The baseline of a series is the highest tag of the previous minor (1.2.x uses the last 1.1.x tag; 1.3.0 uses the last 1.2.x tag).
- A major bump is another minor boundary: 2.0.0 uses the last 1.x tag.
- When no tag of a lower minor exists (the first release, 1.0.0), the baseline is `null` and `pages` is empty.
- A page is `new` when it does not exist at the baseline. It is `updated` when its text differs from the baseline in substance. Wording-only edits (punctuation, whitespace, link targets, badges) do not count.
- Patch releases add to the markers of the series. They never remove them.

## Source of truth

`content/docs-changes.json`, committed:

```json
{ "version": "1.2.0", "baseline": "v1.1.0", "pages": { "addons/find-replace.mdx": "new" } }
```

- Page keys are paths relative to `content/docs`.
- Pages have no `status` frontmatter. The sidebar reads the file through the page-tree plugin in `lib/source.tsx`.
- The site builds from the committed file and needs no git history.

## Tool

`node scripts/docs-changes.mjs [--release <version>] [--check]`, run as `pnpm docs:changes`.

- Default version: `package.json`. The baseline follows from the version.
- Write mode compares the baseline with the tag `v<version>` when it exists, else with the working tree. It rewrites the file and removes every `<NewBadge />` whose line was not added since the baseline, so a series keeps its badges and a new series drops the old ones.
- `--check` recomputes from the tags and fails when the committed file differs; it never reads the working tree. It skips when the tag `v<version>` does not exist, when the baseline tag is missing locally, or when the clone is shallow.
- Prerelease versions (rc) are not supported by `--release`.

## Lint

`pnpm lint` runs `--check`: it fails when the committed file disagrees with the tagged release and on any `status:` frontmatter line in `content/docs`. Page dots appear when `pnpm docs:changes --release <version>` runs for the release, not in the commit that adds a page.

## Release procedure

Before the release commit, run `pnpm docs:changes --release <version>` and commit the result with the release. A patch release runs it too.
