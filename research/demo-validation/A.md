# Demo-Validation A — Validation & Editing-Demos (Cluster-A, Plan 014 Task 2 Teil 3)

Scope: 5 registry-items, Dateien unter `registry/default/examples/`.
Geprüft: (1) strikte Installierbarkeit (npm-Import → Item-`dependencies` + Repo-`package.json`),
(2) Third-Party-API-Korrektheit gegen installierte Versionen (d.ts + Runtime-Probe),
(3) gridcn-API gegen `registry/default/blocks/**` + JSDoc + `content/docs/api-reference.mdx`,
(4) existierende Demo-Unit-Tests.

Getestet:
- `node scripts/verify-demo-install.mjs` (`pnpm demo:verify`): **exit 0** (alle 42 Items auflösbar).
  Meiner: `data-grid-validation-demo` zusätzlich Warning `import "sonner" is not declared in any
  closure item's registry.json dependencies` (detailliert unten); alle übrigen Cluster-Items nur
  das globale, harmlose `react`-Boilerplate-Warning (trifft alle ~42 Items).
- `pnpm vitest run --project unit registry/default/examples/data-grid-custom-cell-demo.test.tsx`:
  **10/10 passed** (einziger existierender Demo-Unit-Test des Clusters; die anderen vier Demos
  haben keine Unit-Tests — Browser-Tests existieren, gehören zu Teil 2).

## data-grid-validation-demo

- **Externe Deps (installierte Versionen):** `joi` 18.2.9 (Repo: ^18.2.9), `zod` 4.6.5 (^4.6.5),
  `valibot` 1.5.0 (^1.5.0), `sonner` 2.0.8 (^2.0.8) — alle in Repo-`package.json` ✓.
  Item-`dependencies`: `["joi","valibot","zod"]` — **`sonner` fehlt** (steht nur in
  `registryDependencies`; `sonner`-Item existiert NICHT in dieser `registry.json` → Auflösung über
  das Default-Shadcn-Registry, das dort `sonner` mit npm-Dep `sonner` + `components/ui/sonner.tsx`
  liefert).
- **Geprüfte APIs:**
  - `Joi.string().pattern(re).empty("").messages({"string.pattern.base": …})` (joi 18.2.9):
    Runtime-verifiziert — alle 3 Methoden existieren, Custom-Message greift; `~standard` nativ
    (version 1, vendor "joi") → `isStandardSchema`-Detection passt. Beobachtung (kein Defekt):
    `empty("")` liefert für `""` ein leeres Ergebnis-Objekt `{}` (weder `value` noch `issues` —
    joi-seitige Standard-Schema-Abweichung); das Grid behandelt das als Success mit `value: undefined`
    → leere Zelle commit, Verhalten korrekt.
  - `z.number().int().min(0).max(100)` (zod 4.6.5): Runtime-verifiziert — `~standard` nativ,
    Issue-Shape `{ message, path }` passt zu `formatIssues`.
  - `v.pipe(v.string(), v.minLength(3))` (valibot 1.5.0): Runtime-verifiziert — `~standard` nativ;
    Failure-Result trägt `value` UND `issues`; Grid brancht zuerst auf `issues` → korrekt.
  - `toast.error(msg, { id: "age-rule" })` + `<Toaster />` (sonner 2.0.8): d.ts-verifiziert
    (`ExternalToast.id?: number | string`, `Toaster` export); `id` dedupliziert Bulk-Paste-Toasts.
  - Hand-rolled Schemas (email sync, sku async, price coercing): `~standard`-Shape
    (`version: 1`, `vendor`, `validate` → `{ value } | { issues: [{ message }] }`) konform zur
    vendierten `StandardSchemaV1` in `types.ts` und zur Standard-Schema-Spec; `as never`-Cast ist
    das dokumentierte Repo-Pattern (gleiche Casts in eigenen Block-Tests).
- **gridcn-API:** `DataGrid` (data/columns/getRowId/onDataChange/className), `useDataGridState`,
  `defineColumns`, Column-Fields (`validate` Funktionsform + Schema, `onInvalid: "warn"`,
  `type/width/flex`) — alle gegen `data-grid.tsx`/`types.ts`/`store/types.ts` verifiziert ✓.
- **Status:** DEFECT-OPEN (strikte Installierbarkeit) + Fix in Demo-Datei (siehe Änderungen)
- **Änderungen:**
  1. File-JSDoc: "Nine rejection paths" → "Eight rejection paths" (zählt 8: Age, Email, SKU,
     Price, Notes, Zod, Joi, Valibot — RULES-Array hat 8 Einträge; 1 Wort).
  2. **registry.json (NICHT editiert, zentral):** `sonner` ins Item-`dependencies` aufnehmen
     (npm-Import des Demos wird sonst nur über das externe Default-Registry-Item mitgezogen;
     `demo:verify` warnt entsprechend).
  3. → **Payload-Drift:** `public/r/data-grid-validation-demo.json` vor dem Commit per
     `pnpm registry:build` neu bauen (Lead-Gate; registry.json-Referenzen sind path-basiert,
     Payloads embedden den Content).

## data-grid-cross-field-demo

- **Externe Deps (installierte Versionen):** keine (nur `react`; Repo-Boilerplate).
  Item-`dependencies`: keine — korrekt, kein externer Import.
- **Geprüfte APIs:** `DataGrid` mit `defaultData`/`columns`/`getRowId`/`validateRow`/`className`
  — `validateRow?: (row: TData, rowId: string) => Record<string, string> | null` in `DataGridProps`
  vorhanden, Semantik ("values still commit either way", Fehler landen in `cellErrors`) passt
  exakt zum Demo-JSDoc; `defineColumns` (text/number), `generateDemoRows(8)` aus
  `./demo-data` (Datei im Item-Payload enthalten ✓).
- **Status:** OK
- **Änderungen:** keine.

## data-grid-cell-errors-demo

- **Externe Deps (installierte Versionen):** keine (nur `react`). `@/components/ui/button` kommt
  transitiv über das `data-grid`-Item (dessen `registryDependencies` enthalten `button`) ✓ —
  `demo:verify` bestätigt: Import resolvable.
- **Geprüfte APIs:** `DataGridProvider {...grid} columns onDataChange` (Spread von
  `useDataGridState`-Ergebnis; `history`-Key wird vom Provider ignoriert, JSX-Spread macht keinen
  Excess-Property-Fehler), `DataGridRoot/Header/Body`, `useDataGridActions().setCellErrors(
  readonly CellErrorEntry[])` / `.clearCellErrors()`, `useDataGridCellErrors(): ReadonlyMap`
  (`.size`-Nutzung korrekt), `DataChange.ops` + `DataOp update.cells {columnId, value, prev}[]`
  (Type-Guard `isUpdateWithCells` exakt der Typ-Form in `types.ts:136-146`), `CellErrorEntry
  {rowId, columnId, message}` — alles gegen `store/types.ts` + `types.ts` verifiziert ✓.
- **Status:** OK
- **Änderungen:** keine.

## data-grid-cell-types-demo

- **Externe Deps (installierte Versionen):** keine (nur `react`).
  Item-`dependencies`: keine — korrekt, kein externer Import.
- **Geprüfte APIs:** alle 5 Built-in-Cell-Typen gegen `GridCellTypes` in `types.ts:518-540`:
  `number {min,max}` (min/max-clamp in `number.tsx` bestätigt), `select {choices: {value,label}[]}`
  (Choice-Werte decken sich mit `ROLES` in `demo-data.ts` ✓), `date {displayFormat:
  Intl.DateTimeFormatOptions}` (`displayFormat`-Fallback-Logik in `date.tsx`), `checkbox`,
  `readOnly: true`, `renderCell` mit `CellRenderProps<DemoRow, number | null>` (`value`-Destructure
  korrekt). `generateDemoRows(8)` — `age` 18–67 (alle initial valide), `joined` ISO-Daten ✓.
- **Status:** OK
- **Änderungen:** keine.

## data-grid-custom-cell-demo

- **Externe Deps (installierte Versionen):** keine (nur `react`). `@/components/ui/input` kommt
  transitiv über das `data-grid`-Item (`registryDependencies` enthalten `input`) ✓.
- **Geprüfte APIs:** Custom-CellType-Vertrag `CellType<TData,TValue,TOptions>` (`types.ts:309-323`):
  alle 9 Member vorhanden und signatur-korrekt (`Cell`, `Editor`, `toText`, `toDisplayText?`,
  `fromText` — never-throwing, `clearValue`, `isEmpty`, `compare?`, `align?`);
  `cellTypes`-Prop auf `DataGridProvider` (REPLACE-Semantik — Demo spreadet `...cellTypes` korrekt
  ein, JSDoc-Callout in `data-grid.tsx:277-282` konsistent); `useSeedFocus(ref, initialText)` +
  `useCommitGuard().tryCommit()` exakt wie die Built-in-Editoren; `CellEditorProps`
  (`value/initialText/onChange/commit/cancel/column`) ✓.
- **Unit-Tests:** `data-grid-custom-cell-demo.test.tsx` (10 Tests: fromText/toText/toDisplayText/
  isEmpty/clearValue/compare + Editor-Fokus) — **10/10 grün**.
- **Status:** OK
- **Änderungen:** keine.

## Quervermerke (keine Defekte, nur dokumentiert)

- `react`-Warning aus `demo:verify` ist global (alle ~42 Items) — Consumer-Boilerplate, kein
  Cluster-Defekt (B-Cluster dokumentiert dasselbe).
- Joi v18 `empty("")` → `{}`-Ergebnis (Standard-Schema-Abweichung, s.o.) ist joi-intern; Demo-
  Verhalten bleibt korrekt. Kein Demo-Fix möglich/sinnvoll.
- Meiner Cluster-Items importieren kein npm-Paket, das in der Repo-`package.json` fehlen würde →
  Task-2-Konflikt-Regel (nur Lead toucht `package.json`) greift nicht.
