# Empty-state wiring (workplan #38, finding 2)

## Problem

`labels.ts` defines `grid.emptyState` ("No rows") as a translatable string, but `root.tsx`
renders `emptyState ?? "No data"` from the `emptyState` ReactNode *prop* only — the label is
dead, and the actual fallback text is a hardcoded English literal that i18n consumers cannot
translate. This breaks the "every user-facing string lives in `labels`" promise.

## Decision

Wire the label as the default; keep the prop as the consumer override. Precedence:
`emptyState` prop (ReactNode, wins if provided) → `labels.grid.emptyState` (translatable
default). Delete the hardcoded "No data" literal. Default label text stays "No rows" (the
shipped labels default — adopting labels must not change visible copy, and "No rows" is the
string the i18n docs already list).

## Scope

- `root.tsx` (or wherever the zero-row branch renders): read `useDataGridLabels().grid.emptyState`
  as the fallback.
- Verify the zero-row branch actually renders in both zero-data and filtered-to-zero cases —
  the label's own comment claims it is "not yet wired to a renderer"; if NO empty-state UI
  exists at all for either case, add the minimal centered muted-text row (shadcn tokens,
  existing grid layout idioms) so the string has a surface. Confirm against the live app with
  a filter that matches nothing.
- Unit/browser test: filtered-to-zero shows the label text; a `labels` override shows the
  translated text; the `emptyState` prop still wins.
- i18n.mdx: the grid group's key list already mentions emptyState — confirm wording matches
  the now-real behavior.

## Out of scope

Illustration/empty-state art, per-cause messages (no-data vs no-matches split) — one string,
as typed today.
