# Docs examples — library landscape (2026-09-22)

Research input for plan 013 (docs examples). Question: which third-party libraries do the
examples use, so every example maps 1:1 to what gridcn consumers actually run in production?

Method: grid seams in `registry/default/blocks/data-grid` + established ecosystem knowledge.
Version numbers below are planning values — re-check the current major at implementation time
(one `npm view <pkg> version` per lib).

## 1. Validation

Grid seam: `ColumnDef.validate` accepts a plain fn **or a Standard Schema object** (structural
detection via `isStandardSchema`, `registry/default/blocks/data-grid/validation/`). Plus
`onInvalid: "block" | "warn"` (soft), `use-async-validate` (pending editor state, 32-way batched
bulk), `DataGrid.validateRow` (cross-field), `actions.setCellErrors` (server/post-commit errors).
The cell value (not a row object) is validated — schemas must match the column's value type.

| Library | Fit | Recommendation |
|---|---|---|
| **Zod** (v4) | Standard Schema native; de-facto default in the React ecosystem; most common answer to "which validation lib" | **Flagship example** — `z.number().min(0)`, `z.string().email()` per column |
| **Valibot** (v1) | Standard Schema native; tree-shakeable, tiny; the main Zod alternative in 2025+ | **Second example** — `v.pipe(v.number(), v.minValue(0))` style |
| **ArkType** (v2) | Standard Schema native; type-first ("types as schemas") | Third example (small section) — `a.$("number").check(...)` |
| Yup / Joi | No Standard Schema conformance | Adapter snippet only (wrap `schema.validate` in a fn) — docs text, no demo |

Why this split: the core already detects Standard Schema structurally, so Zod/Valibot/ArkType
need zero adapter code in the examples — the examples can show "drop your schema onto the
column". That is the strongest possible demo of the seam. Non-SS libs get one short adapter
paragraph instead of a demo (they are the minority choice in new React projects).

Existing demo `data-grid-validation-demo` already covers: sync fn (Age), Standard Schema (Email),
async schema with pending state (SKU), `onInvalid: "warn"` (Notes, branch-only). Plan 013 W4
extends it with Zod/Valibot/ArkType columns.

## 2. Data fetching / state

Grid seams: controlled `data` + `onDataChange` (primary), `onRowWindowChange` (lazy windowed
fetch, `data-grid-lazy` add-on), server-mode pagination (`useDataGridPagination`).

| Library | Fit | Recommendation |
|---|---|---|
| **TanStack Query** (v5) | The most-used data-fetching lib in React for years (State of JS #1 since 2023); `useInfiniteQuery` maps naturally onto `onRowWindowChange` | **Flagship live demos** — lazy windows via infinite query against a fake API; plus `useQuery`-based pagination and server-side variants (§5) |
| **SWR** (v2, Vercel) | #2; `useSWRInfinite` is the direct analog | **Second live demos** — same shapes, SWR flavor (pagination + server-side variants, §5) |
| Apollo Client / urql (GraphQL) | Common, but grid + GraphQL is a niche combo | **Recipe only** (code walkthrough: resolver → rows, no live demo) |
| RTK Query | Redux-shop only | Mention one line, no example |
| Plain `fetch` | Baseline | Covered by the existing lazy-loading page; no extra demo |

Both live demos run client-side against a `setTimeout` fake API (no server), so they stay
shadcn-addable registry examples. New devDeps: `@tanstack/react-query`, `swr`.

## 3. ORMs / data sources

The registry distributes client-side React only — a live ORM demo would need a server + DB,
which registry examples cannot ship. So ORM coverage = **recipe pages** (marked "recipe — not a
shadcn registry example"): server code (ORM query → route handler → the grid's server pagination /
lazy window contract) + the client wiring.

| Library | Fit | Recommendation |
|---|---|---|
| **Drizzle ORM** | The TypeScript-native ORM standard in 2025+ (State of JS ORM #1); SQL-first, zero client magic | **Flagship ORM recipe** — Drizzle select → sorted/filtered/paginated rows → `useDataGridPagination` server mode |
| **Prisma** (v6+) | Highest raw install count; client-engine architecture fits API routes | **Second ORM recipe** (same shape as Drizzle, different query language) |
| **Supabase** (Postgres client) | Very common for full-stack React; `supabase.from().select()` returns plain row objects | Bonus recipe (short) |
| Kysely | Typed query builder, growing fast | One-line mention in the Drizzle recipe |
| Knex / MikroORM / TypeORM | Node-ecosystem / legacy | Skip (name only, why-skipped note) |
| Dexie / IndexedDB | Local-first variant | Deferred — not in v1 scope |

Recipes are docs-only code blocks: **no repo dependency added** (they would ship nothing and
only bloat the demo surface).

## 4. Cross-cutting

| Area | Libraries | Recommendation |
|---|---|---|
| i18n | **next-intl**, **i18next/react-i18next**, lingui | Docs mapping section on the i18n example page: `labels` prop takes typed strings → pull them from the i18n lib. No demo (labels are static strings, not a fetch/transform problem) |
| Dates | Day.js, date-fns, Luxon | The date cell stores ISO strings and formats via `Intl`; libs only matter in a custom `renderCell`. One-paragraph mapping, no demo |
| Tables | TanStack Table etc. | **Anti-pattern for examples** — the grid is a custom DOM engine by locked decision (PLAN.md §2); never show a table-abstraction adapter |

## 5. Mapping table (example → library → form)

| Example page | Library | Live demo? | New repo dep |
|---|---|---|---|
| Validation (sync) | none, Zod, Valibot, ArkType | yes (one demo, per-lib columns) | zod, valibot, arktype (devDeps + demo `dependencies`) |
| Async validation | Zod (async) | yes (existing SKU column) | — |
| Server cell errors | — | yes (existing demo) | — |
| Cross-field validation | — | yes (new demo) | — |
| Lazy rows (plain) | — | yes (existing demo) | — |
| Lazy rows + React Query | @tanstack/react-query v5 | yes (new demo) | @tanstack/react-query |
| Lazy rows + SWR | swr v2 | yes (new demo) | swr |
| Pagination (client) | — | yes (existing demo) | — |
| Pagination + React Query | @tanstack/react-query v5 | yes (new demo) | @tanstack/react-query |
| Pagination + SWR | swr v2 | yes (new demo) | swr |
| Server-side remote (sort+filter+search+page) | @tanstack/react-query v5 (SWR as a code section) | yes (new demo) | @tanstack/react-query |
| ORM recipes | Drizzle, Prisma, Supabase | no (recipes) | none |
| i18n | next-intl / react-i18next | no (mapping section) | none |

## 6. Guardrails

- Examples stay dependency-light: a dep is added only when the example's `shadcn add` output
  actually imports it (registry `dependencies` field), and docs-only recipes never add repo deps.
- Every example page shows the exact consumer code (Preview/Code tabs via `ComponentPreview`) —
  the code IS the `shadcn add` output, so library usage must be what a consumer would copy.
- No table abstraction, no canvas, no formulas (PLAN.md §1/§2 non-goals).
