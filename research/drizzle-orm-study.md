# Drizzle ORM Integration — Research

**Status:** Research / evaluation — no code yet.
**Date:** 2026-09-22
**Question:** Should gridcn ship installable ORM integrations (Drizzle, Prisma, Supabase, Kysely) as registry add-ons, planned generically — one plan compiler plus a config plus thin adapters — in the spirit of TanStack Table's and tablecn's public Drizzle integrations? Does it fit gridcn's filter/sort model?

## 1. What "the TanStack Drizzle integration" actually is

Verified against primary sources (2026-09-22):

- **No package.** npm registry search for `tanstack drizzle` returns no `@tanstack/*drizzle*` package — only `drizzle-orm` itself and the generic table packages.
- **No code in the TanStack table repo.** The v8 branch `docs/guide` directory (30 files, listed exhaustively) and the v9 `docs` tree contain no drizzle content.
- **What exists is docs-level guidance only:** define your table columns from the Drizzle schema (`makeColumn(users.name, (row) => row.name)` derives `accessorKey`, `id`, and header from the schema object) so the schema stays the single source of truth. The table itself stays **client-side** — filtering and sorting run over the in-memory row model. For server-side work the docs stop at "read `table.getState()`, write your own query."

In short: the reference integration is **schema → column definitions**. There is no automatic filter/sort → SQL generation anywhere in that ecosystem, and no installable artifact.

(The historical v8 guide page is no longer published — the site moved to v9; the assessment above stands on the repo trees and the npm registry.)

## 1b. tablecn (sadmann7/tablecn) — the concrete working reference

Cloned and read (2026-09-22). tablecn's own `DataGrid` is built on TanStack Table v8 (`useDataGrid`, a ~3200-line hook over `useReactTable`), and its site runs exactly the pattern this research proposes — but **as site-local code, not as an installable artifact**:

- **`src/lib/filter-columns.ts` → `filterColumns({ table, filters, joinOperator }): SQL | undefined`** — a pure function mapping its filter state onto a Drizzle `where` clause. ~12 operators: `iLike`/`notIlike` (pg-only, **unescaped** `%value%`), `eq`/`ne` (boolean string coercion; date values expand to a full day `gte(startOfDay)`/`lte(endOfDay)`), `inArray`/`notInArray`, `lt`/`lte`/`gt`/`gte` (branched per column variant: number, or date with day boundaries), `isBetween` (date + number, open-ended bounds; a single bound degrades to `eq`), `isRelativeToToday` (date-fns), `isEmpty`/`isNotEmpty` (raw-SQL `CASE` covering `NULL`, `''`, `'[]'`, `'{}'` — jsonb-aware).
- **Sort mapping is inline** in `src/app/lib/queries.ts`: `sort.map((item) => item.desc ? desc(tasks[item.id]) : asc(tasks[item.id]))`.
- **Server flow:** zod-validated API input → `filterColumns` → `where`, sort → `orderBy`, `limit`/`offset` + `count` in one transaction, Next.js `cacheLife`/`cacheTag` caching.
- **Filter model:** per-column *variant* (`text`/`number`/`date`/`select`/`checkbox`) with a separate operator list per variant (~30 operators total), driven by hand-written column `meta` — no schema → column generation. The one schema-derived touch: `select` filter options from Drizzle `enumValues` (`skaters.stance.enumValues.map(...)`).
- **Not installable:** the Drizzle layer lives in `src/lib` of the website repo; the registry items are the grid components themselves. Nobody else can `shadcn add` this integration.

**Takeaways for gridcn:** the pattern is proven in production; pg-`ilike` as the first-class dialect is the right call; date-`equals` should expand to day boundaries in SQL; `isEmpty` should cover jsonb empties; and Drizzle `enumValues` → `select` cell options is a concrete, cheap win for `columnsFromDrizzle` (answers open question 3). tablecn's rough edges to avoid: unescaped LIKE wildcards, the `isBetween` single-bound → `eq` surprise, and per-variant operator sets (gridcn's single flat closed set of 14 plus `join` maps more cleanly).

## 2. gridcn's current state — why it fits better than TanStack's

gridcn's sort/filter model is a **closed, typed, URL-serializable query language** already:

- `SortSpec[]` (`columnId` + `direction`), multi-sort with stable order — `types.ts:434`.
- `FilterSpec[]` with a **closed set of 14 operators** (`types.ts:436-450`) and three value shapes: single string, inclusive `[min, max]` range, or `string[]` choice list. The closed set is validated at the URL boundary (`data-grid-url-state/filter-operators.ts`).
- `FilterJoinOperator` `"and" | "or"` across the whole filter list — `types.ts:453`.
- The `data-grid-url-state` add-on proves the round trip: `sort=name:asc,age:desc`, `filter=age:gt:30&join=or` — compact, shareable, parseable, stable.
- **The server escape hatch is already in core:** controlled `sortState`/`onSortChange`, `filterState`/`onFilterChange`, `joinOperator`/`onJoinOperatorChange`, `searchText`/`onSearchTextChange` (`store/types.ts:112-122`). The grid reports every user-driven change; the consumer decides whether to apply it locally or query a server. Behavior is test-covered (`test/store.test.tsx:2399ff`).
- Client-side filter semantics are precisely documented in `sort-filter/matches-filter.ts`: case-insensitive text operators, numeric-first comparisons with text fallback, blank cells never satisfy a comparison operator, `isBetween` inclusive with open-ended bounds, `isAnyOf` case-insensitive equality.
- Built-in cell types: `text | number | checkbox | select | date` (`cell-types/cell-types.ts:22`) — the target of schema → column-type mapping.
- Add-on architecture is proven: one block, one barrel, import-boundary lint enforced; external dependencies are declared per item in `registry.json` (`data-grid-url-state` ships with `dependencies: ["nuqs"]` — the shadcn CLI installs it).

## 3. Proposed design — generic plan compiler + thin per-ORM adapters

**Decision: one generic core, one adapter per ORM.** Not per-ORM monoliths, and not a single config-driven emitter:

- **Rejected — single config-driven emitter.** A config file + one engine that emits queries for every ORM has no viable output type: Drizzle wants its expression objects, Prisma wants JS `where` objects, Supabase wants chainable builder calls, Kysely wants its own expressions. The only common denominator is raw SQL strings, which forfeits ORM parameterization, typing, and (for Supabase) RLS behavior. So the per-ORM emit step exists no matter what — the only question is where the *decisions* happen.
- **Chosen — the generic layer holds the decisions.** A pure core add-on compiles gridcn's specs into a **logical filter plan** (column, semantic kind, operator, value, join tree) where every semantic decision is made once and tested once: case-insensitivity policy, `empty`/`notEmpty` → null-or-blank, `isBetween` open bounds, `isAnyOf` lists, LIKE-wildcard escaping, date day-boundary expansion, the columnId whitelist. Each ORM adapter is a thin table-shaped translation of that plan into its own primitives (~100–200 lines each).
- **The config file is the column map** — the one genuinely shared input: `defineGridColumns({ name: { type: "text" }, score: { type: "number" }, createdAt: { type: "date" }, active: { type: "checkbox" } })`. It drives per-column comparison semantics (numeric vs text vs date — gridcn's client compares numeric-first), doubles as the **columnId whitelist** (untrusted client input never reaches a query builder — the docs recipes already mandate this guard), and is generated for free from a Drizzle table via `columnsFromDrizzle` (below). Prisma/Supabase/Kysely have no runtime schema, so their column maps are hand-written (or codegen later).

### 3a. Core: `data-grid-server` (no dependencies)

```ts
const plan = compileFilterPlan(filters, joinOperator, columns);
const orders = compileSortPlan(sorts, columns);
// adapters:
const where = toDrizzle(plan, users, { dialect: "pg" });
const rows = await db.select().from(users).where(where).orderBy(...toDrizzleOrders(orders, users));
```

- `compileFilterPlan` → typed logical plan (all 14 operators resolved to primitives; unknown columns throw — never silently dropped server-side, unlike the URL parser which degrades gracefully).
- `compileSortPlan` → whitelisted `{ columnId, direction }[]`.
- `columnsFromDrizzle(table, opts?)` — Drizzle table → column map (and → `ColumnDef[]` if `opts.withDefs`): name → `id`/`accessorKey`, Drizzle type → cell type (string/text → `text`, integer/real/float → `number`, boolean → `checkbox`, date/timestamp → `date`, enums → `select` with options from `enumValues`, else `text` + dev warning), prettified header.

### 3b. Adapters (one registry item each, `dependencies` per the nuqs precedent)

- **`data-grid-drizzle`** (`drizzle-orm`) — plan → `SQL | undefined` + `orderBy` args. pg first-class (`ilike`), generic `lower()` fallback. The mapping table in section 4 is the implementation spec.
- **`data-grid-prisma`** (`@prisma/client`) — plan → Prisma `where` object + `orderBy`. Mapping: `contains`/`startsWith`/`endsWith` → same names with `mode: "insensitive"` (pg; `mode` support varies by driver — documented), `equals` → `equals` (**delta: Prisma has no case-insensitive equality** — `mode` does not apply to it; v1 accepts case-sensitive equality, raw-SQL escape hatch documented), `isAnyOf` → `in`, `empty` → `OR: [{ col: { is: null } }, { col: { equals: "" } }]`, `notEmpty` → `AND: [{ col: { not: { is: null } } }, { col: { not: "" } }]`, `isBetween` → `AND: [gte, lte]` (open bound drops its side), join `or` → top-level `OR: [...]`. Date `equals`/`isBetween` expand to day boundaries (`gte(startOfDay)`/`lte(endOfDay)`). `orderBy: sorts.map(s => ({ [s.columnId]: s.direction }))`. Tests are plain object equality — no DB needed.
- **`data-grid-supabase`** (`@supabase/supabase-js`) — plan → builder transformations: `withSupabaseFilters(query, plan)` and `withSupabaseSort(query, orders)`. Join `and` → chained filters (`equals`→`.eq`, `contains`→`.ilike(col, "%"+esc+"%")`, `notContains`→`.not(col, "ilike", …)`, `isAnyOf`→`.in`, `isBetween`→`.gte`+`.lte`, `empty`→`.is(col, null)` with the blank-string delta documented); join `or` → PostgREST `.or("col=op.val,…")` mini-language, which has its own escaping rules — the one genuinely fiddly adapter, so its tests use a stub builder that records calls. Pagination is the consumer's `.select("*", { count: "exact" }).range(from, to)` (inclusive `to`), server-side service-role key + RLS notes already live in the docs recipe.
- **`data-grid-kysely`** (`kysely`) — plan → Kysely expressions on string column refs (`where(ref("name"), "like", …)`), dialect-aware like Drizzle (pg/mysql/sqlite). The docs WIP already sketches this one-liner style under the Drizzle recipe — the adapter is its formalization.

Why no hooks in v1: the functions are stateless and the composition point is gridcn's own controlled-props pattern (the docs WIP's `RemoteStateBridge` in `examples/data/server-side` is the exact consumer shape) — the consumer wires `onSortChange`/`onFilterChange` to their data fetch (TanStack Query, SWR, or a plain route handler). An optional `useServerGrid` convenience hook can come later.

## 4. Operator mapping — the plan spec (Drizzle emit shown)

The core resolves every spec to a logical primitive; the adapter renders it per ORM. The
table below is the Drizzle rendering; Prisma/Supabase/Kysely render the same primitives per
section 3b.

| gridcn operator | SQL (generic) | pg | Notes |
| --- | --- | --- | --- |
| `equals` / `notEquals` | `eq` / `ne` | same | client is case-insensitive → `lower(col)` comparison or `ilike`-style equality |
| `contains` / `notContains` | `like("%" + escape(v) + "%")` | `ilike` | LIKE wildcards in user input must be escaped |
| `startsWith` / `endsWith` | `like(v + "%")` / `like("%" + v)` | `ilike` | same escaping |
| `empty` / `notEmpty` | `isNull(col)` / `not(isNull(col))` | same | plus `eq(col, "")` on both sides for text columns (client `empty` means blank text, and NULL renders as blank) |
| `gt`/`gte`/`lt`/`lte` | numeric comparison when the column type is numeric, else text comparison | same | client never matches blank cells → add the non-blank guard (`isNotNull` + `ne("")`) |
| `isBetween` | `and(gt, lte)`; an empty bound drops that side | same | inclusive, matching the client |
| `isAnyOf` | `inArray(col, values)` | `inArray(lower(col), values.map(lower))` | client is case-insensitive; a plain `inArray` diverges on pg |
| join `and` / `or` | `and(...)` / `or(...)` | same | empty list → `undefined`, never a tautology |

**Semantic deltas are the design surface.** The client is deliberately case-insensitive and text-first; SQL is not. The mapping above picks the closest SQL semantics and the add-on documents each delta. A `dialect` option keeps pg (`ilike`) first-class without making every dialect pay for it.

## 5. Assessment

- **Conformance: high.** Same architectural move as `data-grid-url-state` in the opposite direction — grid state ↔ SQL instead of grid state ↔ URL. Pure, stateless, closed-set, typed-spec driven. Core stays ORM-agnostic; the import-boundary lint keeps adapters out of the core block surface.
- **Better than both references.** TanStack's integration stops at column definitions (no query generation); tablecn's works but is site-local, per-variant, and unescaped. The plan-compiler + adapters split delivers what both lack: a closed spec model mapped losslessly, installable per ORM via the registry, with the semantic decisions (escaping, null/empty, case policy, day bounds) made once and tested once.
- **Matches the docs WIP.** The `examples/data/orm/*` recipes (Drizzle/Prisma/Supabase + Kysely one-liner) already standardize the server contract `{ page, pageSize, sorts, filters, join, search } → { rows, total }`. The add-ons harden exactly those recipes: the Drizzle recipe's raw-SQL `like` without escaping and missing `empty`/`isBetween` cases, the Prisma recipe's string-only `empty` (`equals: ""` breaks on numbers and ignores NULL), the Supabase recipe's filter mapping that exists only as a note. Recipes stay as entry-level docs; the add-ons become the tested, installable path.
- **Risks:** (1) semantic drift between client matching and SQL — mitigated by the plan spec table + dialect flags; (2) Supabase `.or()` mini-language escaping — the one fiddly adapter, isolated and stub-tested; (3) ORM API drift — unpinned `dependencies`, tests via each ORM's dry-run (`sqlToQuery`, object equality, stub builder, Kysely `toSql`); (4) Prisma's missing case-insensitive equality — documented delta, not a blocker.
- **Effort:** core `data-grid-server` ~1.5 days; adapters Drizzle ~1.5 d, Kysely ~1 d, Prisma ~1 d, Supabase ~1.5 d; docs page ~0.5 d. Total ≈ 1 work week including tests.

## 6. Open questions

1. ~~Dialect scope for v1: pg first-class or generic only?~~ Settled by the split: Drizzle and Kysely adapters take a `dialect` flag, pg first-class (`ilike`); Prisma uses `mode: "insensitive"` where the driver supports it; Supabase uses `.ilike` (PostgREST is pg-only anyway).
2. All 14 operators in v1 for every adapter, or a conservative subset (`equals`, `contains`, `gt`/`lt`, `empty`, `isAnyOf`) with the rest as a follow-up? The plan compiler must resolve all 14 regardless — the question is only which adapters ship with the full table first.
3. ~~`columnsFromDrizzle` → `select` cell type?~~ Recommended: yes, with options from `enumValues` (tablecn precedent); everything else stays `text`-only.
4. Date semantics for v1: `equals`/`isBetween` on `date`-typed columns expand to day boundaries (tablecn precedent) — confirm against gridcn's date cell type display format.
5. Prisma's missing case-insensitive equality: acceptable as a documented delta for v1, or should the Prisma adapter get a raw-SQL escape hatch (`Prisma.sql`) in v1?
6. Release scope for v1: all four adapters (Drizzle, Prisma, Supabase, Kysely), or Drizzle + one more to prove the adapter pattern first?
7. Docs home: the `examples/data/orm/*` recipes stay as the entry point; each adapter gets an `Add-ons` page cross-linking them.
