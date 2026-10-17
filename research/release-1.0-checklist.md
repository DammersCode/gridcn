# Release 1.0.0 checklist

Manual steps for the maintainer. The branch `chore/improvement-plan` carries the changelog,
version, security policy, and templates. Nothing is pushed or tagged yet.

1. Review `git log` on `chore/improvement-plan` and push the branch.
2. Wait for CI on PR 72 to turn green, including `Build + registry` and the e2e install job.
3. Merge PR 72 into `main`.
4. Wait for the `Verify hosted registry` workflow on `main` to pass.
5. In a scratch Next.js app, run `npx shadcn add @gridcn/data-grid` against the hosted registry.
   Confirm it type-checks, builds, and renders a grid.
6. Create the tag `v1.0.0` on the merge commit and push it.
7. Check the pinned install: `npx shadcn add DammersCode/gridcn/data-grid#v1.0.0`.
8. Create the GitHub release `v1.0.0`. Use the `## 1.0.0` section of `CHANGELOG.md` as the body.
9. Close issues #58 to #61 (status bar, autosize, print, number format and link cells).
10. Enable GitHub private vulnerability reporting under Settings, Security, so the link in
    `SECURITY.md` works.
11. Announce the release.

Not part of 1.0:

- Issues #62 to #71 (W6-06 to W6-15) are post-1.0 roadmap.
- The manual NVDA and VoiceOver passes are pending. The docs state this.
- Firefox and Safari have no automated gate. The docs state this.
