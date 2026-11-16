## What and why

<!-- One short paragraph. Link the issue. -->

## Checklist

- [ ] `pnpm types:check` and `pnpm types:check:ts5`
- [ ] `pnpm lint` and `pnpm lint:typed`
- [ ] `npx vitest run registry --exclude "**/*.browser.test.*" --project unit --coverage`
- [ ] `npx vitest run --project browser --bail=1`
- [ ] Entry under `## Unreleased` for a user-facing change: a **Breaking** entry in `CHANGELOG.md`, any other entry in `CHANGELOG-2.0.md`
- [ ] Registry payloads in sync: `pnpm registry:build`, `node scripts/normalize-payload-eol.mjs`, `git add public/r`, `pnpm registry:verify`
- [ ] Matrix row updated in `research/parity-matrix.json`, then `node scripts/verify-parity.mjs --write`
- [ ] Docs updated per AGENTS.md
- [ ] No AI attribution in commits or this text
