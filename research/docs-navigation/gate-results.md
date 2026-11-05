# Accessibility and mobile gate (A10), first run

Run on the docs shell (the real sidebar, tabs, and page layout that every candidate uses), on one prototype page, with a
script in the browser. The navigation structure does not change these results. They are layout work for the migration
(`components/docs-sidebar.tsx` and the docs layout).

| Check | Result | Note |
|---|---|---|
| Main landmark or skip link | pass | One `main` element |
| Labelled `nav` landmark for the sidebar and for "On this page" | fail | The page has no `nav` or `role=navigation` element |
| Current page marked with `aria-current="page"` | fail | The active link carries a data attribute, not `aria-current` |
| Collapsible groups as a disclosure (`button` with `aria-expanded`) | partial | Group rows are links with a chevron; two `aria-expanded` buttons exist |
| Sidebar links at least 24 by 24 CSS px | pass | 16 visible links, none smaller |
| No horizontal scroll at 1280 px | pass | |
| No horizontal scroll at 375 px | pass | |
| Menu control labelled with text at 375 px | fail | The sidebar opens from an icon button with an `aria-label` and no visible text |
| Area switcher reachable in one tap at 375 px | fail | The switcher sits inside the sidebar, so it takes two taps |
| Same sidebar order on every page of an area | not run | The order comes from one tree, so it holds by construction |

Result: 4 checks fail and 1 is partial. Fixing them is part of the layout work in the migration plan.
