# Vocabulary decisions

Counts: matches in `content`, `README.md`, `skills`, `registry/default`, `app` (docs, source, tests).

| Term | Alternatives | Chosen | Count | Public identifier | Reason |
|---|---|---|---|---|---|
| op / ops | operation | operation in prose; `ops`, `DataOp`, `source: "row-op"` kept | ~680 | `DataChange.ops` (docs, demos, tests, plugins) | "operations" is longer, not clearer; renaming touches every consumer's `onDataChange` code for no gain. Spell it out at first use. |
| windowing / windowed | virtualization | virtualization | ~120 prose | `onRowWindowChange`, `windowedColumns`, `WindowedColumn`, `windowing/` folder | Virtualization is the known term. Public names renamed (`onRenderedRowsChange`, `renderedColumns`, `RenderedColumn`, `virtualization/`). Internal `useRowWindow`, `useColumnWindow`, `windowStart` kept. |
| row window | rendered rows | rendered rows / row range | ~10 prose | | Plain description of what it is. |
| view index / view space | display index | view index (`viewIndex`) | ~750 | `viewRowIndex`, `viewIndex` params | Already one word; "view space" folded into it. Defined in the glossary. |
| commit | write, save | commit | ~300 | `commitChange` | Familiar from forms and editors; defined once. |
| accessor | field | accessor | ~40 | `accessorKey`, `accessorFn` | Known to table developers; matches column API. |
| cell type vs column type | | cell type | ~200 | `cellType`, `cellTypes` | One concept, one word; "column type" is not used. |
| add-on vs plugin | | both | 387 / many | `DataGridPlugin`, `plugins`; registry item names | Two concepts. An add-on is an installable registry item. A plugin is a runtime object. One add-on may install a plugin, may install none (toolbar, pagination, io). |
| overlay plugin | plugin with `Overlay` | plugin (with an `Overlay`) | 33 | `OverlayPluginCtx` | Not a third concept; a plugin member. |
| row marker | gutter | row marker | ~1000 | `rowMarkers` | Public prop name. "Gutter" kept only for the scrollbar gutter (CSS term). |
| grip | drag handle | drag handle | ~94 | none | "Grip" is rarer than "drag handle". |
| id-keyed | by row id | by row id | 47 | none | Not a known term. |
| escape hatch | override | override | 14 | none | Idiom with no literal meaning. |
| anchor / active cell / range | | kept | | | Standard spreadsheet words; defined. |
| claim / release | | kept | | | Plain verbs. |
| seed | initial value | kept | ~188 | `default*` props | Verb form is common; defined. |
| ctx | context | kept in identifiers | ~390 | `ctx` params | Convention in the repo API. Not used in prose. |
| stream, hydrate, headless, sentinel, standard schema | | kept | | | Known terms or internal comments. |
| quick search | search | quick search | 31 | `toSearchText` | Distinguishes the highlighting search from filter. |

## Pass 2: unclear names

| Name | Problem | Decision |
|---|---|---|
| `id-keyed` | Coined compound | Prose: "by row id" or "row-id-based" |
| `source: "row-op"` | Abbreviation | Renamed `"row-operation"` |
| `deleteContents` | UI says "Clear contents" | Renamed `clearContents` |
| `editReplace` | Docs say "type-to-replace" | Renamed `typeToReplace` |
| `retainMove*` | "retain" hides what is kept | Renamed `move*KeepSelection` |
| `rowBands`, `viewStale`, `extendJump*`, `rowIdentityVersion`, `dataControlled` | Odd but short, and renaming touches many files | Kept; `band` is defined in the glossary. Rename later if readers trip on them. |
