# Content map: new page slugs to current sources

Used by the candidate files and the migration plan. "new" means new text; "move" means the text moves with light edits;
"split" means one current page becomes several. Section names are current H2 titles.

| Slug | Source (current page and sections) | Kind |
|---|---|---|
| index | `index` (credits move to a section of the support and security page) | rewrite |
| install | `installation` (prerequisites first, add-on picker last) | rewrite |
| first-grid | `quick-start` (first grid only) | split |
| terms | `terms` | move |
| learn-columns, learn-edit, learn-select, learn-sort, learn-save, learn-style | `quick-start` (going controlled, undo and redo), demos from `examples/**` | new text, reused demos |
| landings* | none | new (one line per child) |
| edit-activation | `editing-cell-types` (Edit activation, Read-only) | split |
| cell-types | `editing-cell-types` (Built-in cell types) | split |
| validation | `editing-cell-types` (Validation) | split |
| server-errors | `editing-cell-types` (Server errors) | split |
| display-override | `editing-cell-types` (Display override without a new type) | split |
| clipboard | `clipboard` (async paste contract becomes a link) | move |
| custom-cell-model | `custom-cell-types` (The mental model, Keypoint checklist) | split |
| ref-celltype | `custom-cell-types` (The contract, member by member) and `api-reference` (CellType) | merge |
| custom-cell-example | `custom-cell-types` (Worked example, Testing your cell type) | split |
| selection-model | `selection-keyboard` (Selection model, Configurability) | split |
| pointer-selection | `selection-keyboard` (Mouse gestures, Touch gestures, Header click behavior) | split |
| checked-rows | `selection-keyboard` (Checking a range of rows, Checked rows, Checking rows by keyboard) | split |
| keyboard-nav | `selection-keyboard` (Keyboard map, Moving rows, Opening the column filter, Two-stage Ctrl+A, Undo and redo outside the grid) | split |
| server-selection | `selection-keyboard` (Selection over a server result) | split |
| global-shortcuts | `global-shortcuts` | move |
| sorting, filtering, quick-search | `sorting-filtering-search` (Sorting, Filtering, Search) | split |
| sorting | `sorting-filtering-search` (Initial sort, filter, and search) | merge |
| sort-list | `addons/sort-list`, `sorting-filtering-search` (Sort list) | merge; the add-on keeps its own page |
| server-sort-filter | `sorting-filtering-search` (Controlled mode), `recipes/data-fetching/server-side-sort-filter` | merge |
| toolbar | `addons/toolbar` (Wiring, The pieces) | split |
| header-filter | `addons/toolbar` (Header filter, Filter menu keyboard) | split |
| find-replace | `addons/find-replace` | move |
| url-state | `addons/url-state` (options table to `url-state-options` in C3) | move |
| row-operations | `row-operations` (Enable props, Confirm a delete, Default shortcuts, Context menu) | split |
| row-reorder | `row-operations` (Reorder) | split |
| row-markers | `row-operations` (Row markers) | split |
| row-operations-code | `row-operations` (Programmatic actions) | split |
| server-row-ops | `row-operations` (Scroll mode), `data-modes` (Notes) | split |
| pinned-rows | `addons/pinned-rows` | move |
| fill | `addons/fill` | move |
| context-menu | `addons/context-menu` | move |
| keybindings | `addons/keybindings` | move |
| status-bar | `addons/status-bar` | move |
| column-sizing | `columns` (Resize, Autosize, Flex fill) | split |
| column-order-pin | `columns` (Reorder, Pin start/end) | split |
| column-headers | `columns` (Custom headers, Column groups) | split |
| column-visibility | `columns` (Visibility, Reading column state) | split |
| style-tokens | `styling-theming` (The color scheme, CSS variables, Visual defaults), new radius section | split plus new text |
| ref-style-surface, styling-model | `styling-theming` (The built-in class surface, Data-attribute contract) | split |
| style-overrides | `styling-theming` (Override recipes, Programmatic per-row/per-cell styling, Styling by state with CSS only) | split |
| style-density | `styling-theming` (Small screens, Density and row height, Scroll shadows) | split |
| loading-state | `styling-theming` (Loading state) | split |
| i18n | `i18n`, `styling-theming` (i18n via labels) | merge |
| undo-redo | `addons/undo-redo` (How it works, Quick start, Composable, Read-only, Capped stack) | split |
| undo-programmatic | `addons/undo-redo` (Programmatic changes, Which changes are recorded, Dataset changes) | split |
| server-undo | `addons/undo-redo` (Rolling back a failed save, With scroll mode) | split |
| export | `addons/import-export` (Export) | split |
| import | `addons/import-export` (Import, Import limits, Import options) | split |
| export | `addons/import-export` (Print) | merge |
| import | `addons/import-export` (Dropzone, Lower-level pieces) | merge |
| presence | `addons/presence` | move |
| presence-broadcast | `addons/broadcasting-presence` | move |
| performance | `performance` (becomes `performance/index`; row ceiling fixed to one statement) | move |
| benchmark-results | new page from the perf-docs session (`performance/benchmark-results`) | new |
| run-benchmark | new page with the in-browser self-test panel from the perf-docs session (`performance/run-it-yourself`; the title is "Run it yourself") | new |
| virtualization | `virtualization` | move |
| row-limits | `performance`, `virtualization` (Row limit), `project-status` | merge, new text |
| a11y-conformance | `accessibility` (Conformance target, Semantics, Selection and editor, Live regions) | split |
| a11y-keyboard | `accessibility` (Keyboard coverage, Test status matrix, Touch targets) | split |
| a11y-known-gaps | `accessibility` (Known gaps) | split |
| plugins-shape | `plugins` (The plugin shape, What a plugin can reach, Identity, SSR) | split |
| plugins-overlays | `plugins` (Overlays, Row bands) | split |
| plugins-events | `plugins` (Observing data changes) | split |
| plugins-commands | `plugins` (Commands and keymaps, Engine work) | split |
| plugins-example | `plugins` (Worked example) | split |
| server-index, data-modes | `data-modes` (Data modes, Matrix, Notes) | move |
| scroll-usage | `lazy-loading` (Usage) | split |
| scroll-usage | `lazy-loading` (Editing loaded rows) | merge |
| scroll-errors | `lazy-loading` (Errors), `lazy-loading-advanced` (When a block fails permanently) | merge |
| scroll-retention | `lazy-loading` (Memory & retention) | split |
| scroll-sort-filter | `lazy-loading` (Sorting a scroll grid, Filtering a scroll grid) | split |
| scroll-no-total | `lazy-loading` (A source with no total) | split |
| server-selection | `selection-keyboard` (Selection over a server result), `lazy-loading` (Selecting, copying, and exporting) | merge |
| scroll-fetch-libs | `lazy-loading-advanced` (Wiring a fetch/cache library) | move |
| pagination | `pagination` (link the one-hook path first) | rewrite |
| pagination-url | `pagination` (Composing with url-state) | split |
| server-saves | `events-state` (saving a change), `data-modes` | new text |
| server-round-trip | `recipes/data-fetching/server-round-trip` | move |
| server-troubleshooting | `data-modes`, `lazy-loading` (Errors), recipes | new text |
| streaming | `streaming-updates` | move |
| ev-data | `events-state` (onDataChange and the three shapes) | split |
| ev-selection | `events-state` (onSelectionChange) | split |
| ev-sort-filter | `events-state` (onSortChange, onFilterChange) | split |
| ev-columns | `events-state` (columnLayout and onColumnResizing) | split |
| ev-edit | `events-state` (Edit lifecycle and cell events, onFill, onCellClick, onRenderedRowsChange) | split |
| options-presence | `events-state` (Presence read-back) | merge |
| events-index | `events-state` (Find the callback you need, Zero re-render guarantee, Unsupported features) | split |
| events-model | `events-state` (The three shapes an event follows) | split |
| ref-index, types-index | none | new |
| ref-datagrid | `api-reference` (`<DataGrid>`) | split |
| ref-provider | `api-reference` (`<DataGridProvider>`) | split |
| ref-columndef | `api-reference` (ColumnDef) | split |
| ref-labels | `api-reference` (DataGridLabels) | split |
| ref-types | `api-reference` (Other exported types) | split |
| ref-engine | `api-reference` (Operation engine) | split |
| cheat-shortcuts | `selection-keyboard` (Keyboard map), `global-shortcuts`, `addons/keybindings` | new, generated |
| cheat-props | `api-reference` | new, generated |
| cheat-events | `events-state` (Find the callback you need) | new, generated |
| feature-matrix | `data-modes` (Matrix), `addons/index` | new |
| find-task | none | new |
| install-problems | `installation` (Framework notes, Non-default aliases, Verify) | split |
| version-policy, support-matrix, upgrade | `project-status` | split |
| license | `license` | move |
| agent-skills | `agent-skills` | move |
| playground | `playground` | move |
| detail-panel, bulk-actions, remember-view, multiple-grids, edit-row-form, auth-gated | `recipes/ui-patterns/*`, `recipes/editing/*` | move |
| ex-* | `examples/**` (titles made unique, ORM and swr and react-query pages grouped) | move |
| keeping-fast | `performance` (guidance sections moved off the landing) | split |
| ref-store-hooks | `api-reference` (store hooks and selectors) | split plus new text |
| options-history, options-find, options-rows, options-io, options-keys | the option tables of each add-on page and `api-reference` (Add-on option types) | move, one page per add-on family |
| undo-programmatic | `addons/undo-redo` (Programmatic changes, Which changes are recorded, Dataset changes) | split |
| use-debounce | `hooks/use-debounce` (useDebounce) | split |
| use-debounced-input | `hooks/use-debounce` (useDebouncedInput) | split |
| is-composing-key | `hooks/use-debounce` (isComposingKey) | split |
| sp-choose, sp-load, sp-save, sp-failures, sp-live | none: five short steps that link the Server tasks | new text |
