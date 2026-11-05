| Batch | Wave | Slug | Page | Type | Action | Words | Code | Demo | Sources |
|---|---|---|---|---|---|---|---|---|---|
| B29 | 3 | `index` | Start here | landing | new | 300 | no | no | `index` |
| B23 | 2 | `install` | Install gridcn | step | rewrite | 420 | yes | no | `installation`, `quick-start` |
| B01 | 1 | `first-grid` | Render your first grid | step | split | 500 | yes | no | `quick-start` |
| B23 | 2 | `learn-columns` | Define columns | step | new | 500 | yes | no | `quick-start`, `examples/**` |
| B23 | 2 | `learn-edit` | Edit cells | step | new | 500 | yes | no | `quick-start`, `examples/**` |
| B23 | 2 | `learn-state` | Keep edits in state | step | new | 600 | yes | no | `quick-start`, `examples/**` |
| B23 | 2 | `learn-select` | Select and paste | step | new | 500 | yes | no | `quick-start`, `examples/**` |
| B23 | 2 | `learn-sort` | Sort and filter rows | step | new | 500 | yes | no | `quick-start`, `examples/**` |
| B23 | 2 | `learn-style` | Style the grid | step | new | 500 | yes | no | `quick-start`, `examples/**` |
| B29 | 3 | `server-path` | Server path | landing | new | 300 | no | no | none |
| B24 | 2 | `sp-choose` | Compare data modes | step | new | 300 | yes | no | none |
| B24 | 2 | `sp-load` | Load server rows | step | new | 350 | yes | no | none |
| B24 | 2 | `sp-save` | Plan server saves | step | new | 350 | yes | no | none |
| B24 | 2 | `sp-failures` | Handle failures | step | new | 300 | yes | no | none |
| B24 | 2 | `sp-live` | Go live with streaming | step | new | 300 | yes | no | none |
| B29 | 3 | `extension-path` | Custom code path | landing | new | 300 | no | no | none |
| B24 | 2 | `ep-choose` | Pick a code route | step | new | 300 | yes | no | none |
| B24 | 2 | `ep-cell` | Plan a cell type | step | new | 350 | yes | no | none |
| B24 | 2 | `ep-plugin` | Plan a plugin | step | new | 350 | yes | no | none |
| B29 | 3 | `lookup-index` | Terms and help | landing | new | 250 | no | no | none |
| G | 3 | `find-task` | Task finder | cheatsheet | new (generated) | 900 | no | no | none |
| G | 3 | `terms` | Terms | cheatsheet | move (generated) | 1000 | no | no | `terms` |
| B01 | 1 | `install-problems` | Fix install problems | task | split | 800 | yes | decide | `installation` |
| B29 | 3 | `tools-index` | Try and automate | landing | new | 200 | no | no | none |
| B01 | 1 | `playground` | Playground example | example | move | 300 | yes | yes | `playground` |
| B01 | 1 | `agent-skills` | Use agent skills | task | move | 800 | yes | decide | `agent-skills` |
| B30 | 3 | `editing-index` | Editing cells | landing | new | 250 | no | no | none |
| B02 | 1 | `edit-activation` | Editable columns | feature | split | 700 | yes | carry (max 1 unless variants) | `editing-cell-types` |
| B02 | 1 | `cell-types` | Built-in cell types | feature | split | 1100 | yes | carry (max 1 unless variants) | `editing-cell-types` |
| B02 | 1 | `validation` | Validation | feature | split | 900 | yes | carry (max 1 unless variants) | `editing-cell-types` |
| B02 | 1 | `display-override` | Display override | feature | split | 400 | yes | carry (max 1 unless variants) | `editing-cell-types` |
| B02 | 1 | `edit-row-form` | Edit rows in forms | task | move | 530 | yes | decide | `recipes/ui-patterns/*`, `recipes/editing/*` |
| B02 | 1 | `auth-gated` | Lock cells by role | task | move | 300 | yes | decide | `recipes/ui-patterns/*`, `recipes/editing/*` |
| B30 | 3 | `clipboard-index` | Clipboard and undo | landing | new | 250 | no | no | none |
| B03 | 1 | `clipboard` | Clipboard | feature | move | 900 | yes | carry (max 1 unless variants) | `clipboard` |
| B03 | 1 | `fill` | Fill handle | feature | move | 855 | yes | carry (max 1 unless variants) | `addons/fill` |
| B03 | 1 | `undo-redo` | Undo and redo | feature | split | 900 | yes | carry (max 1 unless variants) | `addons/undo-redo` |
| B03 | 1 | `undo-programmatic` | Undo for code changes | feature | split | 600 | yes | carry (max 1 unless variants) | `addons/undo-redo` |
| B30 | 3 | `selection-index` | Selection and shortcuts | landing | new | 250 | no | no | none |
| B04 | 1 | `pointer-selection` | Pointer selection | feature | split | 800 | yes | carry (max 1 unless variants) | `selection-keyboard` |
| B04 | 1 | `checked-rows` | Checked rows | feature | split | 600 | yes | carry (max 1 unless variants) | `selection-keyboard` |
| B04 | 1 | `keyboard-nav` | Keyboard navigation | feature | split | 900 | yes | carry (max 1 unless variants) | `selection-keyboard` |
| B04 | 1 | `global-shortcuts` | Global shortcuts | feature | move | 850 | yes | carry (max 1 unless variants) | `global-shortcuts` |
| B04 | 1 | `keybindings` | Shortcut remapping | feature | move | 1200 | yes | carry (max 1 unless variants) | `addons/keybindings` |
| B04 | 1 | `status-bar` | Status bar | feature | move | 550 | yes | carry (max 1 unless variants) | `addons/status-bar` |
| B30 | 3 | `sfs-index` | Sort, filter, and search | landing | new | 250 | no | no | none |
| B05 | 1 | `sorting` | Sorting | feature | split+merge | 1200 | yes | carry (max 1 unless variants) | `sorting-filtering-search`, `addons/sort-list` |
| B05 | 1 | `filtering` | Filtering | feature | split | 700 | yes | carry (max 1 unless variants) | `sorting-filtering-search` |
| B05 | 1 | `header-filter` | Header filter | feature | split | 450 | yes | carry (max 1 unless variants) | `addons/toolbar` |
| B05 | 1 | `toolbar` | Toolbar | feature | split | 800 | yes | carry (max 1 unless variants) | `addons/toolbar` |
| B05 | 1 | `quick-search` | Quick search | feature | split | 450 | yes | carry (max 1 unless variants) | `sorting-filtering-search` |
| B05 | 1 | `find-replace` | Find and replace | feature | move | 1100 | yes | carry (max 1 unless variants) | `addons/find-replace` |
| B05 | 1 | `url-state` | URL state | feature | move | 1000 | yes | carry (max 1 unless variants) | `addons/url-state`, `url-state-options` |
| B30 | 3 | `rows-index` | Rows, pages, and menus | landing | new | 250 | no | no | none |
| B06 | 1 | `row-operations` | Row operations | feature | split | 1100 | yes | carry (max 1 unless variants) | `row-operations` |
| B06 | 1 | `row-reorder` | Row order | feature | split | 600 | yes | carry (max 1 unless variants) | `row-operations` |
| B06 | 1 | `row-markers` | Row markers | feature | split | 500 | yes | carry (max 1 unless variants) | `row-operations` |
| B06 | 1 | `pinned-rows` | Pinned rows | feature | move | 1100 | yes | carry (max 1 unless variants) | `addons/pinned-rows` |
| B06 | 1 | `pagination-client` | Client pagination | feature | split | 700 | yes | carry (max 1 unless variants) | `pagination` |
| B06 | 1 | `context-menu` | Context menu | feature | move | 1000 | yes | carry (max 1 unless variants) | `addons/context-menu` |
| B30 | 3 | `columns-index` | Columns | landing | new | 250 | no | no | none |
| B07 | 1 | `column-sizing` | Column sizing | feature | split | 800 | yes | carry (max 1 unless variants) | `columns` |
| B07 | 1 | `column-order-pin` | Column order and pinning | feature | split | 700 | yes | carry (max 1 unless variants) | `columns` |
| B07 | 1 | `column-headers` | Column headers and groups | feature | split | 600 | yes | carry (max 1 unless variants) | `columns` |
| B07 | 1 | `column-visibility` | Column visibility | feature | split | 600 | yes | carry (max 1 unless variants) | `columns` |
| B30 | 3 | `look-index` | Theme, style, and language | landing | new | 250 | no | no | none |
| B25 | 2 | `style-tokens` | Colors and radius | feature | split+new | 900 | yes | carry (max 1 unless variants) | `styling-theming` |
| B07 | 1 | `style-overrides` | Style overrides | feature | split | 700 | yes | carry (max 1 unless variants) | `styling-theming` |
| B07 | 1 | `style-density` | Density and small screens | feature | split | 700 | yes | carry (max 1 unless variants) | `styling-theming` |
| B07 | 1 | `loading-state` | Loading state | feature | split | 350 | yes | carry (max 1 unless variants) | `styling-theming` |
| B07 | 1 | `i18n` | Labels and i18n | feature | merge | 1000 | yes | carry (max 1 unless variants) | `i18n`, `styling-theming` |
| B30 | 3 | `io-index` | Import and export | landing | new | 250 | no | no | none |
| B08 | 1 | `export` | Export | feature | split+merge | 900 | yes | carry (max 1 unless variants) | `addons/import-export` |
| B08 | 1 | `import` | Import | feature | split+merge | 1000 | yes | carry (max 1 unless variants) | `addons/import-export` |
| B30 | 3 | `extend-index` | Recipes and custom code | landing | new | 250 | no | no | none |
| B08 | 1 | `custom-cell-example` | Write a cell type | task | split | 800 | yes | carry (max 1 unless variants) | `custom-cell-types` |
| B08 | 1 | `plugins-example` | Write a plugin | task | split | 600 | yes | decide | `plugins` |
| B08 | 1 | `detail-panel` | Open a detail panel | task | move | 500 | yes | carry (max 1 unless variants) | `recipes/ui-patterns/*`, `recipes/editing/*` |
| B08 | 1 | `bulk-actions` | Run bulk actions | task | move | 335 | yes | decide | `recipes/ui-patterns/*`, `recipes/editing/*` |
| B08 | 1 | `multiple-grids` | Link multiple grids | task | move | 300 | yes | decide | `recipes/ui-patterns/*`, `recipes/editing/*` |
| B08 | 1 | `remember-view` | Remember filters and layout | task | move | 300 | yes | decide | `recipes/ui-patterns/*`, `recipes/editing/*` |
| B31 | 3 | `server-index` | Data modes | landing | new | 350 | no | no | `data-modes` |
| B09 | 1 | `data-modes` | Data mode support | reference | move | 900 | table+sample | no | `data-modes` |
| B09 | 1 | `scroll-fetch-libs` | Fetch with a cache | task | move | 800 | yes | decide | `lazy-loading-advanced`, `recipes/data-fetching/tanstack-query`, `examples/data/lazy/*`, `examples/data/pagination/*` |
| B09 | 1 | `server-sort-filter` | Query server rows | task | merge+split | 800 | yes | carry (max 1 unless variants) | `sorting-filtering-search`, `recipes/data-fetching/server-side-sort-filter`, `lazy-loading` |
| B26 | 2 | `server-troubleshooting` | Troubleshoot server data | task | new | 800 | yes | carry (max 1 unless variants) | `data-modes`, `lazy-loading` |
| B31 | 3 | `pages-index` | Server pagination | landing | new | 250 | no | no | none |
| B26 | 2 | `pagination` | Load rows by page | task | rewrite | 800 | yes | carry (max 1 unless variants) | `pagination` |
| B09 | 1 | `pagination-url` | Keep pages in URL | task | split | 350 | yes | carry (max 1 unless variants) | `pagination` |
| B31 | 3 | `scroll-index` | Scroll mode | landing | new | 300 | no | no | none |
| B09 | 1 | `scroll-usage` | Load rows while scrolling | task | split+merge | 700 | yes | carry (max 1 unless variants) | `lazy-loading` |
| B09 | 1 | `scroll-no-total` | Load without row count | task | split | 350 | yes | carry (max 1 unless variants) | `lazy-loading` |
| B09 | 1 | `scroll-errors` | Recover from load errors | task | merge | 500 | yes | carry (max 1 unless variants) | `lazy-loading`, `lazy-loading-advanced` |
| B09 | 1 | `scroll-retention` | Tune row retention | task | split | 350 | yes | carry (max 1 unless variants) | `lazy-loading` |
| B31 | 3 | `saving-index` | Save to a server | landing | new | 250 | no | no | none |
| B26 | 2 | `server-saves` | Save edits | task | new | 800 | yes | carry (max 1 unless variants) | `events-state`, `data-modes` |
| B10 | 1 | `server-round-trip` | Save and revert | task | move | 800 | yes | carry (max 1 unless variants) | `recipes/data-fetching/server-round-trip` |
| B10 | 1 | `server-conflicts` | Handle refused saves | task | split | 500 | yes | carry (max 1 unless variants) | `recipes/data-fetching/server-round-trip` |
| B10 | 1 | `server-errors` | Show errors on cells | task | split | 500 | yes | carry (max 1 unless variants) | `editing-cell-types` |
| B10 | 1 | `server-undo` | Undo with server data | task | split | 700 | yes | carry (max 1 unless variants) | `addons/undo-redo` |
| B31 | 3 | `server-rows-index` | Rows and live data | landing | new | 250 | no | no | none |
| B10 | 1 | `server-row-ops` | Change server rows | task | split | 800 | yes | carry (max 1 unless variants) | `row-operations`, `data-modes` |
| B10 | 1 | `server-selection` | Select server rows | task | split+merge | 800 | yes | carry (max 1 unless variants) | `selection-keyboard`, `lazy-loading` |
| B10 | 1 | `streaming` | Stream updates | task | move | 800 | yes | carry (max 1 unless variants) | `streaming-updates` |
| B10 | 1 | `presence` | Show presence | task | move | 800 | yes | carry (max 1 unless variants) | `addons/presence` |
| B10 | 1 | `presence-broadcast` | Broadcast your selection | task | move | 345 | yes | decide | `addons/broadcasting-presence` |
| B32 | 3 | `evaluate-index` | Fit and features | landing | new | 300 | no | no | none |
| G | 3 | `feature-matrix` | Feature matrix | cheatsheet | new (generated) | 900 | no | no | `data-modes`, `addons/index` |
| B32 | 3 | `performance` | Performance | landing | new | 350 | no | no | `performance`, `performance/index` |
| B27 | 2 | `benchmark-results` | Benchmark results | reference | new | 900 | table+sample | no | `performance/benchmark-results` |
| B27 | 2 | `run-benchmark` | Run the benchmark | task | new | 600 | yes | decide | `performance/run-it-yourself` |
| B11 | 1 | `keeping-fast` | Performance guidance | concept | split | 600 | no | no | `performance` |
| B11 | 1 | `virtualization` | Virtualization | concept | move | 900 | no | no | `virtualization` |
| B11 | 1 | `row-limits` | Row limits | reference | merge | 400 | table+sample | no | `performance`, `virtualization`, `project-status` |
| B32 | 3 | `a11y-index` | Accessibility | landing | new | 250 | no | no | none |
| B11 | 1 | `a11y-conformance` | Screen reader support | concept | split | 900 | no | no | `accessibility` |
| B11 | 1 | `a11y-keyboard` | Keyboard test coverage | reference | split | 900 | table+sample | no | `accessibility` |
| B11 | 1 | `a11y-known-gaps` | Accessibility gaps | reference | split | 400 | table+sample | no | `accessibility` |
| B32 | 3 | `compat-index` | Support and upgrades | landing | new | 200 | no | no | none |
| B12 | 1 | `version-policy` | Version policy and changelog | reference | split | 500 | table+sample | no | `project-status` |
| B12 | 1 | `support-matrix` | Browser and framework support | reference | split | 400 | table+sample | no | `project-status` |
| B12 | 1 | `upgrade` | Upgrade gridcn | task | split+merge | 450 | yes | decide | `project-status`, `installation` |
| B12 | 1 | `security-policy` | Security policy | reference | split | 300 | table+sample | no | `project-status` |
| B12 | 1 | `license` | License and credits | reference | move | 250 | table+sample | no | `license` |
| B33 | 3 | `ref-index` | Components and props | landing | new | 250 | no | no | none |
| B13 | 1 | `ref-datagrid` | DataGrid props | reference | split | 1200 | table+sample | no | `api-reference` |
| B13 | 1 | `ref-provider` | DataGridProvider | reference | split | 500 | table+sample | no | `api-reference` |
| B13 | 1 | `ref-columndef` | ColumnDef | reference | split | 900 | table+sample | no | `api-reference` |
| B13 | 1 | `ref-labels` | Labels | reference | split | 700 | table+sample | no | `api-reference` |
| B33 | 3 | `events-index` | Events and state | landing | new | 200 | no | no | `events-state` |
| B14 | 1 | `events-model` | Event shapes | reference | split | 600 | table+sample | no | `events-state` |
| B14 | 1 | `ev-data` | Data change events | reference | split | 900 | table+sample | no | `events-state` |
| B14 | 1 | `ev-sort-filter` | Sort and filter events | reference | split | 450 | table+sample | no | `events-state` |
| B14 | 1 | `ev-edit` | Edit and validation events | reference | split | 700 | table+sample | no | `events-state` |
| B14 | 1 | `ev-cell` | Selection and cell events | reference | split | 1000 | table+sample | no | `events-state` |
| B14 | 1 | `ev-columns` | Column and viewport events | reference | split | 600 | table+sample | no | `events-state` |
| B33 | 3 | `contracts-index` | Contracts | landing | new | 200 | no | no | none |
| B14 | 1 | `ref-celltype` | CellType contract | reference | merge | 1400 | table+sample | no | `custom-cell-types`, `api-reference` |
| B28 | 2 | `ref-server-rows` | Server rows contract | reference | rewrite | 1100 | table+sample | no | `recipes/data-fetching/server-side` |
| B14 | 1 | `ref-style-surface` | Style contract | reference | split | 700 | table+sample | no | `styling-theming` |
| B14 | 1 | `ref-engine` | Operation engine contract | reference | split | 500 | table+sample | no | `api-reference` |
| B33 | 3 | `plugins-index` | Plugins | landing | new | 250 | no | no | none |
| B28 | 2 | `ref-plugin` | Plugin contract | reference | new | 900 | table+sample | no | `plugins-shape` |
| B15 | 1 | `plugins-commands` | Plugin commands and shortcuts | reference | split | 700 | table+sample | no | `plugins` |
| B15 | 1 | `plugins-shape` | Plugin shape | concept | split | 600 | no | no | `plugins` |
| B15 | 1 | `plugins-overlays` | Plugin overlays | concept | split | 700 | no | no | `plugins` |
| B15 | 1 | `plugins-events` | Plugin events | concept | split | 500 | no | no | `plugins` |
| B33 | 3 | `concepts-index` | Concepts | landing | new | 250 | no | no | none |
| B15 | 1 | `selection-model` | Selection model | concept | split | 700 | no | no | `selection-keyboard` |
| B15 | 1 | `custom-cell-model` | Cell type model | concept | split | 700 | no | no | `custom-cell-types` |
| B15 | 1 | `styling-model` | Styling model | concept | split | 500 | no | no | `styling-theming` |
| B28 | 2 | `grid-state-model` | State and view index | concept | new | 600 | no | no | `terms` |
| B33 | 3 | `types-index` | Types and hooks | landing | new | 200 | no | no | none |
| B16 | 1 | `ref-types` | Exported types | reference | split | 600 | table+sample | no | `api-reference` |
| B28 | 2 | `ref-store-hooks` | Store hooks | reference | split+new | 600 | table+sample | no | `api-reference` |
| B16 | 1 | `use-debounce` | useDebounce | reference | split | 300 | table+sample | no | `hooks/use-debounce` |
| B16 | 1 | `use-debounced-input` | useDebouncedInput | reference | split | 400 | table+sample | no | `hooks/use-debounce` |
| B16 | 1 | `is-composing-key` | isComposingKey | reference | split | 300 | table+sample | no | `hooks/use-debounce` |
| B33 | 3 | `options-index` | Add-on options | landing | new | 300 | no | no | `api-reference` |
| B33 | 3 | `options-clipboard-undo-index` | Clipboard and undo options | landing | new | 100 | no | no | `api-reference` |
| B16 | 1 | `options-fill` | Fill handle options | reference | move | 400 | table+sample | no | `api-reference` |
| B16 | 1 | `options-undo-redo` | Undo and redo options | reference | move | 500 | table+sample | no | `api-reference` |
| B33 | 3 | `options-import-export-index` | Import and export options | landing | new | 100 | no | no | `api-reference` |
| B16 | 1 | `options-export` | Export options | reference | move | 600 | table+sample | no | `api-reference` |
| B16 | 1 | `options-import` | Import options | reference | move | 700 | table+sample | no | `api-reference` |
| B33 | 3 | `options-rows-pages-menus-index` | Rows, pages, and menus options | landing | new | 100 | no | no | `api-reference` |
| B17 | 1 | `options-context-menu` | Context menu options | reference | move | 500 | table+sample | no | `api-reference` |
| B17 | 1 | `options-pagination` | Client pagination options | reference | move | 400 | table+sample | no | `api-reference` |
| B17 | 1 | `options-pinned-rows` | Pinned rows options | reference | move | 400 | table+sample | no | `api-reference` |
| B34 | 3 | `options-selection-shortcuts-index` | Selection and shortcuts options | landing | new | 100 | no | no | `api-reference` |
| B17 | 1 | `options-keybindings` | Shortcut remapping options | reference | move | 500 | table+sample | no | `api-reference` |
| B17 | 1 | `options-status-bar` | Status bar options | reference | move | 400 | table+sample | no | `api-reference` |
| B34 | 3 | `options-server-index` | Server options | landing | new | 100 | no | no | `api-reference` |
| B17 | 1 | `options-presence` | Presence options | reference | merge+move | 600 | table+sample | no | `events-state`, `api-reference` |
| B17 | 1 | `options-server-rows` | Server rows options | reference | split | 500 | table+sample | no | `lazy-loading`, `pagination` |
| B34 | 3 | `options-sort-filter-search-index` | Sort, filter, and search options | landing | new | 100 | no | no | `api-reference` |
| B18 | 1 | `options-find` | Find and replace options | reference | move | 500 | table+sample | no | `api-reference` |
| B18 | 1 | `options-sort-list` | Sort list options | reference | move | 300 | table+sample | no | `api-reference` |
| B18 | 1 | `options-toolbar` | Toolbar options | reference | move | 600 | table+sample | no | `api-reference` |
| B18 | 1 | `options-url-state` | URL state options | reference | move | 400 | table+sample | no | `api-reference` |
| G | 3 | `cheat-index` | Cheatsheets and messages | landing | new (generated) | 150 | no | no | none |
| G | 3 | `cheat-shortcuts` | Keyboard shortcuts | cheatsheet | new (generated) | 800 | no | no | `selection-keyboard`, `global-shortcuts`, `addons/keybindings` |
| G | 3 | `cheat-props` | Props A to Z | cheatsheet | new (generated) | 1100 | no | no | `api-reference` |
| G | 3 | `cheat-events` | Events A to Z | cheatsheet | new (generated) | 900 | no | no | `events-state` |
| B28 | 2 | `hooks-az` | Hooks A to Z | cheatsheet | unmapped | 500 | no | no | none |
| B18 | 1 | `options-az` | Options A to Z | cheatsheet | move | 600 | no | no | `api-reference` |
| G | 3 | `ref-messages` | Messages | reference | new (generated) | 1500 | table+sample | no | none |
| B35 | 3 | `examples-index` | Basic examples | landing | new | 250 | no | no | none |
| B19 | 1 | `ex-minimal` | Minimal grid example | example | move | 130 | yes | yes | `examples/**` |
| B19 | 1 | `ex-editable` | Editable grid example | example | move | 160 | yes | yes | `examples/**` |
| B19 | 1 | `ex-celltypes` | Cell types example | example | move | 150 | yes | yes | `examples/**` |
| B19 | 1 | `ex-custom` | Custom cell type example | example | move | 200 | yes | yes | `examples/**` |
| B35 | 3 | `ex-columns-index` | Column examples | landing | new | 150 | no | no | `examples/**` |
| B19 | 1 | `ex-pinning-cols` | Pinned columns example | example | move | 215 | yes | yes | `examples/**` |
| B19 | 1 | `ex-col-drag` | Column order example | example | move | 170 | yes | yes | `examples/**` |
| B19 | 1 | `ex-col-filter` | Header filter example | example | move | 360 | yes | yes | `examples/**` |
| B19 | 1 | `ex-col-headers` | Column headers example | example | move | 150 | yes | yes | `examples/**` |
| B19 | 1 | `ex-col-layout` | Column layout example | example | move | 225 | yes | yes | `examples/**` |
| B19 | 1 | `ex-col-groups` | Column groups example | example | move | 185 | yes | yes | `examples/**` |
| B35 | 3 | `ex-rows-index` | Row examples | landing | new | 150 | no | no | `examples/**` |
| B20 | 1 | `ex-pinning-rows` | Pinned rows example | example | move | 210 | yes | yes | `examples/**` |
| B20 | 1 | `ex-row-ops` | Row operations example | example | move | 280 | yes | yes | `examples/**` |
| B20 | 1 | `ex-row-drag` | Row order example | example | move | 500 | yes | yes | `examples/**` |
| B20 | 1 | `ex-row-markers` | Row markers example | example | move | 180 | yes | yes | `examples/**` |
| B20 | 1 | `ex-row-actions` | Row actions example | example | move | 290 | yes | yes | `examples/**` |
| B20 | 1 | `ex-row-stream` | Streaming rows example | example | move | 165 | yes | yes | `examples/**` |
| B35 | 3 | `ex-validation-index` | Validation examples | landing | new | 150 | no | no | `examples/**` |
| B21 | 1 | `ex-validation` | Validation example | example | move | 500 | yes | yes | `examples/**` |
| B21 | 1 | `ex-async-validation` | Async validation example | example | move | 415 | yes | yes | `examples/**` |
| B21 | 1 | `ex-server-errors` | Server errors example | example | move | 300 | yes | yes | `examples/**` |
| B21 | 1 | `ex-cross-field` | Cross-field validation example | example | move | 240 | yes | yes | `examples/**` |
| B21 | 1 | `ex-async-gates` | Async gates example | example | move | 300 | yes | yes | `examples/**` |
| B35 | 3 | `ex-data-index` | Server and data examples | landing | new | 150 | no | no | `examples/**` |
| B21 | 1 | `ex-server` | Server rows example | example | move | 500 | yes | yes | `examples/**` |
| B21 | 1 | `ex-large` | Large data example | example | move | 200 | yes | yes | `examples/**` |
| B21 | 1 | `ex-lazy` | Scroll mode example | example | move | 310 | yes | yes | `examples/**` |
| B21 | 1 | `ex-pages` | Server pagination example | example | move | 210 | yes | yes | `examples/**` |
| B35 | 3 | `ex-orm-index` | ORM examples | landing | new | 100 | no | no | `examples/**` |
| B22 | 1 | `ex-orm-drizzle` | Drizzle example | example | move | 250 | yes | yes | `examples/data/orm/drizzle` |
| B22 | 1 | `ex-orm-prisma` | Prisma example | example | move | 200 | yes | yes | `examples/data/orm/prisma` |
| B22 | 1 | `ex-orm-supabase` | Supabase example | example | move | 200 | yes | yes | `examples/data/orm/supabase` |
| B35 | 3 | `ex-appearance-index` | Style examples | landing | new | 150 | no | no | `examples/**` |
| B22 | 1 | `ex-styling` | Styling example | example | move | 225 | yes | yes | `examples/**` |
| B22 | 1 | `ex-loading` | Loading state example | example | move | 260 | yes | yes | `examples/**` |
| B22 | 1 | `ex-rtl` | Right-to-left example | example | move | 360 | yes | yes | `examples/**` |

225 pages in 35 batches.
