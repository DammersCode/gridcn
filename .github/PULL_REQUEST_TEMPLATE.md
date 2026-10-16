## What and why

<!-- One short paragraph. Link the issue. -->

## Checklist

- [ ] `pnpm types:check` and `pnpm types:check:ts5`
- [ ] `pnpm lint` and `pnpm lint:typed`
- [ ] `npx vitest run registry --exclude "**/*.browser.test.*" --project unit --coverage`
- [ ] `npx vitest run --project browser --bail=1`
- [ ] `CHANGELOG.md` entry under `## Unreleased` for a user-facing change (**Breaking** marker where it applies)
- [ ] Registry payloads in sync: `pnpm registry:build`, `node scripts/normalize-payload-eol.mjs`, `git add public/r`, `pnpm registry:verify`
- [ ] Docs updated, with `status` frontmatter or `<NewBadge />` per AGENTS.md
- [ ] No AI attribution in commits or this text
