<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Code Comments

Write a comment only when the code cannot say it. The code says *what*; the comment says the *why* the code cannot express.

- Default: no comment. A good name or structure beats any comment.
- Add a comment only for one of: a non-obvious constraint outside the code (browser quirk, platform limit, an invariant the types cannot express); a workaround for an external bug (name the bug); a deliberate simplification and its ceiling (state the upgrade path); a public API's semantics the signature does not show (JSDoc).
- Delete instead of writing: restatements of the line below; pointers to other code ("memoized like X" — read that code instead); history ("used to ..."); references to external tracking (plan, spec, workplan, advisor, or finding IDs such as "G5", "plan 012", "spec 4b", "workplan #80"); commented-out code; markers that name the obvious.
- One idea per comment, at most 25 words, one line. Short plain English: active voice, condition before statement, no "should", "could", "may".
- JSDoc (`/**`) documents the API for its users; keep it well-formed (tools parse it). `//` comments note implementation details for the file's readers only.
- Test names carry the spec. Comment a test only for non-obvious setup or the reason an assertion exists.
- When you edit a comment that no longer earns its place, delete it.

Examples:

- Before: `// Memoized like the overlay node.` → After: (delete)
- Before: `// Quick-search never narrows viewIndex (PLAN §3, perf spec 6).` → After: `// Quick-search highlights and navigates; it never filters.`
