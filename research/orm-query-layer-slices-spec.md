# Spec: query layer 2.x slices (cursor, selection, write validation)

Status: decided, not built. Input: `research/orm-query-layer-spec.md`, the code in `registry/default/blocks/data-grid-server-query/`, issues #98, #100, #101. Prisma and Supabase supply no `SqlAlgebra`, so each construct names its rendering in both walkers.

## 1. Cursor paging (#98)

**Goal.** `paging: "cursor"` gives keyset pages with no count.

**Wire shape.** Request: the rows request; `cursor` is the position, `end - start` the limit. A request with `cursor` reads from the cursor's row at offset 0 and skips `maxOffset` (its `start` only counts loaded rows); a request without one reads from `start`. Answer: `{ rows, hasMore, nextCursor }`, no `totalRowCount`, no count query; `nextCursor` is `null` at the end. `RowsAnswer` and `GridQuery` gain a last generic `TCursor = never`; cursor factories (`paging: "cursor"`, an adapter overload) set `string`. Cursor: base64url JSON `[1, hash, ...keyTexts]`, one text or `null` per order term.

**Rendering rule.** Terms t1..tn, tn the tie-breaker. Resume = OR of (same(t1..ti-1) AND after(ti)); after = `false` for NULL, else `key gt` (asc) or `key lt` (desc) OR `key null` (the `key null` drops out only on the primary key: `required` refuses blank writes and promises no NOT NULL); same = `key eq`, or `key null`. Only the `selectRows` plan gets it. `key` drops `cmp`'s `col <> ''`, which skips `''` rows descending. Hash: FNV-1a 64 of the parsed `where` and `orderBy` before `rowScope` (staleness only; a scoped hash would hand the client a digest of a `serverOnly` value). A key text is the stored text or number digits; a `time` key is the `keyText` (`{ column, as }` entries, `as` an alias no column id takes), parsed with an instant grammar of at most six fraction digits and compared as sent; an epoch `time` key travels as its `toISOString` text. Before it answers, the layer decodes its own `nextCursor`; a key the cursor cannot carry (keys over `maxCursorBytes`, a number over `maxNumberLength`, a float NaN or infinity, an integer the driver read past 2^53 as a number, a PostgreSQL `infinity` timestamp, whose `to_char` is NULL) is `limit-exceeded`. A decimal key compares as sent: SQLite binds it as text, as the `ids` test does, so a TEXT column keeps `1.50` and `1.5` apart and a NUMERIC column converts it by its own affinity.

No HMAC: the cursor holds only values the client could send as filters; columns come from the sort and the allow-list, values bind, `rowScope` applies.

**Limits and untrusted-input bounds.** `maxCursorBytes` 2,048 (a `QueryLimits` field; #98 says 512, which fits one text key of `maxLength` 55 next to an `int8` key, too few for names and titles), checked on the string length before base64 and `JSON.parse`. The decoder then needs the exact array length, the version, the hash, and one key per term parsed by the column's physical type (`keyOperand`, so a stored text over `maxLength` still compares; a native enum also needs a choice, and a `time` key no year 0 and an offset within ±15:59, the input PostgreSQL takes). Creation throws for a sortable text column without `maxLength` (the error names the column and both remedies: set `maxLength`, or `sortable: false`) and for a single-key sort whose worst encoded cursor (`6 × maxLength` JSON bytes, then base64) exceeds the cap; a multi-key sort over the cap is `limit-exceeded`.

**Client and server mode behavior.** Sequential scroll and cursor pages; other modes use offset. Local: n/a. A spec change resets the chain. Grouped requests are `unsupported`.

**Known limit.** A `timestamp without time zone` key goes through `::timestamptz` in the session zone, so a wall time in a DST gap shifts and the next page can repeat or skip rows near it. Remedy: store `timestamptz`, or run the session in UTC.

**Types.** A literal `paging: "cursor"` types the cursor as `string`, an absent or `"offset"` one as `never`; a `paging` of the widened type `"offset" | "cursor"` types it as `string`.

**Failure codes.** `bad-cursor` (400): malformed, stale hash, unparseable value.

Prisma: `{ f: { gt | lt | equals } }`, `{ f: null }` in `OR`, `take: n + 1`, no native `cursor`; a `key` test never carries `mode`. The NULL branches and `nulls: "last"` go only on the columns the map marks `nullable`: `definePrismaColumnMap<User>()(fields, columns)` requires `nullable: true` exactly on the fields whose generated model type admits `null`, and `required` only refuses blank writes, as in the core. `exactInstantKeys: false` makes the core decline `time` keys.
Supabase: `or=(t.gt.<q>,t.is.null,and(t.eq.<q>,id.gt.<q>))` via `quote()`, `limit=n+1`; `exactInstantKeys: true`.

## 2. Selection endpoint (#100)

**Goal.** `selection(input)` answers "all matching" on server data: the count, and on demand ids or rows.

**Wire shape.**

```ts
type SelectionRequest = { selection: DataGridSelectedRows; include?: "ids" | "rows"; start?: number; end?: number };
type SelectionAnswer<TRow> = { count: number; ids?: string[]; rows?: TRow[]; hasMore?: boolean };
```

`selectionPlan(input)` returns a branded plan for a bulk write: `.where(q.where(plan))`.

**Rendering rule.** `allMatching`: the spec's filters and search AND NOT `ids(excludedIds)`; grouping keys are ignored (they never change which rows match). `ids` mode: `ids(ids)`. Both AND `rowScope`. The new `ids` test is exact primary-key membership in one parameter: `col = ANY($1::<type>[])` on PostgreSQL, `json_each(?)` on SQLite. The list of the other mode is ignored.

**Key parsing.** A key is compared, never validated: `keyOperand` parses an id by the physical type alone, without `choices`, `maxLength`, or the blank rule, so an empty text id is a text key; `validateChange` uses the same parser. An id of the wrong shape (non-numeric text for a number key, a bad uuid, a value beyond int8) is dropped in both modes, so draft and stale ids fail no request. An id the layer declines although the type could store it (a decimal or float over `maxNumberLength`, a decimal whose exponent outgrows that many digits such as `1e9999`, text over `maxValueLength`; a decimal's `scale` is ignored) is dropped in `ids` mode and `invalid-value` at its list index in `excludedIds`, where dropping it would select its row. A uuid id keeps the case it was sent in. On SQLite a text-stored uuid key compares exactly in `ids` mode, so the key index serves it and the id must be the stored form, which the grid sends; `excludedIds` compare `lower(col)` with lower-case ids, so an excluded id in any case stays excluded. The 2.0 `equals` filter differs: it lowercases the value and compares with `=`, so on an upper-case stored uuid `equals` matches nothing and `notEquals` keeps the row.

**Limits and untrusted-input bounds.** `maxSelectionIds` 200,000 bounds `ids` and `excludedIds`: the grid's 100,000 remembered rows plus 100,000 loaded rows (`maxLoadedRows` has no hard maximum). Only the list count and the body cap are `limit-exceeded`; an id's length decides drop or refusal as above. `end - start` ≤ `maxPageSize`. `selection` carries `maxBodyBytes`, derived from the limits (40 bytes per id for a quoted uuid, plus twice `maxTreeStringBytes`; about 8.1 MiB by default), which `handleGridRequest` reads when the route passes none. The key parser refuses a number whose exponent outgrows `maxNumberLength` digits before it builds them.

**Client and server mode behavior.** Every mode sends either shape; `allMatching` carries the spec the grid held. Server sort orders only the `include` rows.

**Failure codes.** `invalid-request`, `limit-exceeded`, `payload-too-large` (413), the spec's codes; `unsupported` (501) for a `tieBreaker` map or a non-number, non-text key.

Prisma: `{ pk: { in | notIn: ids } }`. A negated `ids` test renders `notIn`, never `NOT: { in }`. The adapter counts every bound parameter of the rendered statement and refuses with `limit-exceeded` itself when it passes the provider budget (PostgreSQL 32,766, SQLite 999); it never relies on `P2029`, because Prisma splits a plain `in` into chunks beyond the budget and returns or deletes wrong rows without an error. Its `maxBoundIds` (the budget minus the take and skip reserve: 32,764 and 997) lets the core refuse a longer parsed id list first, at `["selection", "ids" | "excludedIds"]`. A selection of about 990 ids or excluded ids on SQLite is therefore `limit-exceeded`. On SQLite (`caseInsensitiveText: "like-only"`) excluded ids on a uuid key are `unsupported`, since keeping them excluded in any case needs `lower(col)`.
Supabase: quoted `in.(…)` while the URL fits `maxUrlLength` and the page with its look-ahead row fits `maxRows`, else the generic `rows` plan to the table's grid function (`rpc`), with the ids as an `in` leaf of its `where`; without `rpc`, `limit-exceeded`.

## 3. Write validation (#101)

**Goal.** `validateChange(input)` applies the column map to a save.

**Wire shape.** Request: the `DataChange` of `onSave`.

```ts
type WriteRefusal = { rowId: string; columnId?: string; code: WriteRefusalCode; message: string }; // assigns to SaveRejection
type ValidatedChange<TWhere> = {
  updates: { rowId: string; values: Record<string, unknown>; where: TWhere }[];
  inserts: { rowId: string; values: Record<string, unknown> }[];
  deletes: { rowId: string; where: TWhere }[];
  moves: { rowId: string; where: TWhere; beforeRowId?: string; beforeWhere?: TWhere; afterRowId?: string; afterWhere?: TWhere }[];
  rejected: WriteRefusal[];
};
```

**Rendering rule.** `where` is `exact(pk, rowId)` AND `rowScope`, through `executor.where`; a move's `beforeWhere` and `afterWhere` scope its neighbor ids the same way, and a row or neighbor id the key parser of section 2 cannot turn into a key (wrong shape or declined, any length) refuses that operation as `not-an-id`; no id throws for the whole change. Key and scope columns are fixed by physical `field`, so an alias of their field is fixed too. An update checks `cells`, else the keys of `row` that differ from `prev`. Unmapped and `serverOnly` keys are skipped alike, never written. The key comes from `rowId`; its `row` entry is skipped, and a `cells` entry or a changed `row` value for a key or scope column is `not-writable`. An insert never writes the key, refuses missing `required` columns, and writes the parsed `rowScope` values. Checks come from `parse-import-rows.ts`: kind, `required`, `choices`, integer range, `scale`, finite floats, `maxLength`. A refused cell drops every `cells` entry of its column (the grid reverts the column); a refusal is by column id and a write by field, so every other column of that field is refused and not written too. Any refusal drops a whole-row update (the grid reverts it whole) or an insert.

**Save route.** `handleGridRequest(req, query.save(apply), { context })`. `apply` runs the writes and answers one row count per update, delete, and move (`WriteCounts`). Requirements on `apply`: every write runs in one transaction, so a throw writes none; a failing insert throws; each write filters by its `where` alone, never by `rowId` (that skips `rowScope`); all writes of one row id run or none. A 0 for any write of a row id (deleted, outside `rowScope`, or a move whose neighbor is gone) answers one `{ rowId, code: "not-found" }` in place of that row id's other refusals, since the grid reverts the whole row either way. A count above 1 means the primary key is not unique. Counts that do not line up (a consumer bug) and a throw of `apply` answer a 500 with no message.

**Limits and untrusted-input bounds.** `maxChangeOps` 10,000 (a `QueryLimits` field). Before `apply`, `limit-exceeded` when the refusals plus the distinct written row ids without a refusal exceed 10,000, the grid's bound; each such row id can answer at most one `not-found`, so the answer after `apply` stays within the bound and the bound never throws after a write (a miscount of `apply` still answers a 500). Text over `maxLength` (else `maxValueLength`) is `too-long`. Save body `maxChangeBytes`, default 8 MiB: about 838 bytes per operation at 10,000 operations, while every update carries `row` and `prev`, so a wide 10,000-row paste can answer 413 before `maxChangeOps`; raise `maxChangeBytes` for it.

**Client and server mode behavior.** Same in every mode; validation reads no view state.

**Failure codes.** `invalid-request`, `limit-exceeded`, `payload-too-large`; `unsupported` without one `primaryKey`. Refusal codes: the import codes, `not-writable`, `not-found`.

Prisma: `updateMany`/`deleteMany({ where: { pk, ...scope } })`; `count === 0` is not found. Its `nativeValue` writes integers as numbers (`BigInt` for int8), days and instants as `Date`, and decimals as text.
Supabase: `where` is one PostgREST logic tree of the row id AND `rowScope` for `.or()`: `.update(values).or(where).select(pk)`; empty is not found; RLS stays the boundary. The tree is safe ONLY as the sole argument of one `.or()`: combined, as in `` .or(`${where},x`) ``, the scope becomes one OR branch and drops out. Writes over REST are NOT atomic: each call is its own transaction, while `apply` requires one transaction for the whole change, so the docs route a save through a consumer RPC that runs every write in one function, never a loop of `.update()` calls.

## 4. New Test kinds and executor members

| Addition | Drizzle, Kysely (`render-sql.ts`) | Prisma | Supabase |
|---|---|---|---|
| Test `{ k: "key"; op: "gt" \| "lt" \| "eq" \| "null"; value?: Operand }` | `col > $1`, `col < $1`, `col = $1`, `col IS NULL` | `gt`, `lt`, `equals`, `null` | `gt.`, `lt.`, `eq.`, `is.null` |
| Test `{ k: "ids"; values: Operand[]; negate: boolean }`, never empty; `negate` for `excludedIds` | `= ANY($1::<type>[])` (a native enum compares `col::text`, so its key index is unused), `IN (SELECT value FROM json_each(?))` with decimals as JSON strings | `in`, `notIn` within the parameter budget | `in.()`, or the RPC |
| `RowsPlan.keyText`: `selectRows` also reads each `time` key as exact UTC text; the decoder parses it with a microsecond grammar (`parseInstant` stops at milliseconds) | `to_char(col::timestamptz AT TIME ZONE 'UTC', …US"Z")`; SQLite reads the stored value | declined | raw JSON text |
| optional `nativeValue(column, value)`: the factory hands it to `validateChange`, which applies it to every `values` entry (`null` and the `rowScope` values of an insert included), so the consumer's `ValidatedChange` is native; unset keeps the validated forms | none (a Drizzle timestamp-mode `Date` is open) | `BigInt` for int8, numbers for other integers, `Date` | identity |
| optional `exactInstantKeys` (default `true`; `false`: a cursor sort on a `time` column is `unsupported` at `["spec", "sorts"]`, and a `time` group level at `["spec", "groupBy", index]`) | `true` | `false` | `true` |
| optional `maxBoundIds` (a positive integer, checked at creation; a longer parsed `ids` or `excludedIds` list is `limit-exceeded` before the executor runs; unset is unlimited) | none | budget minus 2 (32,764, 997) | URL then RPC |
| `caseInsensitiveText: "like-only"`: LIKE folds ASCII case, `=` never folds; a case-insensitive `equals`, `notEquals`, set filter, or excluded uuid id is `unsupported` | `"collation"`, `"ascii"` | SQLite | — |
| `likeEscape: false`: a `%` or `_` in a LIKE leaf, the quick search, or a value query is `unsupported-value` | `true` | SQLite | — |
| optional `caseSensitiveLike` (default `true`; `false`: a case-sensitive contains, notContains, startsWith, or endsWith is `unsupported`) | unset | SQLite `false` | — |
| optional `nativeLike` (default `true`; `false`: a LIKE leaf on a native enum or uuid column, and a quick search over one, is `unsupported`) | unset | `false` | — |
| optional `expressionValues` (default `true`; `false`: set values of a `time` column or of text without `caseSensitive`, and a value query on a non-text column, are `unsupported`) | unset | `false` | — |
| optional `blankTextAggregates` (default `true`; `false`: min, max, and count of text without `keepBlankText` are `unsupported`, in `aggregates` and group aggregates) | unset | `false` | — |

The parsers read the capabilities, so a declined test is refused with the request path (a filter leaf at `[...leaf, "operator"]` or `[...leaf, "value"]`, the search at `["spec", "searchText"]`, a values request at `["columnId"]` or `["query"]`) before the executor runs. An adapter keeps a decline that depends on the data it renders, such as Prisma's bound-value count of the whole statement and `maxGroupRows`. Selection reuses `countRows` and `selectRows`; writes reuse `where`. New error code: `bad-cursor`.

## 5. Glossary terms

- keyset cursor: the opaque string of key texts and a plan hash that resumes a page after the last row.
- resume predicate: the OR form that selects the rows after a keyset cursor's row.
- plan hash: the digest of a parsed plan's filter and order that marks a keyset cursor stale.
- key test: the `key` test, a raw comparison in the database's sort order.
- id list test: the `ids` test, exact primary-key membership bound as one parameter.
- validated change: what `validateChange` returns: the writes with scoped `where`s, and the refusals.
- write refusal: one refused row or cell of a validated change, in the shape of a `SaveRejection`.

## Prisma object API findings (spike, Prisma 7.10.1, SQLite and PostgreSQL via PGlite)

Source: `.crew/rounds/prisma-spike.md`. The Prisma walker follows these rules:
- `not`: make each leaf two-valued, then wrap in `NOT`. A bare comparison on a nullable field becomes `{ f: { gt: 1, not: null } }`, so `NOT` keeps the NULL rows. A plain `NOT: P` drops them.
- TRUE is `{}`, FALSE is `{ OR: [] }`. A `{}` member inside `OR` is dropped, and an `undefined` leaf vanishes: never pass either.
- Group `childCount`: `_count` is `COUNT(col)`, not a distinct count, so a second `groupBy` over the page's keys supplies it. Its row count has no upper bound: bound the page keys first, and `countGroups` has the same gap.
- Keyset resume predicate: the OR-expanded form works with mixed directions and NULLS LAST on both engines.
- `%` and `_` in text filters: PostgreSQL needs backslash escaping with `LIKE` and `ILIKE`; `equals` is never escaped, `equals` with `mode: "insensitive"` is. SQLite has no ESCAPE clause, so such a value is `unsupported-value` (`likeEscape: false`, refused by the core), and `mode` is an unknown argument there.
- Gaps against #96 (each refused, never wrong rows): on SQLite case-insensitive `equals`, `notEquals`, and set filters, case-sensitive LIKE leaves, `%` or `_` in a LIKE leaf, and excluded ids on a uuid key; LIKE on native enum and uuid columns, the quick search over one included; set values of `time` columns and of text without `caseSensitive`, and value queries on non-text columns; min, max, and count of text without `keepBlankText`; cursor sorts on `time` columns; custom operators (at creation); id lists past the bound-value budget (SQLite about 990); group counts and child pairs past `maxGroupRows`.

## Open points

- The grid keys a cursor of over 1,017 characters for its repeat check by `Object.is` only (`MAX_CURSOR_KEY_LENGTH` 1,024 in `scroll-sequence.ts`); a 2,048-byte cursor works, it only skips that memo.
- Prisma `DateTime` is milliseconds by default; allow `time` keys on `timestamp(3)` columns with a column flag?
- A deploy that changes the plan makes `bad-cursor` repeat on `refresh` until the spec changes; the grid has no cursor reset.
- `float` cannot tell `real` from `double precision`; a value beyond `real` range fails in the database.
- A client-generated key (uuid) on insert: write the parsed `rowId`, or keep "never written"?
