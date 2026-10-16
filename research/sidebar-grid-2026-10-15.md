# Docs sidebar: grid canvas (implementation decision record)

Date: 2026-10-15. Design approved by the user through screenshot rounds (prototype scripts in
`%TEMP%/opencode/sidebar-v5*.cjs`, no repo changes until this spec).

## What

The docs sidebar renders as one continuous table: uniform 36px rows, 1px line at every row
boundary, every element its own bordered cell.

- Row cells: [gutter 22px x depth][content: icon + title + status dot][chevron cell 28px].
- Gutter cells: flat and empty (no glyph). Nesting depth is carried purely by the number of
  gutter columns; the elbow arrow that used to sit in the last one is removed by design.
- Chevron cell: present on every nested row; leaf rows get an empty ghost cell so the column
  divider line runs unbroken through multi-open states. Folder triggers carry the group band
  (muted 30% background + 600 weight) via a builder-assigned class.
- Section headers: real rows styled as Data Grid header cells (header-cell.tsx tokens): 36px
  (HEADER_HEIGHT), `bg-muted` (solid), `border-b border-border`, `px-2`, `font-medium`, default
  `--color-foreground`, `select-none`, no margins.
- Focus ring: on click/keyboard focus a row shows a 2px inset primary ring, matching the Data
  Grid's active-cell overlay (`ring-2 ring-inset ring-primary` in data-grid/overlays.tsx). Uses
  `:focus` (not `:focus-visible`) so a mouse click shows it too. Drawn on the `.nav-content` cell so
  it wraps the title/icon only, not the gutter (nesting offset) or the chevron column. The
  `.nav-content` is `align-self: stretch` (full row height) so the ring sits snug on the top/bottom
  border lines instead of floating as a short centered box.
- Sidebar width: 312px at md+ (fumadocs default 268px).

Banned/decided out: row-index column, double-left-line, chevron box-in-box, the elbow arrow
glyph (removed 2026-10-15, user request, simplifies the table), `:has()` in shipped theme CSS
(repo policy: document-wide invalidation risk).

## How

- `app/global.css`: all rules scoped to `#nd-sidebar`, plus the width override
  `#nd-docs-layout[data-sidebar-collapsed] { --fd-sidebar-width: 312px }` at md+. That selector
  ties the fumadocs `#nd-docs-layout:has(...)` width rule at (1,1,0) and wins on source order
  (our sheet loads after fumadocs'). No `:has()`.
- `components/docs-sidebar.tsx` ("use client"): `Item` and `Folder` overrides passed as `DocsLayout`
  `sidebar.components`. They render the gutter, content, ghost-chevron cells and the `nd-nav-band`
  class in the server HTML, so the first paint already shows the grid. Folder chevrons are
  fumadocs' own svg, styled as the cell in CSS (divider drawn by `::after`).

## DOM contract (native markup, fumadocs-ui base.js)

- Rows: `a/button.relative.flex.flex-row.gap-2.p-2`, inline `padding-inline-start`.
- Titles are bare text nodes; status dot and page icon are element children.
- The folder chevron is the only direct-child svg with a `data-icon` attribute (base.js passes
  `"data-icon": true` to ChevronDown; page icons carry no such attribute). The click handler
  checks `e.target.matches("[data-icon], [data-icon] *")`, so wrapping the svg in a span keeps
  folder toggling working.

## Hard-won constraints (measured, do not regress)

- The Radix viewport ships `*:flex! *:flex-col! *:gap-0.5!` child utilities; the frame gap only
  zeroes with an inline `!important` declaration (set by the builder). A stylesheet rule at
  (1,1,0) loses to it despite higher specificity than the utility.
- Nested content wrappers are `.flex.flex-col.gap-0.5.pt-0.5`: zero both `gap` and `padding`,
  or the first child of every folder sits 2px below its trigger (visible chevron-column break).
- Titles: move the existing text node into the `.nav-title` span (do not replace it) so React
  in-place text updates keep hitting the live node.
- fumadocs ships a 1px left indicator line on the active item via `::before`
  (`data-[active=true]:before:*`). It only shows on pages where the active row is a folder-page
  (e.g. `/docs/examples/validation` -> "Editing & Validation"), so it is invisible when testing
  on `/docs`. Suppress it with `#nd-sidebar a[data-active="true"]::before { display: none }` so
  the inset border is the only active marker.
- fumadocs ALSO draws a depth-1 "tree connector" line via `::before` on each top-level folder's
  collapsible content (`SidebarFolderContent` at `depth === 1` in docs/slots/sidebar.js:
  `before:w-px before:inset-y-1 before:bg-fd-border before:inset-s-2.5`). It renders at x=16+10px
  (inside the first gutter column) and only at depth 1, so it looks like a stray vertical line
  through the first nesting level. The gutter columns already encode nesting, so suppress it with
  `#nd-sidebar div[data-state] > div.overflow-hidden::before { display: none }`. Verified by
  pixel scan: the x=26 column goes from lum 222 (line) to 248 (background).
- Measured budgets at 312px: depth-0 ~238px, depth-1 folder ~188px, depth-1 page ~210px,
  depth-2 ~166px; only "Lazy loading: data fetching" ellipsizes.
