# Landing page scoring rubric

Used to score the landing page drafts. Each criterion gets an integer from 1 to 10. A reviewer scores from one developer perspective:

- **Beginner**: new to data grids, wants to know in seconds what this is and how to start.
- **Mid**: ships grids at work, compares libraries, wants proof and the install path.
- **Senior**: evaluates for a team, distrusts claims, checks numbers, accessibility and page weight.

A 10 means there is nothing the reviewer would change. Name the specific element behind every score below 10.

## Criteria and anchors

| Criterion | 2 | 5 | 8 | 10 |
| --- | --- | --- | --- | --- |
| Visual hierarchy | No clear first read; sections look equal. | Headline is clear; the order after it is guesswork. | Reading order is obvious; one or two competing blocks. | One path: headline, proof, action. Nothing competes. |
| Readability over the background | Text fights the animation. | Body text is readable; small text or borders blur into it. | All text readable; the background is a faint texture. | Every text size passes WCAG AA, the background stays recognizable, and it never pulls the eye. |
| Scroll cost | Long page, large gaps, repeats itself. | Reachable content, but gaps and padding waste screens. | Few screens; some padding slack. | The whole pitch fits in about two screens at 1024 px wide, without cramping. |
| Pitch in 10 seconds | Reader cannot say what it is. | Reader knows it is a grid, not why it is different. | Reader knows what it is and one differentiator. | Reader can say what it is, who it is for, and why it beats a plain table, with no scroll. |
| Trust and credibility | Superlatives, no numbers. | Numbers without context. | Numbers with units, conditions and a link to the source. | Every number names its condition and source, gaps are admitted, nothing is unproven. |
| Accessibility | Keyboard or contrast failures. | Mostly operable; missing names or focus styles. | Landmarks, headings, labels, focus visible; minor issues. | Keyboard-complete, correct roles, AA contrast, reduced-motion respected, color is never the only signal. |
| Mobile (375 px) | Horizontal scroll or clipped content. | Works, but dense or awkward. | Clean stack; one cramped block. | Thumb-friendly, no horizontal scroll, the demo and the matrix remain usable. |
| Page performance | Heavy first load, layout shift. | Acceptable; the demo loads eagerly. | Demo loads lazily, small shift. | Demo loads when needed, no layout shift, no long task on first load, background costs little. |
| Dark and light | One theme is broken. | Both work; one looks unfinished. | Both work and look intentional. | Both themes are equally polished; contrast holds in each. |

## Rules for reviewers

- Look at the page in a real browser at 1024 px and 375 px, in dark and light, at the top and after scrolling to the end.
- Judge the page you see. Do not score what the code might do.
- A claim that the page makes about numbers must match `CHANGELOG.md`, `content/docs/performance.mdx`, `content/docs/streaming-updates.mdx`, or `research/parity-matrix.json`. A number that no file backs caps Trust at 4.
- Report each criterion as `criterion: score: one-line reason`, then list the five changes that raise the lowest scores.
