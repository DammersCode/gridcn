# Pagination page-state in the URL (workplan #77)

User call (2026-08-01): the DIY-hook answer is not acceptable — pagination in the URL must
work out of the box. Backlog candidate promoted.

## Design

- The `data-grid-url-state` add-on grows one hook: `useDataGridUrlPagination(options?)` →
  `{ page, pageSize, onPageChange, onPageSizeChange }` — controlled-pair values the consumer
  spreads into `useDataGridPagination`/`<DataGridPaginationBar>`. nuqs stays the mechanism
  (it is the add-on's existing foundation; sort/filter/search already ride it).
- NO hard dependency between the two add-ons: url-state exposes plain numbers/callbacks;
  pagination consumes controlled props it already supports. registryDependencies unchanged
  except docs cross-reference.
- Param defaults: `page` (1-based in the URL, omitted when 1), `pageSize` (omitted when it
  equals the configured default). Options: param names, default pageSize. History behavior
  matches the add-on's existing sort/filter params (replace, not push) for consistency.
- Guardrails: invalid/out-of-range URL values clamp to valid (page ≥ 1; pageSize from the
  allowed sizes if the consumer passes them, else any positive int). Page resets to 1 when
  filters/search change IF the consumer wires it — document the one-line pattern; do not
  auto-couple (url-state cannot know the consumer's filter wiring).

## Tests

Browser: deep-link with ?page=3 opens on page 3; clicking page 2 updates the URL (replace);
pageSize change updates the URL; invalid values clamp; params omitted at defaults. Unit:
clamp/serialize logic pure functions.

## Docs

pagination.mdx: the DIY-hook section is REPLACED by the supported hook (example first);
url-state.mdx adds the pagination row to its coverage; both cross-link. The not-supported
register row flips to supported. Demo: extend data-grid-url-state-demo (or the pagination
demo) to show the composition — pick the one page where it reads best, judge and report.
