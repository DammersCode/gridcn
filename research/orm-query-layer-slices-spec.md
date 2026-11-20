# Spec: query layer 2.x slices (cursor, selection, write validation)

Status: decided, not built. Input: `research/orm-query-layer-spec.md`, the code in `registry/default/blocks/data-grid-server-query/`, issues #98, #100, #101. Prisma and Supabase supply no `SqlAlgebra`, so each construct names its rendering in both walkers.

## 1. Cursor paging (#98)

**Goal.** `paging: "cursor"` gives keyset pages with no count.

**Wire shape.** Request: the rows request; `cursor` is the position, `end - start` the limit. Answer: `{ rows, hasMore, nextCursor }`, no `totalRowCount`. `RowsAnswer` and `GridQuery` gain a last generic `TCursor = never`; cursor factories set `string`. Cursor: base64url JSON `[1, hash, ...keyTexts]`.

**Rendering rule.** Terms t1..tn, tn the tie-breaker. Resume = OR of (same(t1..ti-1) AND after(ti)); after = `false` for NULL, else `key gt` (asc) or `key lt` (desc) OR `key null`; same = `key eq`, or `key null`. Only the `selectRows` plan gets it. `key` drops `cmp`'s `col <> ''`, which skips `''` rows descending. Hash: FNV-1a 64 of the parsed `where` and `orderBy` (staleness only).

No HMAC: the cursor holds only values the client could send as filters; columns come from the sort and the allow-list, values bind, `rowScope` applies.

**Limits and untrusted-input bounds.** `maxCursorBytes` 512, before decoding. Creation throws for a sortable text column without `maxLength` or whose worst case (`6 × maxLength`) exceeds the cap; a multi-key sort over it is `limit-exceeded`.

**Client and server mode behavior.** Sequential scroll and cursor pages; other modes use offset. Local: n/a. A spec change resets the chain. Grouped requests are `unsupported`.

**Failure codes.** `bad-cursor` (400): malformed, stale hash, unparseable value.

Prisma: `{ f: { gt | lt | equals } }`, `{ f: null }` in `OR`, `take: n + 1`, no native `cursor`; `exactInstantKeys: false` declines `time` keys.
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

Prisma: `{ pk: { in | notIn: ids } }`; `maxBoundIds: 32_000` (P2029 near 40,000), so a longer list is `limit-exceeded`.
Supabase: quoted `in.(…)` while the URL fits `maxUrlLength`, else the selection RPC with ids as an array argument; without that RPC, `limit-exceeded`.

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

**Rendering rule.** `where` is `exact(pk, rowId)` AND `rowScope`, through `executor.where`; a move's `beforeWhere` and `afterWhere` scope its neighbor ids the same way, and a row or neighbor id the key parser of section 2 cannot turn into a key (wrong shape or declined, any length) refuses that operation as `not-an-id`; no id throws for the whole change. Key and scope columns are fixed by physical `field`, so an alias of their field is fixed too. An update checks `cells`, else the keys of `row` that differ from `prev`. Unmapped and `serverOnly` keys are skipped alike, never written. The key comes from `rowId`; its `row` entry is skipped, and a `cells` entry or a changed `row` value for a key or scope column is `not-writable`. An insert never writes the key, refuses missing `required` columns, and writes the parsed `rowScope` values. Checks come from `parse-import-rows.ts`: kind, `required`, `choices`, integer range, `scale`, finite floats, `maxLength`. A refused cell drops that cell of a `cells` update; any refusal drops a whole-row update (the grid reverts it whole) or an insert. The route pushes `{ rowId }` for a write that matched no row.

**Limits and untrusted-input bounds.** `maxChangeOps` 10,000 (a `QueryLimits` field); more than 10,000 refusals, the grid's bound, is `limit-exceeded`; text over `maxLength` (else `maxValueLength`) is `too-long`; body 512 KiB.

**Client and server mode behavior.** Same in every mode; validation reads no view state.

**Failure codes.** `invalid-request`, `limit-exceeded`; `unsupported` without one `primaryKey`.

Prisma: `updateMany`/`deleteMany({ where: { pk, ...scope } })`; `count === 0` is not found.
Supabase: `.update(values).eq(pk, v).eq(scope, s).select(pk)`; empty is not found; RLS stays the boundary.

## 4. New Test kinds and executor members

| Addition | Drizzle, Kysely (`render-sql.ts`) | Prisma | Supabase |
|---|---|---|---|
| Test `{ k: "key"; op: "gt" \| "lt" \| "eq" \| "null"; value?: Operand }` | `col > $1`, `col < $1`, `col = $1`, `col IS NULL` | `gt`, `lt`, `equals`, `null` | `gt.`, `lt.`, `eq.`, `is.null` |
| Test `{ k: "ids"; values: Operand[]; negate: boolean }`, never empty; `negate` for `excludedIds` | `= ANY($1::<type>[])` (a native enum compares `col::text`, so its key index is unused), `IN (SELECT value FROM json_each(?))` with decimals as JSON strings | `in`, `notIn` up to `maxBoundIds` | `in.()`, or the RPC |
| `RowsPlan.keyText`: `selectRows` also reads each `time` key as exact UTC text; the decoder parses it with a microsecond grammar (`parseInstant` stops at milliseconds) | `to_char(col::timestamptz AT TIME ZONE 'UTC', …US"Z")`; SQLite reads the stored value | declined | raw JSON text |
| optional `nativeValue(column, value)` | `Date` for Drizzle timestamp mode | `BigInt`, `Date` | identity |
| optional capabilities `exactInstantKeys`, `maxBoundIds` | `true`, none | `false`, 32,000 | `true`, URL then RPC |

Selection reuses `countRows` and `selectRows`; writes reuse `where`. New error code: `bad-cursor`.

## 5. Glossary terms

- keyset cursor: the opaque string of key texts and a plan hash that resumes a page after the last row.
- resume predicate: the OR form that selects the rows after a keyset cursor's row.
- plan hash: the digest of a parsed plan's filter and order that marks a keyset cursor stale.
- key test: the `key` test, a raw comparison in the database's sort order.
- id list test: the `ids` test, exact primary-key membership bound as one parameter.
- validated change: what `validateChange` returns: the writes with scoped `where`s, and the refusals.
- write refusal: one refused row or cell of a validated change, in the shape of a `SaveRejection`.

## Open points

- 512 bytes fit one text sort key of `maxLength` 55 next to an `int8` key; propose a 2,048 default.
- Prisma `DateTime` is milliseconds by default; allow `time` keys on `timestamp(3)` columns with a column flag?
- A deploy that changes the plan makes `bad-cursor` repeat on `refresh` until the spec changes; the grid has no cursor reset.
- `float` cannot tell `real` from `double precision`; a value beyond `real` range fails in the database.
- A client-generated key (uuid) on insert: write the parsed `rowId`, or keep "never written"?
