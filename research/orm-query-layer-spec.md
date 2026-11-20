# Spec: server query layer and ORM adapters (issue #38)

Status: the 2.0 cut is implemented (core, Drizzle, Kysely, offset paging, filter values, flat aggregates). See "Implementation status" at the end for what differs from the text below. The Prisma and Supabase adapters, cursor paging, grouping, selection, and write validation followed; pivot is not built.
Input: `research/orm-query-layer-research.md` (SQL semantics, per-ORM primitives, verified probes). Contracts read in the sibling worktrees: lazy paging and server rows, filters, aggregates and lookup, specs and views, write path.

## Goal

A server behind the grid re-implements the same translation in every route handler: sort, filter tree, quick search, row range, row count, set values, aggregates. The recipes in `content/docs/examples/data/orm/` show that translation without LIKE escaping, without null and blank rules, and without a column allow-list on every path. Each reader copies the gaps.

The layer is installable code that does the translation once:

- A core item with no dependencies parses the untrusted request against a column map and produces a typed, ORM-neutral **query plan**. Every semantic decision (escaping, null policy, blank operands, case policy, day bounds, number parsing, bounds) lives there and is tested once.
- One **ORM adapter** item per ORM renders the plan with that ORM's primitives and runs it. (A Prisma "driver adapter" is a different thing; the docs always write "ORM adapter" and "driver adapter".)
- One conformance suite runs every ORM adapter against a real SQL engine and compares the results with the client filter engine on a shared fixture.

The common case is one factory call and one line per route:

```ts
// lib/users-query.ts
const columns = columnsFromDrizzleTable(users, {
  pick: ["id", "name", "email", "role", "score", "tenantId"],
  overrides: { name: { searchable: true }, email: { searchable: true }, tenantId: { serverOnly: true } },
});
export const usersQuery = createDrizzleGridQuery({
  db, table: users, columns,
  rowScope: (session: { tenantId: number }) => ({ tenantId: session.tenantId }),
});

// app/api/users/route.ts
export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return new Response(null, { status: 401 });
  return handleGridRequest(req, usersQuery.fetchRows, { context: session }); // `context` feeds `rowScope`
}
```

`fetchRows` returns the `ServerRowsAnswer` that `useDataGridServerRows` reads, so the client needs no mapping. `handleGridRequest` bounds the body, forwards `req.signal`, and turns a `QueryError` into a 400 without echoing values.

## Non-goals

- No ORM, driver, or migration management. The ORM adapter takes the consumer's client.
- No automatic joins, relations, or computed columns. A column maps to one physical column; a join or a computed value is a database view or a native fragment from `where` and `orderBy`.
- No regex, `SIMILAR TO`, or raw SQL from the request. No request text reaches an identifier or a keyword.
- No full-text search. Quick search is the escaped substring match of the client.
- No grid-side change: the layer reads the grid's wire format and adds no prop or state to the grid.
- No claim of equality with the client engine. The differences are listed and tested (Parity).
- No MySQL or SQL Server support in v1. `dialect` is `"pg" | "sqlite"`; no engine of the other two is in the suite.

## Names and shape

`data-grid-server` is taken by the hook item (`useDataGridServerRows`). The layer follows `data-grid-<thing>`:

| Registry item | Folder | npm `dependencies` (tested range, in `registry.json`) | Registry dependencies |
|---|---|---|---|
| `data-grid-server-query` | `registry/default/blocks/data-grid-server-query/` | none | none |
| `data-grid-server-query-drizzle` | `.../data-grid-server-query-drizzle/` | `drizzle-orm@>=0.45.0 <1` | the core |
| `data-grid-server-query-kysely` | `.../data-grid-server-query-kysely/` | `kysely@>=0.29.0 <1` | the core |
| `data-grid-server-query-prisma` | `.../data-grid-server-query-prisma/` | none (structural delegate types) | the core |
| `data-grid-server-query-supabase` | `.../data-grid-server-query-supabase/` | none (takes the caller's client) | the core |

- An item lists only the packages its code imports at run time, each with the accepted range (CI also tests the latest 0.x minor of Drizzle and Kysely, since 0.x minors can break) (`scripts/verify-registry-dependencies.mjs` fails a dependency without a version, and its import check also matches `import type`, so the Prisma and Supabase adapters type their clients structurally and import nothing). A range that an installed version already satisfies keeps that install, so `shadcn add` does not downgrade a consumer on 0.46 (a second Drizzle copy would break its `is()` checks on the consumer's tables); the implementation confirms this against the shadcn CLI, and if it fails the verifier changes with the reason in the commit. Prisma 7.x and `@supabase/supabase-js` 2.x are the tested lines of the two adapters that declare nothing, stated on the page. Drizzle 1.x and Prisma 8 (the npm `latest` of Prisma is an 8.0 release candidate) get their own tested adapters later; the Drizzle adapter uses `getTableColumns`, not the 1.x API.
- The Prisma adapter types the model delegate structurally, because Prisma 7 imports the client from the consumer's generated `output` path, not from `@prisma/client`; it imports nothing and declares nothing.
- The core imports nothing from `data-grid` at runtime, and nothing from React. It declares the wire types structurally (`QueryRequest`, and `ServerSpec` for the spec). A type test proves a `ServerSpec` and a `ServerRowsPageRequest` minus `signal` assign to them.
- Every file is server-safe: no `"use client"`, no DOM. The code is plain TypeScript and runs anywhere JavaScript runs; the docs say to use it on a server only, and there is no `server-only` import (it is not a provided dependency, throws under vitest, and breaks non-Next servers). The core has its own `is-dev.ts` and its own text-conversion helper (`toSafeText` rule), since it imports no other block.
- Barrels follow AGENTS.md. The import-boundary lint lets an ORM adapter import only the core barrel, so the core has two barrels, as `data-grid` has `data-grid-sdk`: the consumer barrel `data-grid-server-query.ts` exports only what the docs teach a reader to call (`defineColumnMap`, `describeFilterOperators`, `withColumnMap`, `handleGridRequest`, `QueryError`, and the types a reader writes), and `data-grid-server-query-sdk.ts` exports the adapter-facing internals (`parseQuery`, the plan types, `escapeLike`, the operand helpers). The SDK barrel is added to `ALLOWED_BARRELS` in `scripts/verify-import-boundaries.mjs` (an edit listed with B1). Each adapter barrel exports its factory, its option types, and its column helper.
- The conformance harness and the client oracle live in `tests/server-query/` outside the registry folders. They use the grid's SDK exports where they exist (`rowAccessorFor`, `makeFilterPredicate`, `toSafeText`, `operatorsForColumnType`) and path imports for `findSearchMatches` and `defaultCompareText`, so they cannot sit in a block folder (`verify-import-boundaries`, `verify-registry`).

## The column map

`defineColumnMap` is the semantic source, the allow-list, and the projection. (The issue calls it `defineGridColumns`; that reads like the grid's `ColumnDef` list, and `column map` is the term the glossary gets.)

```ts
const columns = defineColumnMap({
  id:        { type: "number", numeric: "int8", primaryKey: true },
  name:      { type: "text", searchable: true },
  email:     { type: "text", searchable: true },
  role:      { type: "select", choices: ["admin", "member"] },
  score:     { type: "number", numeric: "float", aggregate: "avg" },
  active:    { type: "checkbox" },
  createdAt: { type: "date", time: true },          // a timestamp column
  region:    { type: "select", operators: [{ id: "inRegion", label: "In region", input: "single" }] },
  tenantId:  { type: "number", numeric: "int4", serverOnly: true },  // usable in `rowScope`, invisible to the client
});
```

- `type` is the grid cell-type vocabulary: `text | number | checkbox | select | date | url | longText` (the last two behave as `text`). A custom cell type declares `kind` with the same names (`text | number | checkbox | select | date`). `time: true` marks a `date` column that holds instants; day-bound expansion applies only to those.
- Options, all positive and default `false` unless named `enableX`: `primaryKey`, `serverOnly` (never selected, filtered, sorted, searched, grouped, or aggregated for the client; usable by `rowScope`), `searchable` (quick search covers only columns that set it), `filterable` and `sortable` (default `true`; these keep the grid's `ColumnDef` names for one concept, an exception to `enableX`), `required` (a write or an import refuses a blank value; the layer does not assume NOT NULL), `caseSensitive`, `keepBlankText` (a stored `''` is a value, not empty), `time`. `native` marks a `text` or `select` column whose physical PostgreSQL type is not text: `"enum" | "uuid"` (`columnsFromDrizzleTable` sets it from `columnType`; Kysely, Prisma, and Supabase maps declare it). `numeric` names the physical number type of a `number` column: `"int2" | "int4" | "int8" | "float" | "decimal"` (required on every `number` column: `columnsFromDrizzleTable` sets it from `dataType` and `columnType`, a hand-written map declares it, and `defineColumnMap` throws at creation when it is missing, since a wrong default would bind `int8` ids as lossy JS numbers), and `scale` is a number (decimal places, `decimal` only).
- Also: `field` (physical name when it differs from the id), `choices`, `maxLength` (used by write validation), `storage` for dates (`"native" | "iso-text" | "epoch-ms" | "epoch-s"`; the one word names both the column option and the plan field), `aggregate` (one reducer per column: `sum | avg | min | max | count`), `operators` (`{ id, label, input }[]`, custom operators this column accepts; `input` is `none | single | range | list`).
- At most one `primaryKey` (the final sort key; a `serverOnly` primary key is refused at creation, because rows would carry no id for `getRowId`). A `serverOnly` or unmapped id in a request gets the same `unknown-column` error as any unknown id, so a client cannot probe for hidden columns; an unmapped sort key is rejected like an unmapped filter leaf, never ignored. `columnsFromDrizzleTable` sets it from the schema. A table without one passes `defineColumnMap(columns, { tieBreaker } = {})`, an ordered list of unique, non-null, non-`serverOnly` columns; the grid's `getRowId` then combines those columns, and one of the two is required. A column is one physical column; a computed value is a database view.
- The registry is a `Map`; ids are looked up with `Map.get`, never bracket access on request text. The same rule covers operator, join, direction, and reducer lookups (a `Map`, a `Set`, or a `switch`), and the `customOperators` option is copied into a `Map` with `Object.hasOwn`. Rows are keyed by column id (`field` only names the physical column).
- **The projection is the map.** `fetchRows` selects exactly the non-`serverOnly` mapped columns. An unmapped column never appears in rows, filters, sorts, search, filter values, or aggregates. There is no default that maps a whole table.
- Generation helpers live in the ORM adapters, since only they see a schema:
  - `columnsFromDrizzleTable(table, { pick, overrides, tieBreaker })`: `pick` is required, a composite primary key maps to a tie-breaker, and `tieBreaker` names one when there is no key. It reads `getTableColumns` and maps `dataType` to kinds (switch on `dataType`; `columnType` is a hint, since the fields are undocumented and a snapshot test per Drizzle version guards them). Real enums become `select` with `choices`, a Drizzle `numeric` column becomes `numeric: "decimal"` with `scale`, `bigint({ mode: "bigint" })` sets `numeric: "int8"`, unknown types become `text` with a development warning.
  - Prisma 7 removed `Prisma.dmmf`, and the remaining runtime data model has no nullability, so that map is hand-written. `Prisma.ModelName` and `<Model>ScalarFieldEnum` supply names for a type-checked allow-list.
  - Kysely and Supabase have no runtime schema: hand-written.
- `describeFilterOperators(columns)` returns a serializable `{ [columnId]: { operators: (BuiltInFilterOperator | { id; label; input })[]; filterable: boolean; sortable: boolean } }` with no `serverOnly` entry. The client reads `entry.operators` as `ColumnDef.filterOperators`, and pairs `filterable`/`sortable` with the same `ColumnDef` options: a missing `filterOperators` falls back to the client defaults, and a client-only column outside the map (computed, actions) must set `sortable: false, filterable: false`, or it would answer `unknown-column`.
  - Per type name, as the client (`url` and `longText` get the text operators only), the operators are `operatorsForColumnType` minus those the plan rejects (below); custom operators need a `label` in the map. The core copies `operatorsForColumnType`, and a harness test compares the copy with the client function.
  - `withColumnMap(columnDefs, descriptor)` is a pure, structural helper in the consumer barrel that merges `filterOperators`, `filterable`, and `sortable` into the grid's `ColumnDef`s and sets `sortable: false, filterable: false` on ids the descriptor lacks (computed and actions columns). It imports nothing from `data-grid`, so the docs example is one call and the stock UI never sends `contains` on a number column.
  - The column map lives with the database, so the docs route the descriptor to the client as JSON (a server component, or a route), or split the map into an ORM-free module that both sides import; a client component never imports the module that holds `db` and the table.

## The query plan

`parseQuery(input: unknown, options: { columns, request: "rows" | "values" | "aggregates", paging?, rowCount?, limits?, timeZone? })` is the only entry that touches untrusted data; `request` selects the shape. It returns the `QueryPlan` variant that `request` names (below; `runCount` comes from `paging` and `rowCount`, and exists only on `rows`) or throws `QueryError { code, path }` where `path` holds indices, never request text, and the message never echoes values.

```ts
type QueryRequestKind = "rows" | "values" | "aggregates";
type QueryPlan =
  | { kind: "rows"; where: Predicate; orderBy: readonly OrderTerm[]; rowRange: { start: number; end: number };
      runCount: boolean; projection: readonly PlanColumn[] }       // orderBy is always a total order: user keys, then the tie-breaker
  | { kind: "values"; where: Predicate; column: PlanColumn; query: string }
  | { kind: "aggregates"; where: Predicate; columns: readonly { column: PlanColumn; reducer: "sum" | "avg" | "min" | "max" | "count" }[] };
// `where` is `{ t: "true" }` when nothing filters; the factory's `parse` adds `rowScope`, `parseQuery` plans have none.
declare function parseQuery<R extends QueryRequestKind>(input: unknown, options: { request: R /* … */ }): Extract<QueryPlan, { kind: R }>;
type Predicate =
  | { t: "true" } | { t: "false" }
  | { t: "and" | "or"; items: readonly Predicate[] }
  | { t: "leaf"; column: PlanColumn; test: Test };
type Test =
  | { k: "eq" | "ne"; value: Operand }                  // `ne` includes NULL rows
  | { k: "text"; mode: "contains" | "startsWith" | "endsWith" | "equals"; text: string; negate: boolean; caseSensitive: boolean }
  | { k: "cmp"; op: "gt" | "gte" | "lt" | "lte"; value: Operand }
  | { k: "range"; lo?: Operand; hi?: Operand; hiExclusive: boolean }
  | { k: "in"; values: readonly Operand[]; negate: boolean; blank: boolean; caseSensitive: boolean }
  | { k: "exact"; value: Operand }                      // rowScope only: `col = $1`, case-sensitive, NULL never matches
  | { k: "blank"; negate: boolean }                     // empty / notEmpty
  | { k: "custom"; id: string; value: unknown };
type Operand = { kind: "text"; v: string } | { kind: "number"; v: string }   // exact decimal string
             | { kind: "bigint"; v: bigint } | { kind: "boolean"; v: boolean }
             | { kind: "date"; v: string } | { kind: "instant"; v: string };  // ISO, explicit offset
type OrderTerm = { column: PlanColumn; direction: "asc" | "desc" };            // NULLs last
```

How a request becomes a plan:

- **Request shape.** A non-empty `spec.groupBy` or `spec.pivot`, a non-empty `groupPath`, or `childKind: "groups"` is answered with `unsupported` (`spec.aggregates` is ignored until the slice ships) until the grouping slice ships (a flat answer would fail `readGroupsAnswer` far from the cause). Unknown top-level keys are ignored (a client that sends `JSON.stringify(request)` includes `"signal":{}`). A group `join` other than `"or"` is `and`, as on the client.
- **Filters.** The wire tree is `FilterNode[]`: a leaf `{ columnId, operator, value? }` or a group `{ join, filters }`, top level `and`. Depth above 2 is `limit-exceeded` (the client drops such a group; the server must never widen a result). `filterId` is ignored. An empty group is `true`. Empty groups and lists are normalized away here, so no ORM adapter sees an empty `and`, `or`, or `in` (Drizzle gives `undefined`, Kysely `1 = 1`/`1 = 0`, Prisma `OR: []` matches nothing).
- **Blank operands first.** The grid creates a new filter row with an empty value (`""`, `["",""]`, `[]`), and the stock UI sends it before the user types. The plan evaluates the blank operand before the kind check, using the client's meaning:

  | Operator with a blank operand | Plan |
  |---|---|
  | `equals ""` | `blank` |
  | `notEquals ""` | `notBlank` |
  | `contains ""`, `startsWith ""`, `endsWith ""` | `true` (every row, NULL included) |
  | `notContains ""` | `false` |
  | `gt ""`, `gte ""` | `false` |
  | `lt ""`, `lte ""` | `notBlank` (the client sorts `""` last) |
  | `isBetween ["",""]` | `notBlank` |
  | `isBetween ["a",""]` or `["","b"]` | one-sided range over non-blank rows |
  | `isAnyOf []` | `false` |
  | `isNoneOf []` | `true` |

  `notBlank` and `blank` follow the column kind (text: NULL or `''`; others: NULL).
- **Operators.** The 15 built-ins compile to the tests above. An operator that is not built in must be declared in the column's `operators`; the value shape is checked against the declared `input` and bounded; the leaf becomes `custom`. An undeclared id is `unknown-operator`. Each ORM adapter factory takes `customOperators: { [id]: (ctx: { column, value }) => NativeWhere }` (the handler must bind `value` through the ORM, and the docs example does) and throws at creation when a declared id has no handler.
- **Operators per kind.** After the blank step, `contains`, `notContains`, `startsWith`, and `endsWith` on `number`, `date`, and `checkbox` columns are `operator-not-allowed`, and `gt`, `gte`, `lt`, `lte`, and `isBetween` on `checkbox` and `select` likewise (`equals`, `notEquals`, `empty`, `notEmpty`, `isAnyOf`, `isNoneOf` stay valid). The stock filter UI offers `contains` first on `number`, `date`, and `checkbox` columns, so the docs require `filterOperators` from `describeFilterOperators(columns)` and the add-on page says so. Open question 2 weighs a `textCast` option.
- **Values** parse by column kind before any SQL. Numbers use the HTML "valid floating-point number" grammar (so `1e5` and `.5` pass, because the stock `type="number"` input sends them), anchored, at most 40 characters: no `NaN`, no `Infinity`, no separators; on an `int2`, `int4`, or `int8` column the bound is resolved with exact decimal math (the decimal string and `BigInt`, never a JS `Number`, because an `int8` bound can exceed 2^53) and keeps the column's own parameter type (a PostgreSQL `numeric` cast would stop it from using the integer index): `gt x` becomes `gt floor(x)`, `gte x` becomes `gte ceil(x)`, `lt x` becomes `lt ceil(x)`, `lte x` becomes `lte floor(x)`, a non-integer `equals` is `false`, a non-integer `notEquals` is `true` (NULL included). A bound outside the column's width clamps by sign (above the maximum, `lt`/`lte` match every non-NULL row and `gt`/`gte` match none; below the minimum, the reverse; `isBetween` clamps each side), and an out-of-width `equals` is `false` and an out-of-width `notEquals` is `true` (NULL included; PostgreSQL would otherwise raise `out of range`, a 500), and an out-of-range or non-integer entry of `isAnyOf` or `isNoneOf` is dropped (`isNoneOf` then matches more, NULL included; an empty list follows the table above). A `float` column binds a finite JS number (a non-finite result such as `1e999` clamps by sign, so nothing reaches `float8` overflow), and a `decimal` column binds the exact string with an explicit cast. The grammar bounds the exponent (at most 4 digits) The grammar bounds the exponent (at most 4 digits) and the values resolve in JS, so `1e99999999` cannot reach a `numeric` overflow; decimals on `scale` columns stay exact strings. Dates accept `YYYY-MM-DD`; `time` columns also accept ISO instants. The blank test runs on the raw string; a whitespace-only number, date, or boolean operand is unparseable (not blank), and other number, date, and boolean operands are trimmed; text operands are not (trimming `" "` would turn `contains " "` into a blank operand). The stock number and date inputs send `""` while the user types, so half-typed text arrives as a blank operand; an unparseable non-blank value comes from URL state, controlled state, or a custom input. It does not fail the request: a positive test (`equals`, `gt`, `gte`, `lt`, `lte`, `isBetween`) compiles to `false`, and a negated test (`notEquals`) compiles to `true`, every row with NULL included (the client's `text !== value` holds); an unparseable entry of a list is dropped. `invalid-value` is only for values beyond the limits. As on the client, a non-string `value` reads as blank, a non-array `isBetween` value as `["",""]`, and non-string list entries are dropped. Booleans match `true | false` case-insensitively and `1 | 0` (the client lowercases both sides, so `TRUE` already matches there; only `1` and `0` differ).
- **Day bounds.** On a `time` column, `equals`, `notEquals` (the negated range, NULL included), `isAnyOf` and `isNoneOf` (an OR or a negated OR of day ranges), `gt`, `gte`, `lt`, `lte`, and `isBetween` expand to half-open ranges between local midnights in `timeZone` (default `UTC`), computed in JS and bound with explicit offsets (with `storage: "iso-text"`, bounds use the storage format: UTC, fixed precision, since text order breaks on mixed offsets). `filterValues` on a `time` column groups by local day in `timeZone` and returns `YYYY-MM-DD` values; SQLite has no zone data, so on SQLite `timeZone` must be `"UTC"` or a fixed offset when a `time` column offers set values (capability `localDayGrouping: false`, checked at creation). A local midnight that does not exist (a DST gap) is the first instant of that local day. `23:59:59.999` is never used. A `date` column compares dates directly.
- **Native string types.** On a `native: "enum"` or `"uuid"` column, blank is NULL only (never compare with `''`, which PostgreSQL rejects for both types); `contains`, `startsWith`, `endsWith`, case-insensitive `equals`, quick search, and the value query render on `col::text` (PostgreSQL has no LIKE operator for enum or uuid); `equals` and list operands are validated first (an enum value that is not in `choices` compiles to `false` or is dropped from a list; a uuid is an anchored grammar, else unparseable) and then bound with the native type. The fixture carries an enum, a uuid, and a `real` column with a conformance case per operator, since the suite cannot catch what its fixture lacks.
- **Null and blank.** `notEquals`, `notContains`, and `isNoneOf` match NULL rows (the client reads NULL as `""`), by an explicit `OR IS NULL`. `empty` is NULL, plus `''` for text kinds unless `keepBlankText`. A blank entry in a set filter is a sentinel: `isAnyOf ["a", ""]` is `IN (a) OR blank`, and `isNoneOf ["a", ""]` is `NOT IN (a) AND notBlank` (the one negative form that excludes NULL, because the user excluded blanks).
- **Blank text in comparisons.** Every `cmp` and `range` test on a text kind adds `col <> ''` unless the column sets `keepBlankText` (the client fails blank text for `gt`, `gte`, `lt`, `lte`, and `isBetween`; SQL `'' < 'b'` is true).
- **Case.** On SQLite `LIKE` has no case-sensitive form, so a `caseSensitive` text test renders as `instr(col, ?) > 0` (`contains`), `substr` comparisons (`startsWith`, `endsWith`), and `=` (`equals`); the conformance suite verifies these (an unverified rendering until then). `equals` on a `select` column is a case-insensitive text test like the client (`caseSensitive` flips it); `isAnyOf` and `isNoneOf` compare case-insensitively like `equals` unless the column sets `caseSensitive`.
- **Lists** are capped (1,000 values of 256 characters each per list, 5,000 values in the whole tree). On PostgreSQL a list binds as one array parameter (`= ANY`) and on SQLite through `json_each(?)`, so the parameter count does not grow with the list (an `isAnyOf` on a `time` column is one day range per entry, two parameters each); elsewhere the tree-wide cap keeps the total under every driver limit.
- **Sort.** Keys in request order, each NULLs last in both directions (the client sorts empty values last whatever the direction). Duplicate columns keep the first. The tie-breaker is appended; with no sorts the order is the tie-breaker alone.
- **Search.** `searchText` is trimmed; blank is `true`. With no `searchable` column the factory warns in development and a search phrase is `true`; the 16-column cap is checked at creation. Otherwise the literal phrase is a case-insensitive `contains` OR-ed over the `searchable` text and `select` columns (a `select` column matches the stored value; the client matches the label, a listed difference), and over `searchable` number columns only when the phrase is exactly a number (the client matches substrings of the number's text, a listed difference). `searchable` on a `date` or `checkbox` column is refused at creation.
- **Row range.** The request carries `start`/`end`; a pages request also carries `page`/`pageSize`. When `page` is present the range derives from it, `start` must equal `(page - 1) * pageSize` (else `invalid-value`), and `pageSize` is bounded by `maxPageSize`. The limit `end - start` is at most `maxPageSize`. There is no default `maxOffset` (see Limits).

### Limits

All overridable, all enforced by `parseQuery` before the tree is walked: 128 filter nodes in total (groups included) and 64 leaves, depth 2, 64 sort keys (at least the client's URL-state caps of 64 filters and 64 sorts; a request above a cap is a 400 and the grid shows its error state, which the page documents, as it does for the quick-search and filter-value text caps the client does not enforce), value 256 characters (number 40), lists 1,000 (5,000 values and 256 KiB of string content in the whole tree), search phrase 128 characters and 16 searched columns, page size 1,000 (1,000 also matches the hosted Supabase default row cap), value-query text 128 characters, cursor 512 bytes, `maxSelectionIds` 200,000 (the grid's 100,000 remembered rows plus 100,000 loaded rows; the selection endpoint of the 2.x slice takes its own body cap, since 200,000 ids exceed the 512 KiB default), group keys 1,024 characters and at most 4 group-by keys, 20 aggregates, 200 pivot columns. `maxOffset` has no default: a default would make the pager and random-access scroll offer ranges the server rejects above 100,000 rows, which is the repo's target size. A consumer who sets it gets `offset-too-deep` for `start > maxOffset` (the count stays the real count, so the selection count stays right), and the docs pair deep ranges with a statement timeout. A conformance case covers "count above `maxOffset`, last page".

## Paging and counting

- **`paging: "offset" | "cursor"` is a factory option, default `"offset"`.** The grid decides random access or sequential from the first answer, not from the request: an answer with `totalRowCount` makes it random access, and the first request of every source carries `cursor: undefined`. So the ORM adapter cannot infer the strategy and the consumer chooses it.
- **Offset (v1).** Works for pages mode and random-access scroll. The count query rule depends on the source. Pages mode (the request carries `page`) counts on every request, because a deep link or a controlled `page` can start above row 0. Scroll mode counts when `start === 0` (`rowCount: "firstBlock"`, default for scroll): the grid keeps the last known count when an answer omits it, and a spec change returns to start 0. `rowCount: "always"` recounts every range and `"none"` never counts (the answer then carries `hasMore` from a `limit + 1` fetch). After parse the plan carries `runCount: boolean` for this request (pages mode counts unless `rowCount` is `"none"`). `"firstBlock"` has a limit: a scroll `refresh()`, a revalidation tick, and the reshape after a save refetch the rendered blocks, not block 0, so the answer omits the count and the grid keeps the old one after inserts and deletes. Writable scroll grids use `rowCount: "always"`. Open question 11 asks for a refresh flag in the contract. The count and the page share one predicate object, so they cannot drift; two statements at READ COMMITTED are not one snapshot, and the docs say so. `totalRowCount` is a safe integer or `null`, and the answer clamps it to the grid's bound (10,000,000).
- **Cursor (2.x slice).** Sequential sources only: every answer, the first included, omits `totalRowCount` and carries `nextCursor`; pages mode cannot use it. The cursor holds the key values (read as text, with a per-dialect cast, so a JS `Date` cannot lose microseconds) and a hash of the normalized plan (sorts and filters after parse, never the raw JSON). Cursor mode refuses a sort column without a bounded `maxLength` and caps the sort keys at 4 plus the tie-breaker, so the server's own cursor never exceeds `maxCursorBytes` (the factory checks that worst case at creation). The decoder bounds it (`maxCursorBytes`), runs the operand parsers on every value, and a hash mismatch is `bad-cursor`. The resume predicate is the expanded OR form, which handles mixed directions and NULLs; row-value comparison does not. Values reach the database only as bound parameters, so a forged cursor can move the position and nothing else, and there is no HMAC. 
- **Serializer.** One serializer handles rows and filter values. Numbers that are exact safe JS numbers stay numbers (the `number` cell type holds `number | null`); a `bigint` becomes a string, and a decimal becomes a string only on a column that declares `scale` (documented with a text or custom cell type). `date` is `YYYY-MM-DD` text (node-postgres would read it as a local `Date` and shift a day), instants are ISO strings with `Z` (PostgreSQL `timestamptz` text depends on the session `DateStyle`, so the adapter formats it). `Response.json` would throw on a `bigint`. Conformance cases read every kind back, and a returned filter value is accepted again as an `isAnyOf` entry.

## ORM adapter contract

```ts
declare function handleGridRequest<TContext, TAnswer>(
  req: Request,
  run: (input: unknown, ...opts: CallArgs<TContext>) => Promise<TAnswer>,
  ...opts: [TContext] extends [never] ? [opts?: { maxBodyBytes?: number }] : [opts: { context: TContext; maxBodyBytes?: number }]
): Promise<Response>;
```

`context` is required when the factory sets `rowScope`, so a route that forgets it does not compile (a `@ts-expect-error` type test covers it). The `GridQuery` methods are own arrow-function properties, so passing `usersQuery.fetchRows` unbound is safe (a test covers it).

```ts
interface GridQuery<TRow, TContext = never, TCursor = never> {
  fetchRows(input: unknown, ...opts: CallArgs<TContext>): Promise<ServerRowsAnswerShape<TRow, TCursor>>;
  filterValues(input: unknown, ...opts: CallArgs<TContext>): Promise<{ values: { value: string; label?: string; count?: number }[] }>;
  aggregates(input: unknown, ...opts: CallArgs<TContext>): Promise<Record<string, number | string | null>>;
  parse(input: unknown, ...opts: CallArgs<TContext>): Extract<QueryPlan, { kind: "rows" }>;   // `values` and `aggregates` plans stay internal to their methods
  // native fragments for a join or a custom select; they accept only plans of this factory (`rowScope` and the allow-list already applied)
  where(plan: Extract<QueryPlan, { kind: "rows" }>): NativeWhere;      // a `rows` plan of this factory
  orderBy(plan: Extract<QueryPlan, { kind: "rows" }>): NativeOrder;   // a `rows` plan only (a type error and a runtime throw otherwise)
  capabilities: AdapterCapabilities;
}
type CallArgs<TContext> = [TContext] extends [never] ? [opts?: QueryCallOptions] : [opts: QueryCallOptions<TContext>];   // a rest tuple, so `fetchRows(input)` fails to compile when `rowScope` needs `context`
type QueryCallOptions<TContext = never> = { signal?: AbortSignal } & ([TContext] extends [never] ? { context?: undefined } : { context: TContext });   // `context` feeds `rowScope` and is required when the factory sets it
```

- `ServerRowsAnswerShape<TRow, TCursor = never>` is `{ rows: TRow[]; totalRowCount?: number | null; hasMore?: boolean; nextCursor?: TCursor | null }` (the grid types `ServerRowsAnswer<TData, TCursor = never>`; an offset factory returns `TCursor = never`, and only `paging: "cursor"` returns `string`), the answer `useDataGridServerRows` reads (`ServerRowsAnswer`). `QueryCallOptions` defaults to `{}` when no `rowScope` is set; with `rowScope`, `context` is required through the `TContext` rest tuple and a `@ts-expect-error` type test covers the omitted call. A `rowScope` without a parameter infers `TContext = never`; the missing-context throw still guards it (no `Function.length` check, which default parameters defeat).
- **`rowScope`** (the word `scope` already names options elsewhere in the grid) is a factory option: `rowScope: (context) => Record<columnId, scalar>`. It returns equalities on `serverOnly` columns (for example `{ tenantId: context.tenantId }`), AND-ed into the plan by the factory's `parse` (the core's `parseQuery` does not know `rowScope`, so its plans never reach `where`). It fails closed: a return that is not a plain object with at least one key throws (an empty object would AND nothing and widen to every tenant; "all rows" is a factory without `rowScope`), each entry compiles to a dedicated exact test (`{ k: "exact" }`: plain `col = $1` under a deterministic collation (no `COLLATE "C"`, which would skip the tenant index; nondeterministic collations and case-insensitive column collations (PostgreSQL `citext`, SQLite `COLLATE NOCASE`) are documented with a warning on the page, since no adapter can detect them, and tenants `Acme` and `acme` would see each other), no LIKE, no blank-operand table, no day expansion, NULL never matches), and `undefined`, `null`, `NaN`, `""`, whitespace-only text, an unparseable value, a non-scalar value, a number that is not a safe integer on an `int2`/`int4`/`int8` scope column (a JS `bigint` is accepted on `int8` and refused on `float` and `decimal` scope columns), or a key that is not in the map throws (otherwise `?? ""` would match the NULL-tenant rows, and tenants `Acme` and `acme` would see each other) (a 500, never a widened result; Prisma would drop an `undefined` filter and return every tenant). A factory that sets `rowScope` and receives a call without `context` throws. Every method (`fetchRows`, `filterValues`, `aggregates`) builds its predicate through the same internal function, and a test per method asserts that the row scope applies and that each bad value throws.
- **Plans are branded.** Each factory instance keeps a private `WeakMap` from the plan objects its own `parse` returns to a frozen internal copy. `where(plan)` and `orderBy(plan)` render from that copy, never from the argument (so `plan.where = …` after `parse` changes nothing), and throw on a plan from the core's `parseQuery`, a hand-built plan, or another factory, including another factory of the same adapter. Plans are deep-frozen. A test covers each refusal. Row-level security stays the database's job.

What each ORM adapter implements:

1. Render every `Test` kind and the predicate tree. The renderer is exhaustive over the plan types (a `never` check), so a new test kind fails every adapter at build time.
2. Bind every value as a parameter. The only SQL text it writes comes from closed tables (operator, direction, null placement, escape clause, aggregate function). Column references come from the map.
3. Declare `capabilities` (`caseInsensitiveText: "native" | "ascii" | "collation"`, `likeEscape`, `literalAsterisk`, `nullsLast: "native" | "emulated"`, `aggregates`, `groupBy`). The suite reads them to choose expected results; a skipped case needs a named `KNOWN_DIFFERENCES` entry with a reason.
4. Honor `AbortSignal` where the ORM offers it; otherwise say so in the docs. Aborting the JS call does not cancel a running PostgreSQL query, so the docs recommend `statement_timeout`.
5. Never log values.

Per-ORM notes (details and probes in the research, parts 2 and 3):

- **Drizzle (0.45).** The factory derives `dialect` from the table (a mismatch cannot happen); Kysely takes `dialect: "pg" | "sqlite"`. `ilike` compiles on every dialect and fails on SQLite at run time, so the adapter picks `ilike` (pg) or `like` (SQLite, ASCII-insensitive) from `dialect`. LIKE is `sql` with `ESCAPE '!'` and a bound pattern (`like()` and `ilike()` have no ESCAPE argument and do not escape). NULLS LAST goes through `sql`. Columns resolve through `getTableColumns` into a `Map` with `Object.hasOwn`. `and()` and `or()` of zero arguments return `undefined`, so the renderer never emits them. Spec strings are coerced to the column's JS type first (a string against a `mode: "date"` column throws; SQLite timestamps bind epoch seconds). Sums, averages, and `numeric` return strings; counts use `mapWith(Number)` with a safe-integer check.
- **Kysely (0.29, ESM, Node 22+).** Column references through `eb.ref` or `sql.id` of mapped names, always qualified with the table (a bare name is ambiguous in a join, the stated use of `where(plan)`) (`eb.ref` parses dots and ` as `). The ESCAPE fragment goes on the right operand. An empty `in` emits `in ()`, invalid on PostgreSQL, and `HandleEmptyInListsPlugin`'s push strategy drops NULL rows, so the renderer short-circuits empty lists. `nullsLast()` exists on pg and SQLite.
- **Prisma (7.x object API).** Verified: `contains`, `startsWith`, and `endsWith` do not escape `%` and `_`, and there is no ESCAPE clause. On PostgreSQL the adapter escapes with a backslash and uses `mode: "insensitive"`; case-insensitive equality is `in: [v], mode: "insensitive"`. On SQLite a backslash is literal, so only a value holding `%` or `_` in a `contains`, `startsWith`, or `endsWith` leaf is `unsupported-value` (`equals` does not compile to LIKE) (`likeEscape: false`). It never passes `undefined` (the filter vanishes), drops empty groups, emits `nulls: "last"` only for nullable fields (a wrong hand-written `required` makes Prisma reject the sort, so a conformance case covers it), parses values per field type (Prisma rejects strings for `Int` and echoes field names), and converts `Decimal` and `bigint` to strings. Set values use `groupBy`, never `distinct` (in-memory).
- **Supabase (PostgREST).** One `quote()` wraps and backslash-escapes every value in `or=(…)`, `and=(…)`, and `in.(…)`; postgrest-js `.in()` does not escape `"` or a backslash and `.or()` passes its string raw (both shown to allow grammar injection). Per the PostgREST source, `*` is a wildcard alias in `like`/`ilike` (derived from source; the PostgREST job in CI verifies it), so a literal `*` cannot match and is `unsupported-value`. Negative operators add an `is.null` branch; text `notEquals` is `or=(col.not.ilike.<quoted>,col.is.null)` because `isdistinct` is case-sensitive (it stays for other kinds and `caseSensitive` columns). Aggregates are off by default and cannot order by an aggregate. Rows and counts use the builder. Set values and aggregates need an RPC that honors the filter tree (aggregates also quick search, since `FetchFilterValuesContext` carries no `searchText`) and `rowScope`, because PostgREST filters on a table-valued RPC apply to its output rows, not the base rows; the contract is the plan as a JSON argument with closed operators in a `SECURITY INVOKER` function (so row-level security applies), and the docs supply and snapshot-test that SQL. Until a consumer wires the functions, `filterValues` and `aggregates` throw `unsupported`. The adapter caps the request URL (`maxUrlLength`, default 8,000 characters, then `limit-exceeded`), since the list limits allow far more than a URL carries. The adapter takes the caller's client; the docs show forwarding the user's JWT because the secret key bypasses row-level security. With a user JWT the browser can call PostgREST and the RPC directly, without the route and without `rowScope`, so on Supabase `rowScope` only narrows the route's own queries and RLS is the only tenancy boundary (the page says so). The RPC SQL checks every identifier against its own hard-coded allow-list (`format('%I')` only after that check), binds every value through `USING`, and rejects unknown operators; hostile-JSON snapshot tests run against the PostgREST container.

### Conformance suite

One data-driven suite in `tests/server-query/`, run by a separate vitest project `conformance` (own CI step and timeout; it boots engines and, for Prisma, runs `prisma generate` into a git-ignored folder with `CHECKPOINT_DISABLE=1`). It stays out of the unit gate.

- **Engines.** SQLite through `better-sqlite3` 13 (prebuilt binaries; `node:sqlite` is unusable because Drizzle has no driver for it and Kysely's `SqliteDialect` silently returns no rows) and PGlite (WebAssembly PostgreSQL). No mocked builder decides a semantic. Drizzle and Kysely run on both (Kysely 0.29 ships a `PGliteDialect`). Prisma runs on PGlite through `@electric-sql/pglite-socket` with `@prisma/adapter-pg`, and on SQLite through `@prisma/adapter-better-sqlite3`. Supabase gets URL-grammar tests through a capturing `fetch`; its semantic cases run in an optional CI job against a PostgREST container. Measured startup (research part 2): PGlite 1.5 to 3.6 s per instance, so one instance per file, reset between cases; the total suite time is measured at implementation, not assumed.
- **Fixture.** One table, about 60 rows: NULL and `''` in every text column; mixed case, accents, `ß`, `İ`; values containing `%`, `_`, `!`, `\`, `[`, `*`, quotes, `--`; numbers around 0, negatives, decimals, `2^53 + 1`, and the maximum plus one and minimum minus one of `int2`, `int4`, and `int8`; a nullable boolean; timestamps at `23:59:59.999999`, midnight, and a DST change; duplicates in sort columns. The same literals feed every engine and the client oracle.
- **Cases.** `{ name, spec, rowRange, parity: "oracle" | KNOWN_DIFFERENCES key, expected? }`. Each operator runs on each applicable kind, in groups, with and without NULLs, plus every blank operand of the plan table. About 150 cases.
- **Oracle.** The client's tree evaluator (`makeFilterPredicate(rowAccessorFor(columns, fixtureRows, cellTypes), filters)` from the SDK with real `ColumnDef`s, plus `findSearchMatches` for search) runs over the fixture literals, never over rows read back from a driver (a driver `Date` would stringify differently). The harness does not write its own and/or logic; the join fallback, empty group, and per-column compare come from the client. Only parity-safe cases use it: ASCII text, no case folding beyond ASCII, no collation-dependent order. `defaultCompareText` uses a module-level `Intl.Collator` in the host locale, so text-order and folding cases are `KNOWN_DIFFERENCES` with explicit expected ids and never depend on the CI machine's locale.
- **Plan tests** need no database: bounds, allow-list (prototype keys, unknown ids, `serverOnly` columns), value grammar, depth, hostile digit runs (assert the anchored grammar and the length cap, never wall-clock time), the blank-operand table, `rowScope` applied (and failing closed) by every method, and snapshots of plans for the 15 operators.
- **Injection tests.** SQL metacharacters and URL-grammar characters run through every operator and return the rows of the same literal text.
- **Projection tests.** An unmapped or `serverOnly` column never appears in rows, filters, sorts, search, filter values, or aggregates.
- **Property tests.** Random trees over the parity-safe subset compare ORM adapter results with the oracle, from a fixed, logged seed. `caseInsensitiveText` is a capability per engine (PGlite's locale limits non-ASCII folding, so production PostgreSQL folding is not verified by it).

## Parity with the client engine

The client filters the `toSafeText` of the raw cell value (not formatted display text). Quick search reads `toSearchText`. Every row is a conformance case.

| Topic | Client | Server | Decision |
|---|---|---|---|
| Case folding | JS `toLowerCase` | `ILIKE`/collation per dialect; SQLite ASCII only | server decides; documented per dialect |
| Text order | `localeCompare` in the `text` cell type; `Intl.Collator` (numeric-aware) without cell types | database collation | server decides; the grid never re-sorts server pages |
| `select` order | by choice rank | by stored value | differs |
| Blank sorting | `""` last, both directions | NULL last; `''` not moved | difference |
| Blank operands | per the table above | same | same |
| Text compare (`gt…`) | numeric when both sides parse, else collator | typed by column kind; text columns use collation | differs on text columns |
| Non-numeric bound on a number column | text fallback; `notEquals` matches every row | positive tests match nothing, `notEquals` matches every row | differs for ordering tests; no 400 |
| Boolean text | case-insensitive text `true`/`false` | the same, plus `1`/`0` | server also accepts `1`/`0` |
| Aggregates | pinned-row reducers count `''` today | the grouping spec's rule (skip `''`, finite numbers) | differs until the client aligns |
| `equals`, `isAnyOf` on number columns | text equality (`"1.5"` is not `"1.50"`) | numeric equality | differs; server is numeric |
| `isAnyOf`, `isNoneOf` case | case-insensitive | case-insensitive unless `caseSensitive` | same |
| `contains`, `notContains`, `startsWith`, `endsWith` on number/date/checkbox | match the text | `operator-not-allowed` | server rejects; use `describeFilterOperators` |
| `notEquals`, `notContains`, `isNoneOf` on NULL | match | match | same |
| `empty` on text / on other kinds | `""` only | NULL or `''` / NULL | same |
| Whitespace-only text | not empty | not empty | same (padding on `=` varies by engine) |
| Group depth above 2 | group dropped | `limit-exceeded` | server rejects |
| Day match on timestamps | `equals` is full-text equality and never matches a timestamp; `gt "2024-01-01"` matches same-day timestamps by text order | half-open local day in `timeZone` | differs; server follows the calendar |
| Custom operator without `match` | passes every row | requires a handler at creation | server rejects at setup |
| Column `filterCompare` option | honored | ignored | differs |
| Quick search on date and checkbox columns | searches the text | refused at creation | differs |
| Number parse | `Number()` accepts `"1."`, `"0x10"`, `" 5 "` | the HTML floating-point grammar | differs |
| Quick search on number columns | substring of the text | equality when the phrase is a number | differs |
| Quick search | highlights matches and never filters rows (GLOSSARY); literal trimmed substring of any cell's search text; `SearchOptions` (`matchCase`, `wholeCell`) | narrows the result; substring over `searchable` columns; `select` by stored value | differs; `SearchOptions` never reach the wire; the glossary gets a server-mode line |
| Formatted values | n/a | the client sends stored values | formatted text is never sent |
| Prisma on SQLite | n/a | `equals` is case-sensitive | capability, documented |

## Plugging into the grid

- **Rows.** `useDataGridServerRows({ fetchRows })`: the consumer's `fetchRows` posts `{ spec, start, end, cursor, page, pageSize }` (all but `signal`) and returns the JSON. The ORM adapter's `fetchRows` accepts exactly that. A server action receives the request object without `signal`, which cannot cross the action boundary.
- **Filter values.** `fetchFilterValues({ columnId, query, filters })` posts to `filterValues`: all filters except the column's own set entry, an escaped `contains` on `query` (at most 128 characters) against the value's text form (text and `select`: the value; `number`: a text cast per dialect; `date`: the `YYYY-MM-DD` text; `time`: the local-day text; `checkbox`: `true`/`false`), grouped by the column, grouped by a lowercased key unless the column is `caseSensitive` (the client dedupes values by `toLowerCase()` and `isAnyOf` is case-insensitive; a `caseSensitive` column shows one spelling), ordered by count then value, `limit` 1,000. Values come back through the serializer as text; NULL and `''` merge into one blank entry (with `keepBlankText` the blank entry counts NULL only and `''` rows get no entry, a listed limit). The server returns at most 1,000 values (the grid keeps 1,000), omits a value longer than the 256-character list-entry cap (it could not be sent back as an `isAnyOf` entry), and uses `filters` exactly as sent: the grid already removed the column's own top-level set entry.
- **Aggregates (flat band).** `fetchAggregates({ spec, columnIds, signal })` carries no reducers and defaults `columnIds` to every column. The reducer is the column's `aggregate` option; requested ids without one, unmapped ids, and `serverOnly` ids are ignored silently and alike (the grid's default request names every column def, client-only columns included, and nothing can be probed); ids are deduplicated, the raw array is capped at 10,000, and only mapped `aggregate` columns count against `maxAggregates` (20), which the factory checks at creation. `sum`, `min`, `max` return a JS number when the value is a safe integer or `scale` is absent, `avg` is always a JS number (a float; its precision is documented), `count` is a number, and a column that declares `scale` returns a decimal string (documented with a text or custom cell type); `null` when no input. Reducers follow the grouping spec (decision 6), which owns the client alignment: `count` counts values other than NULL and `''`, and `sum`, `avg`, `min`, `max` use finite numbers only. The pinned-row reducers of the client count `''` today and change with that spec, so adopting the grouping rule now avoids a later breaking change; until then it is a listed difference.
- **Cut line.** If the filters or aggregates branch misses the merge, 2.0 ships rows and count only; `filterValues` and `aggregates` follow.
- **2.x slices.** Each needs its branch merged and its contract past the strip:
  - *Server grouping and pivot.* The w4 specs strip `groupBy` and `pivot` in 2.0 and ship the first slice afterwards. The plan then gains group levels, `groupPath` equality tests (the empty group matches NULL and `''`), per-group counts and reducers, and a full-key tie-breaker. Group and pivot answers must be numbers (`ServerGroupRow.aggregates` and pivot cells accept only finite numbers or `null`), so the layer returns numbers there and documents the precision loss. `GROUPING()` marks subtotal rows where the engine has it; the baseline is one query per level. Pivot uses conditional aggregation with generated aliases and a capped value list. `parseQuery` implements the grouping spec's "Server checks" (at most 4 `groupBy` keys, keys of at most 1,024 characters), replacing the hand-written checks in the recipes.
  - *Selection over a result.* `SelectedRows.spec`, `ids`, `groups`, and `excludedIds` (up to 200,000 each) become `where` plus `NOT IN`, first match wins as in the grouping spec. That needs `maxSelectionIds`, one array parameter on PostgreSQL and a JSON table elsewhere, ids parsed by the primary-key kind, and `getRowId` reading the `primaryKey` column.
  - *Write validation.* `validateChange(ops)` applies the column map to a change (unknown column, kind parse, `required`, `choices`, `maxLength`) and returns `rejected` entries for `onSave`'s `SaveAck`. Writing rows stays the consumer's code, as the write-ack spec says.
  - *Cursor paging, Prisma, Supabase.*

## Security

Everything in the request is untrusted (AGENTS.md: grid data and imported files are untrusted input).

- **Identifiers** come only from the column map via `Map.get`. Operators, directions, null placement, aggregate functions, and the ESCAPE clause come from closed tables. Nothing from the request is concatenated into SQL, a URL path, or a column reference. `QueryError.path` holds indices.
- **Values** are bound parameters everywhere. The Supabase `quote()` is the only place a value enters a URL string and has its own tests (reserved characters, quotes, backslashes).
- **Request bounds.** `handleGridRequest` reads the body with a byte cap (`maxBodyBytes`, default 512 KiB; 413 when exceeded) before `JSON.parse`, and answers malformed JSON with a 400. The string-content cap counts UTF-8 bytes, and the body cap binds first. `parseQuery` bounds total nodes, arrays, strings, and numbers before walking the tree.
- **Errors.** `handleGridRequest` maps a `QueryError` to a 400 with a code and no value, and maps every other error to a 500 with no message, because ORM and database errors echo values and field names. The adapter never logs requests.
- **Projection and exposure.** Only mapped columns are selected; `serverOnly` columns are invisible to the client. `columnsFromDrizzleTable` requires `pick`, so no helper maps a whole table.
- **No regex** reaches the database. LIKE patterns are escaped (`!` with an explicit ESCAPE for Drizzle and Kysely; a backslash for Prisma on PostgreSQL and for PostgREST), the pattern length is bounded, and `escapeLike(text, escapeChar)` is a core export used by the ORM adapters. SQL Server `[` classes are out of scope.
- **Authorization** is `rowScope` (above), which fails closed, plus the database's row-level security; on Supabase RLS is the boundary and `rowScope` is not (see its note). The Supabase adapter takes the caller's client; the docs show forwarding the user's JWT.
- **Display.** Filter values and labels are text; the grid renders text nodes.
- **Dependencies.** Each adapter's ORM package is its only dependency (Prisma and Supabase adapters have none); `pnpm audit --prod` must show no HIGH finding.

## Docs and demo

Follows `research/docs-navigation-ruleset.md`, which exists only on `claude/clever-colden-9f2e91` (the Server group does not exist on `origin/release/2.0`; the docs batch lands on the 2.0 tree before that migration, and moves with it: the page `recipes/data-fetching/query-layer.mdx`, the example page under `examples/data/`, and the matrix row; see Timing). The Server-feature rule applies, not the Add-on options rule: its three hand-written places are the Server-group page, the data-modes matrix row (`research/parity-matrix.json` and `verify-parity.mjs` already exist on `origin/release/2.0`), and the step link in the Server path. The demo's example page is a fourth place; the ruleset wording for a feature with a demo allows it, and Open question 10 records it.

- **Pages.** (1) One Server-group page, `Query layer` (Feature type, 1,500-word hard cap): problem paragraph, preview, install tabs (core plus one ORM adapter), behavior, `Server mode`, `Related`. The Feature page holds the problem, the preview, install, the behavior, and `Server mode`; a `Query layer reference` page (Reference type) holds the column map options, the operator and parity tables, limits, and error codes, because that content cannot fit the 1,500-word cap. This counts as a fourth place in Open question 10. The single-mode Server-feature row applies: the layer has no client mode. (2) The example page for the demo. (3) The data-modes matrix row.
- **Existing pages edited in place**: in 2.0 `examples/data/orm/drizzle.mdx` shrinks to an install-and-route page and `kysely.mdx` is added (a CHANGELOG entry for the removed text, `<NewBadge />` on changed sections); `prisma.mdx` and `supabase.mdx` keep their translations with a corrected escaping and null note until their adapters ship, the data-fetching recipe page that writes the route links the layer (no Server path exists on `origin/release/2.0`), and `docs-changes.json` is regenerated at release.
- **Demo.** A spike in the B1/B2 window (it does not depend on the merge) proves that PGlite's WebAssembly loads in a Next client bundle under `test:e2e-install` before Open question 8 is settled. `data-grid-server-query-demo`: a grid over an in-memory PGlite database in the browser, loaded lazily after mount (skeleton first; no SSR or hydration difference), with the compiled SQL and parameters of the last request in a side panel and a switch that injects hostile filter values. It declares `@electric-sql/pglite` and `drizzle-orm` as its own registry `dependencies` with tested ranges (reason: demo only), because `test:e2e-install` installs them. A multi-megabyte WebAssembly download is the cost; the page says the production form is a route handler. Entry in `components/registry-examples.tsx`. A big feature needs its live demo before it counts as done.
- **Glossary and terms.** Added to `GLOSSARY.md` before use and mirrored in `content/docs/terms.mdx` (the glossary's quick-search line also gains "a server grid narrows the result"): `query plan`, `column map`, `ORM adapter`, `driver adapter`, `row scope`, `blank operand`, `native fragment`. Words to avoid by `scripts/verify-vocabulary.mjs`: use "override" or "native fragment" instead of "escape hatch". The plan says "row range" (`RowRange`), "row count", "set values" for the value list of a column, and "value query" for the text typed into the set filter search box.
- **Skills.** After editing, run `node scripts/sync-skills.mjs` (the `public/skills` mirror that `pnpm lint` checks). `skills/gridcn-data-source` (SKILL.md, `references/server-mode.md`) makes the layer the default backend step; `skills/gridcn-addons` gains the items.
- **Parity matrix.** A feature row `server-query`: `PS`, `Z`, `SS`, `FS`, `C` supported, with a `tests/parity` file that mounts the layer behind each mode (the verifier accepts `mode X ` or `mountMode("X")`; page prose is not evidence); `API` is `n/a` (a read-only layer, no write path in the 2.0 cut), `L` and `PC` are `n/a`. The parity file runs on in-memory `better-sqlite3` (PGlite would add seconds to the unit gate); the `unit` project uses jsdom and `vmThreads`, which nobody has verified with a native module, so B2 spikes it and falls back to the `conformance` project with the evidence path kept under `tests/parity/`; `verify-parity.mjs` counts any non-test file that matches a mode pattern, so prose would pass the regex, which is why the tests carry the evidence.
- **CHANGELOG.** `## Unreleased`: `### Added` the items; `### Changed` the Drizzle recipe now uses the adapter.

## Registry and payload impact

- Five new items and the demo item in `registry.json`; `components/registry-examples.tsx`; rebuild `public/r/*` for the new items only. The registry entries and the payload rebuild (`pnpm registry:build`, EOL normalization, `registry:verify`) are append-only and land in the same commits as the folders (B1 and B2 included), because `verify-import-boundaries` builds its allowed barrels from `registry.json` and `verify-registry` lists every non-test file of an item folder.
- Gates per AGENTS.md: `pnpm registry:build`, `node scripts/normalize-payload-eol.mjs`, `git add public/r`, `pnpm registry:verify`, `pnpm test:e2e-install`.
- A rule in `scripts/verify-source-rules.mjs` bans ORM imports in the core folder.
- `pnpm-workspace.yaml` overrides the `better-sqlite3` of `@prisma/adapter-better-sqlite3` to 13.0.3, which ships prebuilt binaries, so `onlyBuiltDependencies` needs no entry; the `unit` and `unit-compiled` projects (`tests/**/*.test.{ts,tsx}`) both exclude `tests/server-query`, which only the `conformance` project runs. Also edited: `.github/workflows/ci.yml` (the conformance step), `.gitignore` (the generated Prisma client), and the tsconfigs, so `pnpm types:check` and `lint:typed` need no generated Prisma client in a fresh clone.
- Repo `devDependencies` (not shipped), reason for the commit message: the conformance suite must run real engines. `drizzle-orm`, `kysely`, `@prisma/client`, `prisma` (CLI), `@prisma/adapter-pg`, `@prisma/adapter-better-sqlite3`, `@supabase/supabase-js`, `@electric-sql/pglite`, `@electric-sql/pglite-socket`, `better-sqlite3`.

## Timing: what the layer needs from other branches

The layer reads the wire format. The core declares structural types, so the dependency is on JSON shapes and on client-side oracles, not on TypeScript exports.

| Need | Where | State |
|---|---|---|
| Filter tree JSON: leaf `{ columnId, operator, value? }`, group `{ join, filters }`, depth 2, 15 built-in operators | `data-grid/types.ts` | Stable everywhere |
| `ServerSpec { sorts, filters, searchText }`, `serverSpecKey`; request `start`, `end`, `cursor`, `page`, `pageSize`; answer `totalRowCount`, `hasMore`, `nextCursor`; `MAX_ROW_COUNT` | `data-grid/server-spec.ts`, `data-grid-server/read-answer.ts` | Already on `origin/release/2.0` (the lazy-paging branch adds fixes and is 59 commits ahead) |
| `FilterValue { value, label?, count? }`, `CustomFilterOperator { id, input }`, `FilterOperator = built-in \| string` | filters branch (`claude/w2-filters-0843b7`) | Open. The lazy-paging branch still has `FilterValue { label, count? }`; the layer returns the filters branch shape |
| `FetchAggregatesRequest { spec, columnIds, signal }`, answer `Record<string, unknown>` | aggregates branch (`claude/w3-aggr-lookup-6ee2ab`) | Open |
| `groupBy`, `aggregates`, `pivot`, `groupPath`, `childKind`, `ServerGroupsAnswer` | specs branch (`claude/w4-specs-views-a46d4a`) | Spec documents only; the 2.0 contract is "contract plus strips", the first slice follows 2.0 |
| `onSave`, `SaveAck`, `SaveRejection` | write-path branch (`claude/w2-write-path-faed6d`) | Open |
| Docs structure: the Server group, page types, S16 | `claude/clever-colden-9f2e91` (`research/docs-navigation-ruleset.md`, a proposal; no Server folder exists on any branch) | Open; the docs batch uses the fallback home on the 2.0 tree and moves with the migration |
| Client oracle: `makeFilterPredicate`, `rowAccessorFor`, `findSearchMatches`, `defaultCompareText`, `toSafeText` | `data-grid/sort-filter/incremental-view-index.ts` (`makeFilterPredicate`), `find-search-matches.ts`, `default-compare-text.ts`, `store/compute.ts` | Exist on every branch; `rowAccessorFor`, `makeFilterPredicate`, `toSafeText`, and `operatorsForColumnType` are on `data-grid-sdk`, so only `findSearchMatches` and `defaultCompareText` are imported by path from `tests/server-query/` |

Build before the integration merge, on this branch, with only these edits to existing files (mostly append-only; `ALLOWED_BARRELS` in `scripts/verify-import-boundaries.mjs` already differs between `main` and `release/2.0`, so that edit conflicts and is redone at the merge): `registry.json`, the `public/r` payloads, `package.json` devDependencies, `pnpm-workspace.yaml`, the vitest project config, `scripts/verify-import-boundaries.mjs`, `scripts/verify-source-rules.mjs`, `.gitignore`, `.github/workflows/ci.yml`, the tsconfigs, `lib/registry-items.ts` (`tests/registry-items.test.ts` fails on a missing item), `pnpm-lock.yaml`, `perFileBranchThresholds` entries (90) in `vitest.config.ts` for the pure-lib core files, and the AGENTS.md gate list (the conformance project). `registry.json`, `public/r`, and `pnpm-lock.yaml` conflict at the merge, since both branches append at the tail; they are regenerated there, not resolved by hand:

- B1: the core (column map, `parseQuery`, plan, limits, operand parsers, day bounds, `escapeLike`, `handleGridRequest`, plan tests).
- B2: the conformance harness, fixture, and oracle; the Drizzle and Kysely adapters for rows and count on SQLite and PGlite.

Wait for the merge (the docs batch uses the fallback home above): the type test that a `ServerSpec` and a `ServerRowsPageRequest` minus `signal` assign to `QueryRequest` (this branch is based on `main` and has no `data-grid-server`), a rerun of the B2 oracle cases (main has no custom operators), `fetchRows` typing against `ServerRowsAnswer` (cheap, already on `origin/release/2.0`; do it first after the merge), `filterValues` (the `FilterValue` shape), `aggregates`, the demo, the docs, skills, glossary, parity matrix, CHANGELOG, and the payload rebuild. Everything in the 2.x slices waits for its branch.

## Effort and cut

Working days, one developer, including tests and review rounds:

| Batch | Content | Days |
|---|---|---|
| B1 (before merge) | Core, plan tests | 5 |
| B2 (before merge) | Harness, fixture, oracle; Drizzle and Kysely rows and count | 6 |
| B3 (after merge) | Answer typing against `ServerRowsAnswer`, `filterValues`, `aggregates` (`rowScope` and the projection already ship in B1 and B2) | 4 |
| B4 | Docs page, recipes rewrite, demo, skills, glossary, parity row, changelog, registry and payload | 6 |
| Review and hardening | Review rounds on code, security, performance, DX | 3 |
| 2.0 cut total | | about 24 |
| B5 (2.0.x) | Prisma adapter and CI setup | 4 |
| B6 (2.0.x or 2.1) | Supabase adapter, the RPC contract and SQL, PostgREST job | 8 |
| B7 (2.x) | Cursor paging, group and pivot, selection, write validation | 8 |

Recommendation for 2.0.0: core, Drizzle, Kysely, offset paging, filter values, flat aggregates. Prisma and Supabase follow in 2.0.x or 2.1 (Prisma has the most deltas and the heaviest test setup; Supabase needs RPC functions and a container). The issue's one-week estimate covers translation only; conformance, bounds, parity, the demo, and the docs are most of the work.

Commits: one `feat:` commit per item and folder, `test:` for the harness, `docs:` and `chore:` for the rest. Push in logical batches (B1 and B2 once, B3 and B4 once).

## How to implement

Order, with files (new unless marked):

1. `data-grid-server-query/`: `column-map.ts`, `errors.ts`, `limits.ts`, `operands.ts` (decimal grammar, bigint, boolean, ISO date, day bounds with an IANA zone), `like.ts`, `plan.ts`, `parse-query.ts`, `blank-operands.ts`, `row-scope.ts`, `handle-grid-request.ts`, `serialize-row.ts`, barrel `data-grid-server-query.ts`. Each with a `*.test.ts`. Edit `registry.json` in the same commit.
2. `tests/server-query/`: `fixture.ts`, `cases.ts`, `known-differences.ts`, `client-oracle.ts`, `run-conformance.ts`, engine loaders. Edit the vitest config for the `conformance` project.
3. `data-grid-server-query-drizzle/` and `...-kysely/`: `render-where.ts`, `render-order.ts`, `columns.ts`, `create-*-grid-query.ts`, barrel, compiled-SQL snapshot tests only (the engine-booting tests stay in `tests/server-query/`).
4. Core and adapters: `fetch-rows.ts` (answer shape), `filter-values.ts`, `aggregates.ts`.
5. One pass over existing files: docs, demo, `components/registry-examples.tsx`, skills, glossary and terms, parity matrix, CHANGELOG, payload rebuild.
6. Prisma, then Supabase, each with its capabilities and `KNOWN_DIFFERENCES`.
7. 2.x slices when their branches are merged.
8. Gates in AGENTS.md order, plus the conformance project. Every optional options parameter gets a `no-arg.type-test.ts`; `parseQuery`, the factories, and `defineColumnMap` have required arguments.

API rules from AGENTS.md applied: options objects per concern (`limits`, `timeZone`, `rowScope`, `paging`, `rowCount` on the factory), `QueryCallOptions` defaults to `{}`, callbacks with equal values take a ctx object (`rowScope(context)`, `customOperators[id]({ column, value })`), booleans positive and default `false`, feature gates are `enableX` and default `true`.

## Open questions for the owner

1. **Scope for 2.0.0.** Recommended: core, Drizzle, Kysely; Prisma and Supabase in 2.0.x or 2.1. Alternative: all four in 2.0.0 (about 12 more days, plus a PostgREST CI job).
2. **Text operators on number and date columns.** Recommended: reject, and require `filterOperators` from `describeFilterOperators(columns)`. Alternative: a `textCast` column option that casts to text and documents the cost.
3. **Time zone for day filters.** Recommended: a server option `timeZone` (default `UTC`). The grid's display zone is not in the spec; adding it is a contract change on another branch.
4. **Full-text search.** Recommended: out of v1; an opt-in mode per ORM adapter later.
5. **Approximate counts.** Recommended: exact, first block only, or none. A capped or estimated count needs a grid contract for "approximate".
6. **Blank sorting.** Recommended: NULL last only. The client also sorts `''` last; matching that costs an expression sort key.
7. **Prisma on SQLite and Prisma 8.** Recommended: reject `%` and `_` in text leaves on SQLite; target 7.x and add an 8.x adapter later.
8. **Demo runtime.** Recommended: in-browser PGlite with the cost stated. Alternative: a docs-app route handler, which the registry demo cannot install into a consumer app without a route.
9. **MySQL and SQL Server.** Recommended: out of v1; a dialect needs its own CI engine before it is offered.
10. **Docs home and the example page.** One Server-group page, the matrix row, and the step link are the three places. The demo's example page is a fourth: record a ruleset exception, or fold the demo into the Server page. Alternative: per-ORM pages under the add-ons group.
11. **Refresh flag.** Scroll refreshes do not refetch block 0, so a counted source goes stale after writes unless `rowCount: "always"`. A `refresh` flag on the request is a contract change on the lazy-paging branch.

## Review log

Eight review rounds ran, each with a new reviewer with fresh context. High findings by round: 6, 3, 1, 1, 0, 0, 1, 1; the last two are the numeric type and the native string types, both fixed above. The last round (8) found no security gap that widens a result or leaks a value. Nits left open for implementation (none changes a decision):

- Aggregates: `count` with no input returns `0` (grouping spec); `sum`/`min`/`max` on an `int8` column without `scale` return a string when the value is not a safe integer (one rule with the serializer); the reducers valid per kind (`sum`/`avg` on number only) are checked at creation.
- Floats: untyped, column-inferred parameters for `real` and `float8` (a float8 cast never equals a stored `real`); Drizzle `bigint({ mode: "number" })` reads int8 lossily, so creation warns for an int8 `primaryKey` or `tieBreaker` in that mode; integer bounds bind as canonical decimal strings unless a node-postgres case proves `BigInt` binding (the suite uses PGlite); `isBetween` on integers rounds the low bound up and the high bound down.
- Tests: `unit` runs on jsdom, where `Request` rejects a jsdom `AbortSignal`, so `handleGridRequest` tests use `// @vitest-environment node`; a parity file that falls back to the `conformance` project must also be excluded from `unit` and `unit-compiled`; the property-test generator uses no text `cmp`/`range`, canonical number strings, and no `time` columns.
- Errors: one `QueryError` code list in the reference page; `unsupported` maps to 501, not 400.
- Batches: step 1 also lists `data-grid-server-query-sdk.ts`, `describe-filter-operators.ts`, `is-dev.ts`, the safe-text helper, and the operator-table copy; `fetch-rows.ts` belongs to B2 with rows and count; the "latest 0.x minor" CI job is added to the `ci.yml` edit list.
- Earlier-round items kept as written: the 1,500-word cap and the Server group wait for the docs-structure branch; `serverOnly` and unmapped ids answer `unknown-column`.

## Implementation status

The 2.0 cut was built on the 2.0 branch, where the dependencies of the Timing table are already merged: `FilterValue { value, label?, count? }`, `CustomFilterOperator`, `fetchFilterValues`, `FetchAggregatesRequest { spec, columnIds, signal }`, `ServerRowsAnswer`, and `parseServerSpec` exist. The spec above held up; these points differ:

- **One renderer.** `render-sql.ts` renders the plan once through a small `SqlAlgebra` (`raw`, `param`, `column`, `cat`, `native`); each ORM adapter supplies the algebra and executes the statements. `createGridQuery` in the SDK barrel owns `parse`, branding, `rowScope`, answer shaping, and the count rule, so an adapter implements a `QueryExecutor` only. `where(plan)` and `orderBy(plan)` return the ORM's own type (`SQL` for Drizzle, a raw builder for Kysely).
- **List parameters.** `in` lists bind one parameter per value (the 5,000-value tree cap keeps the total under every driver limit). The `ANY(array)` and `json_each` forms are an upgrade for later.
- **No `paging` option.** Only offset paging exists, so the option and the `bad-cursor` code are absent. `payload-too-large` (413) is a code of its own.
- **Dependencies.** `better-sqlite3` 13 ships prebuilt binaries, so `onlyBuiltDependencies` needs no entry. `unit` runs the SQLite parity file under jsdom without trouble, so the parity evidence stays in `tests/parity/server-query.parity.test.tsx` and the conformance project holds only `tests/server-query/`.
- **Conformance.** `tests/server-query/` runs Drizzle and Kysely on SQLite and PGlite (4 combinations, 183 cases each): the client filter engine is the oracle for the parity-safe cases, and the documented differences carry explicit expected ids. Kysely 0.29 ships `PGliteDialect`.
- **Docs.** The feature page is `(server)/data-modes/query-layer.mdx`, the reference is `(reference)/contracts/query-layer-reference.mdx`, the demo page is `(examples)/server-data-examples/orm-examples/query-layer-example.mdx`, and the Drizzle example now uses the adapter. The Server group of the later navigation migration moves these pages without changing their content.
- **Demo.** PGlite loads in the Next client bundle (checked in the dev server). The demo restarts its grid when the hostile-value switch changes, so the first block carries the new filter.
- **Open for later work:** pivot.
