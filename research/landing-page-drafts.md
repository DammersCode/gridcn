# Landing page drafts (release 2.0)

Three dev-only drafts. Routes: `/dev/landing-a`, `/dev/landing-b`, `/dev/landing-c`. Code: `app/dev/landing*`. Delete these folders when a draft is chosen. Rubric: `landing-page-scoring.md`.

All drafts share the same content and the same parts:

- Background kept and pushed back with a blur plus a theme-colored wash.
- Hero shows a static, non-interactive grid picture. No grid code loads on first paint.
- Parity counts are read from `research/parity-matrix.json`: 32 features, 8 modes, 204 of 256 cells supported, 30 not applicable, 22 known gaps. Link to `/docs/data-modes`.
- Server highlights: lazy rows, pagination, server sort and filter, saves with rollback, pinned rows and aggregates, import and export, debounced inputs, saved views.
- Performance: only three measured values, each with its source.
  - 0.3–7.6 ms streaming sort update (`content/docs/streaming-updates.mdx`).
  - 51 ms text sort, down from 68 ms (`CHANGELOG.md`).
  - 16.8 ms longest frame on jump scroll, down from 91.7 ms (`content/docs/performance.mdx`).
- Dropped from the old page: "~33 MB working set" and "0 renders on scroll". No repo file backs them. No 1M-row claim.

## Drafts

| Draft | Idea | Height at 1024 px | Background |
| --- | --- | --- | --- |
| A, Stack | Centered hero, picture, then performance, server mode, parity bars, kit. One column. | about 1,900 px | uniform veil |
| B, Split | Text left, picture right, bento of parity heatmap and performance, server cards, kit. | about 2,100 px | veil stronger in the center column |
| C, Tabs | Short hero, picture, one tabbed panel (server mode, parity, performance, kit). | about 1,230 px | uniform light veil |

## Scores

Opus reviewers scored each draft in a browser at 1024 px and 375 px, dark and light. Round 2 is the current state. In round 2 the browser pane was hidden, so most checks used the DOM and computed styles, not screenshots.

| Draft | Round | Beginner | Mid | Senior |
| --- | --- | --- | --- | --- |
| A | 1 | 6.89 | 7.00 | 6.33 |
| A | 2 | 7.78 | 7.89 | 7.11 |
| B | 1 | 7.11 | 7.22 | 6.56 |
| B | 2 | 7.44 | 7.33 | 6.89 |
| C | 1 | 7.22 | 7.56 | 7.00 |
| C | 2 | 7.89 | 8.11 | 7.78 |

Mid scores sit within 0.11 of beginner in every round. Mid differs from senior by 0.33 to 0.78. The senior view finds the issues the others miss (sources, tap sizes, landmarks), so all three personas stay.

B's round 2 mobile score of 3 came from a real horizontal overflow at 375 px (install command widened the hero grid). The fix is committed (`grid-cols-1`, `min-w-0`) but no reviewer has checked it. The reviewer's own estimate without the overflow was about 7.9, 7.8 and 7.3.

## Pros and cons

**A, Stack.** Simple, linear, easy to extend. The parity bars show per-mode coverage at a glance. Cost: about 2.4 screens, and the proof sits far below the picture.

**B, Split.** Strongest first screen on desktop: pitch and grid side by side. The heatmap shows the whole matrix in one image. Cost: tallest page, the tall matrix card leaves dead space next to the performance card, and it stacks to about 4.6 screens on a phone.

**C, Tabs.** Shortest page (about 1.3 screens at 1024 px), best scroll cost, and the best scores for all three personas. Cost: proof is hidden behind tabs, so a reader sees one proof block at a time. Tab content does not appear in a quick scan.

## Recommendation

Ship C, with the open items below. It leads every persona in both rounds and answers the request for less scrolling. If the team wants all proof visible without a click, A with the same fixes is the fallback.

## Why none is a 10

The best draft, C, scored 7.9 on average. Remaining gaps and why:

- **Version badge.** The hero says 2.0 while the site header says 1.3.0. The header shows the package version and will read 2.0 at release. Not a draft problem.
- **Install tabs, copy button and header logo are 24 to 28 px tall.** They come from `components/install-command.tsx` and the shared layout, which this task does not change. Raise them to 40 px on mobile in the implementation stage.
- **Install command scrolls sideways inside its box at 375 px.** The box now scrolls by itself, so the page does not overflow. A shorter command on phones is a design decision for stage 2.
- **Saved views link** points to `/docs/addons/views`, which exists on a sibling branch and 404s here.
- **Screenshot coverage.** Round 2 lacks screenshots of the light theme and the static hero, so Dark and light is carried over from round 1.
- **The pitch line "smooth at 100k rows"** has no inline source. Link it to `/docs/performance` in stage 2.

## Open questions

- Which draft, or which parts of two (for example C's tabs with B's split hero)?
- Show only the tab labels on first view, or open on "Server mode" (current)?
- Restore the "~33 MB" and "0 renders" claims only if someone supplies a measurement and a source.
