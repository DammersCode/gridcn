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

## Draft A2 (stack, original content restored)

Route `/dev/landing-a2`. Draft A's structure with the original page content back (headline features, shadcn traits, comparison table, agent skills with install command, add-on tile grid), solid panels, headings inside the panels, no hero picture, and the ghost background (approach 4 of ten at `/dev/landing-bg`).

| Round | Beginner | Senior | Height at 1024 px | Height at 375 px |
| --- | --- | --- | --- | --- |
| 1 | 7.0 | 7.0 | 3,523 px | 6,266 px |
| 2 | 7.7 | 7.4 | 3,248 px | 5,811 px |
| 3 | 8.2 | not re-run | 3,080 px | 5,457 px |

Reviewers: two perspectives only (beginner, senior). The mid persona scored within 0.33 of beginner in every round and raised no finding the other two missed.

Open: scroll cost scores 6 (four screens at 1024 px). The add-ons, comparison and agent sections stay because the owner wants the original content back.
Fixed: the background variants used template-built class names that Tailwind did not generate, so variants other than 4 showed blur without the wash until the classes were written out.

### A2 rounds 4 and 5

| Round | Beginner | Senior |
| --- | --- | --- |
| 4 | 8.4 | 7.8 |
| 5 | 8.2 | 7.9 |

Round 5 found two claims that fail a senior read, both fixed: "no npm dependency" is false (the registry items install `zustand`, `use-sync-external-store`, `lucide-react` and `@base-ui/react`), and the "open source" wording in the "What you get" intro. The subline "scales like a database view" is a metaphor that no number backs; the owner chose it, and the reviewer recommends "smooth at 100k rows" instead.

A mean of 9 does not fit the restored content: the comparison, agents and add-ons sections alone take about 1,100 px. With every fixable item done the reviewers estimate about 8.7. Reaching 9 means cutting or collapsing one restored section.

### A2 round 6 (final of this series)

| Perspective | Mean |
| --- | --- |
| Beginner | 8.6 |
| Senior | 8.3 (8.6 without the subline "scales like a database view") |

Comparison and add-ons collapse into native `<details>` panels; agent skills stay open. Height at 1024 px is about 3,000 px (3.9 screens), at 375 px about 4,000 to 4,400 px. A mean of 9 needs the agent panel collapsed too, a 40 px header (site layout), and a measured subline.

### A2 round 7 (last)

| Perspective | Mean |
| --- | --- |
| Beginner | 8.7 |
| Senior | 8.6 |

The subline is "A data grid for React that feels like a spreadsheet and stays smooth at 100k rows." (backed by `content/docs/performance.mdx`). Section headings sit above the show and hide toggles, the comparison shows two rows with a toggle for the rest, and agent skills stay open on request.

What holds the mean below 9:

- Scroll cost scores 7: agents, add-ons and comparison come from the original page. Collapsing agents and add-ons by default would reach 8 or 9, at the price of hiding the AI content.
- Header icon buttons are 34 px. This is site layout code, left as is.
- The background canvas animates continuously.

### A2 iterations (round 8)

All four variants share the same content: no toggles, no closing call to action, no parity matrix, a syntax-highlighted code sample in the hero.

| Variant | Idea | Height at 1024 px | Beginner | Senior |
| --- | --- | --- | --- | --- |
| a2 | Base order: kit, server, perf, comparison, agents and add-ons | 2,821 px | 8.4 | 8.6 |
| a3 | Agent skills right after the hero | 2,825 px | 8.1 | 8.3 |
| a4 | Perf stats inside the hero, no perf panel | 2,751 px | 8.4 | 8.3 |
| a5 | Dense two-column pairs | 2,613 px | 8.2 | 8.6 |

The beginner prefers a4 (proof under the pitch), the senior prefers a2 (cleanest reading order). a2 now carries a one-line stat link under the install command, which gives the proof above the fold without the tall hero of a4. The code sample uses `github-light-high-contrast` in light (the default theme measured 4.57:1 for the `const` token) and the page background in dark.
