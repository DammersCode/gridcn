# Demo Validation A — Validation & Editing demos (Cluster A, Plan 014 Task 2 part 3)

Scope: 5 registry items, files under `registry/default/examples/`.
Checked: (1) strict installability (npm import → item `dependencies` + repo `package.json`),
(2) third-party API correctness against installed versions (d.ts + runtime probe),
(3) gridcn API against `registry/default/blocks/**` + JSDoc + `content/docs/api-reference.mdx`,
(4) existing demo unit tests.

Tested:
- `node scripts/verify-demo-install.mjs` (`pnpm demo:verify`): **exit 0** (all 42 items resolve).
  Mine: `data-grid-validation-demo` additionally warns `import "sonner" is not declared in any
  closure item's registry.json dependencies` (detailed below); all other cluster items only get
  the global, harmless `react` boilerplate warning (affects all ~42 items).
- `pnpm vitest run --project unit registry/default/examples/data-grid-custom-cell-demo.test.tsx`:
  **10/10 passed** (the only existing demo unit test of the cluster; the other four demos
  have no unit tests — browser tests exist, they belong to part 2).

## data-grid-validation-demo

- **External deps (installed versions):** `joi` 18.2.9 (repo: ^18.2.9), `zod` 4.6.5 (^4.6.5),
  `valibot` 1.5.0 (^1.5.0), `sonner` 2.0.8 (^2.0.8) — all in repo `package.json` ✓.
  Item `dependencies`: `["joi","valibot","zod"]` — **`sonner` is missing** (it is only in
  `registryDependencies`; no `sonner` item exists in this `registry.json` → resolution goes
  through the default shadcn registry, which provides `sonner` with the npm dep `sonner` +
  `components/ui/sonner.tsx`).
- **APIs verified:**
  - `Joi.string().pattern(re).empty("").messages({"string.pattern.base": …})` (joi 18.2.9):
    runtime-verified — all 3 methods exist, the custom message applies; `~standard` is native
    (version 1, vendor "joi") → `isStandardSchema` detection matches. Observation (not a defect):
    `empty("")` returns an empty result object `{}` for `""` (neither `value` nor `issues` —
    a joi-side standard-schema deviation); the grid treats that as success with `value: undefined`
    → empty cell commits, behavior correct.
  - `z.number().int().min(0).max(100)` (zod 4.6.5): runtime-verified — `~standard` is native,
    issue shape `{ message, path }` matches `formatIssues`.
  - `v.pipe(v.string(), v.minLength(3))` (valibot 1.5.0): runtime-verified — `~standard` is native;
    the failure result carries `value` AND `issues`; the grid branches on `issues` first → correct.
  - `toast.error(msg, { id: "age-rule" })` + `<Toaster />` (sonner 2.0.8): d.ts-verified
    (`ExternalToast.id?: number | string`, `Toaster` export); `id` deduplicates bulk-paste toasts.
  - Hand-rolled schemas (email sync, sku async, price coercing): the `~standard` shape
    (`version: 1`, `vendor`, `validate` → `{ value } | { issues: [{ message }] }`) conforms to the
    vendored `StandardSchemaV1` in `types.ts` and to the standard-schema spec; the `as never` cast
    is the documented repo pattern (the same casts appear in the block's own tests).
- **gridcn API:** `DataGrid` (data/columns/getRowId/onDataChange/className), `useDataGridState`,
  `defineColumns`, column fields (`validate` function form + schema, `onInvalid: "warn"`,
  `type/width/flex`) — all verified against `data-grid.tsx`/`types.ts`/`store/types.ts` ✓.
- **Status:** DEFECT-OPEN (strict installability) + fix in the demo file (see changes)
- **Changes:**
  1. File JSDoc: "Nine rejection paths" → "Eight rejection paths" (counts 8: Age, Email, SKU,
     Price, Notes, Zod, Joi, Valibot — the RULES array has 8 entries; 1 word).
  2. **registry.json (NOT edited, central):** add `sonner` to the item `dependencies`
     (otherwise the demo's npm import is only pulled in via the external default-registry item;
     `demo:verify` warns accordingly).
  3. → **Payload drift:** rebuild `public/r/data-grid-validation-demo.json` via
     `pnpm registry:build` before the commit (lead gate; registry.json references are path-based,
     payloads embed the content).

## data-grid-cross-field-demo

- **External deps (installed versions):** none (only `react`; repo boilerplate).
  Item `dependencies`: none — correct, no external import.
- **APIs verified:** `DataGrid` with `defaultData`/`columns`/`getRowId`/`validateRow`/`className`
  — `validateRow?: (row: TData, rowId: string) => Record<string, string> | null` present in
  `DataGridProps`, the semantics ("values still commit either way", errors land in `cellErrors`)
  match the demo JSDoc exactly; `defineColumns` (text/number), `generateDemoRows(8)` from
  `./demo-data` (file included in the item payload ✓).
- **Status:** OK
- **Changes:** none.

## data-grid-cell-errors-demo

- **External deps (installed versions):** none (only `react`). `@/components/ui/button` comes
  transitively via the `data-grid` item (whose `registryDependencies` include `button`) ✓ —
  `demo:verify` confirms: import resolvable.
- **APIs verified:** `DataGridProvider {...grid} columns onDataChange` (spread of the
  `useDataGridState` result; the `history` key is ignored by the provider, the JSX spread causes
  no excess-property error), `DataGridRoot/Header/Body`, `useDataGridActions().setCellErrors(
  readonly CellErrorEntry[])` / `.clearCellErrors()`, `useDataGridCellErrors(): ReadonlyMap`
  (`.size` usage correct), `DataChange.ops` + `DataOp update.cells {columnId, value, prev}[]`
  (the type guard `isUpdateWithCells` is exactly the type shape at `types.ts:136-146`),
  `CellErrorEntry {rowId, columnId, message}` — all verified against `store/types.ts` + `types.ts` ✓.
- **Status:** OK
- **Changes:** none.

## data-grid-cell-types-demo

- **External deps (installed versions):** none (only `react`).
  Item `dependencies`: none — correct, no external import.
- **APIs verified:** all 5 built-in cell types against `GridCellTypes` in `types.ts:518-540`:
  `number {min,max}` (min/max clamp confirmed in `number.tsx`), `select {choices: {value,label}[]}`
  (choice values overlap with `ROLES` in `demo-data.ts` ✓), `date {displayFormat:
  Intl.DateTimeFormatOptions}` (`displayFormat` fallback logic in `date.tsx`), `checkbox`,
  `readOnly: true`, `renderCell` with `CellRenderProps<DemoRow, number | null>` (the `value`
  destructuring is correct). `generateDemoRows(8)` — `age` 18–67 (all initially valid),
  `joined` ISO dates ✓.
- **Status:** OK
- **Changes:** none.

## data-grid-custom-cell-demo

- **External deps (installed versions):** none (only `react`). `@/components/ui/input` comes
  transitively via the `data-grid` item (`registryDependencies` include `input`) ✓.
- **APIs verified:** the custom cell-type contract `CellType<TData,TValue,TOptions>` (`types.ts:309-323`):
  all 9 members present and signature-correct (`Cell`, `Editor`, `toText`, `toDisplayText?`,
  `fromText` — never-throwing, `clearValue`, `isEmpty`, `compare?`, `align?`);
  the `cellTypes` prop on `DataGridProvider` (REPLACE semantics — the demo spreads `...cellTypes`
  correctly in, the JSDoc callout at `data-grid.tsx:277-282` is consistent); `useSeedFocus(ref, initialText)` +
  `useCommitGuard().tryCommit()` exactly like the built-in editors; `CellEditorProps`
  (`value/initialText/onChange/commit/cancel/column`) ✓.
- **Unit tests:** `data-grid-custom-cell-demo.test.tsx` (10 tests: fromText/toText/toDisplayText/
  isEmpty/clearValue/compare + editor focus) — **10/10 green**.
- **Status:** OK
- **Changes:** none.

## Cross-cutting notes (no defects, documented only)

- The `react` warning from `demo:verify` is global (all ~42 items) — consumer boilerplate, not a
  cluster defect (cluster B documents the same).
- The Joi v18 `empty("")` → `{}` result (standard-schema deviation, see above) is internal to joi;
  the demo behavior stays correct. No demo fix possible or sensible.
- None of my cluster items imports an npm package that would be missing from the repo `package.json`
  → the Task-2 conflict rule (only the lead touches `package.json`) does not apply.
