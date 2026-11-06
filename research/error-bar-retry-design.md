# Error bar Retry design

The built-in error bar showed an `outline` Retry button. `outline` is translucent (`bg-background`, `dark:bg-input/30`), so it blended into the `bg-destructive/10` bar and into the empty-grid state.

## Candidates

Each candidate was rendered in both bar states (rows present, empty grid), in light and dark, at radius 0, 0.625rem and 1rem, with a tinted primary and 14px and 18px base fonts.

- A. Filled `secondary` button with a `border-border` edge.
- B. Filled `destructive` button.
- C. Link-style action.
- D. Icon-only retry with `aria-label`.
- E. Alert layout with an `outline` action.
- F. Whole bar as one button.
- G. Candidate A with a leading retry icon.

## Scores

| Criterion (weight) | A | B | C | D | E | F | G |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Readability and contrast in every preset (30) | 27 | 14 | 15 | 17 | 20 | 18 | 28 |
| shadcn compatibility and presets (25) | 24 | 25 | 25 | 24 | 12 | 22 | 24 |
| Looks native (20) | 19 | 16 | 14 | 15 | 14 | 12 | 19 |
| Accessibility (15) | 14 | 14 | 11 | 11 | 14 | 9 | 14 |
| API and DX cost (10) | 10 | 10 | 10 | 10 | 6 | 4 | 9 |
| **Total (100)** | **94** | 79 | 75 | 77 | 66 | 65 | 94 |

## Decision

A wins on the tie-break against G: it adds no icon import to the core block.

- B is destructive-on-destructive: its tint matches the bar, so contrast stays low.
- C and D have a small or weak target and no button affordance.
- E needs an alert primitive that `components/ui` does not ship, and its `outline` action keeps the original translucency problem in dark mode.
- F makes the bar a second interactive region and hides the action in a text span.

Implementation: `<Button variant="secondary" size="xs" className="border border-border">` in `registry/default/blocks/data-grid/root.tsx`. The `errorState` node and function escape hatches are unchanged.
