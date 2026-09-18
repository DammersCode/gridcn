# Plan 012: API audit — ADOPT set (P1-A, P2, P3, P6-code, P7 a-c, P8 b/c/d, P9 a-e + docs batch)

> **Executor instructions**: Follow items in the order below (window 1 = P3 first — its
> RED tests are already written). Each item is self-contained; run its verification
> commands, honor the STOP conditions, and update the status line when done.

Source of this plan: the 2026-09 API audit consensus (`final.md`: 9 auditors → 9
proposals → 3 reviews, ~10-11 working days). Deep reference ONLY on drift:
`C:\Users\dahe\AppData\Local\Temp\opencode\api-audit\final.md` (10KB — re-read it before
changing anything that deviates from this plan). Do NOT open the reviews or findings
files; this plan carries the full ADOPT content.

## Scope

Implement exactly the ADOPT set. **Deferred — do NOT touch:** P4(a) editor keymap code
(next window), P8(a) fill transform seam (separate proposal), P1-B (post-1.0 ADR), P7(d)
rowId-native multi-cell (backlog; docs stopgap ships with P7c), P9(f) rename PR
(pre-1.0 milestone), P5 CI type-check guard (separate proposal; drift script at best),
pagination selection-prune-by-rowId (backlog; phrase docs as current behavior + tracked
follow-up).

**Net new public API this window (exactly):** one option (`csvBom`), one method
(`useDataGridState.history.clear`), one re-export (`IMPORT_CANCELLED_MESSAGE`).
Everything else is bug fixes, docs, dev-only warnings. All dev-warns are PER-INSTANCE
(module-level once-per-app flag = anti-pattern). The `warnDev` pattern exists in the
repo (store guardrails) — reuse it, look under `registry/default/blocks/data-grid/store/`.

## Status

| Item | Window | Status |
|------|--------|--------|
| P3 commit-guard re-arm (sync + async) | 1 | DONE (d7e1c79) — RED verified (both tests failed on the latched guard), GREEN: browser file + full data-grid suites pass. One RED-test mock defect fixed in the same commit: the second verdict was never resolved, so the async test could never go GREEN as written |
| P2 cellTypes replace-semantics | 2 | DONE (ae33348) — replace-semantics documented at api-reference.mdx:132 + both `cellTypes` JSDocs; cast-free spread compiles under strict TS via new `AnyCellType` alias (single documented `any` erasure, `AnyColumnDef` pattern) — demo double-cast removed (a1#13) |
| P7 a-c presence hardening | 3 | DONE (e587cf7) — RED verified (4 tests fail: duplicate-key warning, no drop-warns); GREEN: position-keying + set-time validation (non-object/missing/null/NaN range, null rowId discriminant fix, missing columnId) with per-instance warnOnce + resolve-time hidden/unknown-column warn; id contract rewritten (store JSDoc + docs), docs: snapshot-replace + clear-on-leave, exactly-once hook, runnable send-side `range` sketch, divergence caveat |
| P6-code dev-warns (absorbs P2b) | 4 | DONE (e3761ff) — RED verified (5 tests fail); GREEN: url-state mount-apply intersects specs with all live column ids + per-spec warn; single `checkUnresolvableColumnTypes` guardrail in the provider effect (once per instance, absorbs P2b); lazy `handleFulfilled` clamps to `[start, end)`, marks only written rows loaded, per-instance once-warn, `fetchRows` JSDoc states the exact-length/positional contract |
| P8 b/c/d additive batch | 5 | DONE (512f4a5) — RED verified (BOM/.tsv/history.clear fail); GREEN: `history.clear` on the sub-object (result type + docs line), CSV BOM default ON with `csvBom` opt-out (byte-level change, CHANGELOG entry, "Encodings and Excel" callout folding a4#15), `.tsv` accepted (parser + dialog `accept`), `IMPORT_CANCELLED_MESSAGE` re-exported from the io barrel, `number.options.step` @reserved (JSDoc + docs table) |
| P1-A value-pipeline docs (3 surfaces) | 6 | DONE (5ab3ea1) — one contract on all three surfaces: `types.ts` CellType JSDoc (pipeline list: display/clipboard-export/sort/search-filter/fill), `custom-cell-types.mdx` (toText bullet, compare bullet, new "Value pipeline" contract bullet + search=raw consequences), `editing-cell-types.mdx` (corrected intro sentence + contract pointer); false `compare`-default claim fixed everywhere (default collates raw `String(value)`, not `toText` output) |
| Docs batch: P5 + P6-b + P9 b/d | 7-9 | DONE — P5 (78853a3, 16895f0, c9a2d04, 9b32eb4, 6876b2f, 17c71e4, 351835c): history `onChange`→`setData` (both pages), keymap→DataGridRoot nested form, density/rowHeight→DataGridRoot, pinned-rows totals example stable `onChange` + memoized band + `DataGridAggregateReporter` ref-guard (TDD: RED loop verified, 9b32eb4) + callout rewritten against the code, currency recipe pinned locale + commit guard, pagination stale-response guard, import-export "follows search"→sort/filter (a4#11); P6-b (8cf0a1d, 0628c1b, b764c5a, 06fcf78, 34fa111, d511d7a, 029166e, 3bf183e): search-never-filters in 3 places (sorting-filtering-search, lazy-loading, import-export), Escape-clears-selection note, right-click-selects note, deleteRows-clears-selection note, fill-skips-readOnly note, lazy select-all includes holes, pagination page-local view/selection/streaming callouts (a6#4/#10), URL-sort-invisible note + `headerClickBehavior="sort"` variant (a4#2); P9 b/d (fcdb0c4, 70489ce, 0269379, 0021e91): keybindings wiring (dialog in provider, shortcut in root, `?` contested-key note) + shortcut JSDoc fix (a8#12/#14), api-reference Search/FilterMenu/ColumnsMenu + `UseDataGridHistoryOptions` tables (a3#10, a5#2), `join` URL param in key lists (a4#12), stale overlay-plugins→presence anchor (a7#13) |
| P9 a/c + P9 e + P4-b table | 10 | DONE — P9 e JSDoc batch (46f4af9): CellRenderProps fields + rowIndex=view-index, CellEditorProps onChange/commit ordering contract (verified against cell.tsx pendingValueRef), ColumnDef pin/sortable/filterable/hidden, accessorFn-only=read-only (verified isColumnReadOnly), GridAction dead `lib/keymap.ts` link + editReplace unbindable, Keymap `ctrl` literal + macOS Spotlight note, setActiveCell asymmetry, useDataGridState "uncontrolled" rewrite (JSDoc + undo-redo callout), --grid-pin-shadow documented in installation + styling-theming (a8#5, a9#6/#7/#9, a1#8/#16/#18, a2#6/#8, a5#15); P9 a/c (fc45d2b): new row-operations.mdx (enable props, mod+shift+f/x shortcuts, context-menu cell-surface item list, no-menu surfaces, readOnly gating, programmatic view-space actions, selection behavior) + api-reference "and more" fixed + autosize windowed-only note (a8#10); P4-b (f101b56): per-editor keyboard contract table (any Enter commits down, Tab/Shift+Tab blur-commit in place, keymap ignored while editor open — verified in use-grid-interaction.ts:552-554 + all four editors; popover close-without-pick = cancel verified in select/date onOpenChange), commit* dialog labels marked "(editor)" (labels.ts), quick-start.mdx:77 fixed, false popover "commit-on-outside-click" checklist claim corrected |

## Window 1 — P3: commit-guard re-arm on rejection (TDD, sync AND async, all editors)

Bug: (1) a SYNC `validate` rejection latches the one-shot commit guard permanently
(`rejectionCount` bumped only on async rejections: `use-async-validate.ts:59-62`; sync
path sets `editingError` at `create-store.ts:530-532`) — after fixing a rejected value,
Enter/blur silently no-op; Escape+re-edit is the only way out. (2) `select`/`date`
editors never implement the `rejectionCount` re-arm effect at all
(`select.tsx:35`, `date.tsx:91` vs `text.tsx:23-27`, `number.tsx:53-57`) — after any
async rejection every subsequent pick/Enter is dropped and the edit session is stuck.

1. **RED (verify):** `pnpm vitest run --project browser registry/default/blocks/data-grid/test/data-grid.browser.test.tsx`
   — both tests in "commit guard re-arm on rejection (sync and async)" MUST fail (guard latched).
2. **Fix (GREEN):**
   - a) store (`store/create-store.ts`): new state field `editingRejectionCount`
     (type next to `editingError` in `store/types.ts` ~Z338); init 0; `startEditing`
     resets it to 0 (session baseline); the SYNC rejection path (~Z531) and the
     `setEditingError` action (~Z571) increment it. Only caller of `setEditingError`:
     `use-async-validate.ts:60` — so async + sync flow through the same nonce.
   - b) `cell.tsx`: pass `rejectionCount={storeNonce}` (not `asyncValidate.rejectionCount`)
     to `<Editor>`; `use-async-validate.ts`: remove the local `rejectionCount` STATE
     (redundant — the store is the single source of truth), adjust its doc comment.
   - c) `select.tsx` + `date.tsx`: copy the re-arm effect from `text.tsx:23-27`
     (`lastRejectionCount` ref, `useEffect` → `committed.reset()` on count change).
     `date.tsx` additionally: `readOnly={pending}` on the Input (destructure `pending`
     from props).
   - d) JSDoc: `CellEditorProps.rejectionCount` in `types.ts` (~Z250-257) → "increments
     on every rejected commit attempt (sync or async)"; checklist line in
     `content/docs/custom-cell-types.mdx` (~Z139-141) in sync with that wording.
3. **GREEN (verify):** same browser command passes; then unit suites for cell-types +
   store (`pnpm test -- data-grid`).
4. Commit: `fix(data-grid): re-arm the commit guard on sync and async validation rejections`

STOP if the RED run shows the tests passing (fix already landed?) or failing for a
reason other than the latched guard.

## Window 2 — P2: `cellTypes` replace-semantics (docs + JSDoc)

`api-reference.mdx:132` says the registry is "merged over the five built-ins"; code
REPLACES it (`create-store.ts:83` `init.cellTypes ?? defaultCellTypes`).
- Replace the sentence with the replace-semantics truth + the REMEDY: to extend the
  built-ins, spread them — `cellTypes={{ ...cellTypes, myType }}`.
- Same replace-semantics clause in the `cellTypes` JSDoc on BOTH `DataGridProps` and
  the provider props (flows into the generated AutoTypeTable).
- Verify the cast-free example compiles under strict TS (prop-type widening, a1#13).
- No "merge-if-partial" mode. The P2(b) dev-warn lands in window 4 (P6-code) — the
  precise warn is "column's `type` resolves to nothing" (NOT "omits built-in key",
  which false-positives on legitimate subset registries).

Commit: `docs(data-grid): document cellTypes replace-semantics with spread remedy`

## Window 3 — P7 a-c: presence hardening (TDD)

Tests first in `data-grid-presence.test.tsx`: (1) two entries with the same `id` both
render; (2) a malformed foreign entry is dropped + dev-warn.
- a) `presence-overlay.tsx:143`: key entries by ENTRY POSITION, not `id`. In the SAME
  commit rewrite the `id` contract everywhere: `presence-store.ts:15` JSDoc (it
  currently *mandates* the bug) + `content/docs/multiplayer-presence.mdx:39-41` →
  "id must be unique per entry".
- b) `presence-store.ts`: validate/coerce foreign entries on set/resolve — drop +
  dev-warn on ALL drop reasons: malformed (missing `range`, null, NaN), stray-`rowId`
  misroute (fix the `"rowId" in entry` discriminant), hidden column.
- c) Docs `multiplayer-presence.mdx`: snapshot-replace semantics + clear-on-leave
  pattern, "call the hook exactly once" (a7#8), fix the unrunnable send-side sketch
  (a7#7: hook throws outside the provider, full-array column indexing,
  single-cell-only broadcast), multi-cell mapping stopgap (a7#2: use the view-space
  `range` form, note the local sort/filter divergence limitation).

Commit: `fix(data-grid-presence): key overlay entries by position, validate foreign entries`

## Window 4 — P6-code: dev-warns for silent dangerous paths (TDD, all per-instance)

Tests: `data-grid-url-state.test.tsx` (mount-apply), store test (unresolvable type),
`use-data-grid-lazy-rows.test.ts` (clamp).
- url-state: mount-apply intersects parsed sort/filter specs with ALL live column ids
  (`useDataGridAllColumns`, incl. hidden) and dev-warns each dropped spec (a4#1:
  shared link with a removed column currently loads an empty grid, zero signal).
- store guardrail: unresolvable `column.type` (typo silently degrades to text,
  edit/paste/delete dead) → `warnDev` once per instance (a1#7, a2#4). This single warn
  site also absorbs P2(b) — do not add a second warn.
- lazy rows: `handleFulfilled` clamps writes to `[start, end)`, marks only actually
  written rows loaded, dev-warns on length mismatch (a6#1: short/over-long responses
  currently poison the range cache permanently); `fetchRows` JSDoc states the
  exact-length/positional contract.

Commit: `fix(data-grid): dev-warn on dropped URL specs, unknown column types, lazy length mismatch`

## Window 5 — P8 b/c/d: additive API batch (TDD)

Tests: `export-grid.test.ts`, `parse-import-file.test.ts`, `use-data-grid-state` test.
- b) `clear` on `useDataGridState` — on the `history` sub-object (avoids a future
  prop-name collision on the spreadable result); `useDataGridHistory` already has it
  (2-3 LOC) + one docs line.
- c) CSV export: UTF-8 BOM default ON with `csvBom` opt-out (byte-level output change
  → CHANGELOG entry, do NOT call it additive); accept `.tsv` on import; re-export
  `IMPORT_CANCELLED_MESSAGE` from the `data-grid-io` barrel. Fold a4#15 (xlsx writes
  all cells as text) into one "encodings & Excel" docs callout.
- d) `number.options.step`: mark `@reserved` in JSDoc + docs (NOT implement — stepping
  is editor-keyboard behavior, collides with P4; decided after P4 lands).

Commit: `feat(data-grid-io): CSV BOM default + .tsv import + history.clear + IMPORT_CANCELLED_MESSAGE`

## Window 6 — P1-A: value-pipeline contract on three surfaces (docs/JSDoc only)

ONE coherent rewrite (this is the shared `toText`/`compare` change — single commit):
`types.ts:268-277` JSDoc + `custom-cell-types.mdx` + `editing-cell-types.mdx` must all
state the same sentence: display = `toDisplayText ?? toText`; clipboard/export =
`toText`; sort = `compare` (or numeric-aware text on the raw value); **search/filter =
`String(rawValue)`** (code: `store/compute.ts:173-179`, `compute.ts:399`,
`build-view-index.ts:54-69` — search built WITHOUT cellTypes). This fixes the false
`compare`-default claim (default sorts on raw `String(value)`, not "numeric-aware
localeCompare on toText") and adds the missing `fill` consumer to the pipeline list.
Consequences to document: select columns search the stored VALUE not the displayed
label; number with `decimals` searches unrounded; date with displayFormat matches ISO.
P1-B (routing search/filter through `toText`) is DEFERRED — do not change code.

Commit: `docs(data-grid): correct the value-pipeline contract (search/filter use String(rawValue))`

## Windows 7-9 — Docs batch (P5 five fixes + P6-b footguns + P9 b/d)

P5 (every copy-paste block must compile & run):
- `undo-redo.mdx:58-70` + `streaming-updates.mdx:149-154`: `useDataGridHistory({ onChange })`
  → option is `setData` (renamed in 5582d45); both pages + surrounding prose.
- `selection-keyboard.mdx:96-102`: `keymap` on `DataGridProvider` (not accepted there;
  lives on `DataGridRoot`/`DataGrid`) → nested form.
- `styling-theming.mdx:45`: `density` on `DataGridProvider` → correct placement.
- `pinned-rows.mdx:77-95`: totals example infinite-renders (inline `onChange` + inline
  `[totals]`) → show stable `onChange` / memoized bands; harden
  `DataGridAggregateReporter` (~10 LOC: hold `onChange` in a ref, deps `[row]`).
  Fix the `pinned-rows.mdx:110-114` callout (contradicts the fixed example).
- `recipes.mdx` currency editor violates the checklist it cites → pin locale +
  `useCommitGuard`.
- Add: pagination server-mode example with stale-response guard; import-export
  "follows search" claim fix (a4#11).

P6-b footgun notes (docs only, current behavior + tracked follow-up where applicable):
- Escape outside edit mode clears the whole selection (under the keymap table, ONE
  note coordinated with the P4-b table).
- `DataGridSearch` never filters rows (highlight/navigate only) — 3 places incl.
  import-export.
- Pagination: selection is page-local (corrected example: key provider by page or
  clear selection) + client-mode pager operates on the page slice only (a6#4) +
  off-page streaming patches skipped (a6#10).
- Right-click selects the cell before the menu; `deleteRows` clears selection; fill
  skips readOnly columns; lazy select-all includes unloaded rows (holes).
- URL-sort invisible (a4#2): note + example variant.

P9 b/d:
- Keybindings wiring docs: dialog in provider, `DataGridKeybindingsShortcut` inside
  `DataGridRoot` (fix its JSDoc too, a8#12), `?` gating + collision note (a8#14).
- api-reference additions: toolbar/search/filter prop tables (a3#10),
  `UseDataGridHistoryOptions` (a5#2), `join` URL param (a4#12); stale anchor fix
  overlay-plugins→presence (a7#13).

Commits: per-page small `docs(...)` commits.

## Window 10 — P9 a/c + P9 e + P4-b table

- P9 a: NEW `row-operations.mdx` page: enable props → default shortcuts (mod+shift+f
  insert / mod+shift+x duplicate) → context-menu items → programmatic actions;
  no-op-without-prop behavior (silent no-op + dev warning today); keymap-table entries;
  fix `api-reference.mdx:71-74` "and more".
- P9 c: context-menu cell-surface section (item list, no-menu surfaces, readOnly
  gating) + autosize is windowed-only note (a8#10).
- P9 e JSDoc batch: `ctrl` modifier + macOS Spotlight note (a8#5), dead
  `lib/keymap.ts` link (a9#6), `ColumnDef.pin/sortable/filterable/hidden` (a9#7),
  `CellRenderProps` (no JSDoc; `rowIndex` = view index, a1#16), `CellEditorProps`
  value/onChange/commit ordering contract (a1#8 — the most important),
  `accessorFn`-only column = read-only (a1#18), `setActiveCell` asymmetry (a2#6),
  `editReplace` unbindable (a2#8), `useDataGridState` "uncontrolled" rewrite
  (it is a controlled `data` prop, a5#15), `--grid-pin-shadow` fallback or docs (a9#9).
- P4 b: per-editor keyboard contract table in the docs (ACTUAL per-editor behavior:
  any Enter commits down ignoring Shift; Tab/Shift+Tab blur-commit in place; keymap
  ignored while an editor is open); mark `commit*` dialog rows as editor-internal;
  fix `quick-start.mdx:77`.

Commits: `docs(data-grid): ...` per area.

## Gates (after ALL windows, before done)

- `pnpm types:check`, `pnpm lint`, full suite: `pnpm vitest run` (unit) +
  `pnpm vitest run --project browser` (browser; only with the local port workaround in
  `vitest.config.ts` — see quirks).
- Then: code-review skill (`C:\Users\dahe\.agents\skills\code-review\SKILL.md`) over the
  whole diff; apply findings 1:1.

## Environment quirks (Windows)

- `vitest.config.ts` carries a LOCAL-ONLY port workaround (api ports 47831/47832 —
  63315/63316 sit in Windows' dynamic-port exclusion range → EACCES on ::1).
  CLI `--api/--api.port` does NOT work (vitest 5.0.1 string-transform bug).
  **NEVER commit `vitest.config.ts`** — check `git status` before every commit and
  `git checkout -- vitest.config.ts` if it shows modified.
- Shell: pwsh. No `rg`, no heredocs.

## House rules

- Branch `dev` only, no push, no merge. Small one-line conventional commits
  (`fix:`, `feat:`, `docs:`, `chore:`) per logical block. NO `Co-Authored-By` trailer.
- Minimal diff: no speculative abstractions, no new public surface beyond the
  three-item list above. Warns dev-only via the existing `warnDev` pattern.
- No em-dashes in docs.
- Drift from this plan → re-read `final.md` (Temp path above) FIRST, then continue.
