# ORM query layer: research

Status: research, input to `research/orm-query-layer-spec.md`. No production code.
Scope: how to compile a typed sort, filter, search, page, and aggregate spec to SQL safely through Drizzle, Prisma, Kysely, and Supabase (PostgREST).
Sources are high-trust primary pages (database manuals, vendor docs, library repos). Fetched text was treated as data. Facts carry a source label; `UNVERIFIED` marks a fact not confirmed from a primary source in this pass, `DERIVED` a conclusion drawn from cited facts.

Part 1 covers the SQL semantics that one compiler decides once. Part 2 covers Drizzle and Kysely. Part 3 covers Prisma and Supabase. Part 4 lists the conclusions the spec takes.

# Part 1: SQL semantics
Scope: compile `{sorts, filter tree, quickSearch, paging, count, aggregates, groupBy, setFilterValues}`
to SQL through Drizzle, Prisma, Kysely, and Supabase/PostgREST. Engines: PostgreSQL (PG), SQLite,
MySQL (MariaDB only where noted), SQL Server (MSSQL) where relevant.
Facts carry a source label from the table below. `UNVERIFIED` = not confirmed from a primary source
in this pass (general knowledge; verify before shipping). `DERIVED` = a conclusion drawn from cited facts.

## Sources

| Label | URL |
|---|---|
| PG-LIKE | https://www.postgresql.org/docs/current/functions-matching.html |
| PG-STR | https://www.postgresql.org/docs/current/functions-string.html |
| PG-CMP | https://www.postgresql.org/docs/current/functions-comparison.html |
| PG-SUBQ/ROW | https://www.postgresql.org/docs/current/functions-comparisons.html |
| PG-ORDER | https://www.postgresql.org/docs/current/queries-order.html |
| PG-LIMIT | https://www.postgresql.org/docs/current/queries-limit.html |
| PG-IDXTYPES | https://www.postgresql.org/docs/current/indexes-types.html |
| PG-OPCLASS | https://www.postgresql.org/docs/current/indexes-opclass.html |
| PG-EXPRIDX | https://www.postgresql.org/docs/current/indexes-expressional.html |
| PG-TRGM | https://www.postgresql.org/docs/current/pgtrgm.html |
| PG-CITEXT | https://www.postgresql.org/docs/current/citext.html |
| PG-COLL | https://www.postgresql.org/docs/current/collation.html |
| PG-NUM | https://www.postgresql.org/docs/current/datatype-numeric.html |
| PG-DT | https://www.postgresql.org/docs/current/datatype-datetime.html |
| PG-TYPECONV | https://www.postgresql.org/docs/current/typeconv-oper.html |
| PG-AGG | https://www.postgresql.org/docs/current/functions-aggregate.html |
| PG-GROUPSETS | https://www.postgresql.org/docs/current/queries-table-expressions.html |
| PG-FTS | https://www.postgresql.org/docs/current/textsearch-controls.html |
| PG-FTSIDX | https://www.postgresql.org/docs/current/textsearch-tables.html |
| PG-ROWEST | https://www.postgresql.org/docs/current/row-estimation-examples.html |
| PG-PROTO | https://www.postgresql.org/docs/current/protocol-message-formats.html |
| PG-SCS | https://www.postgresql.org/docs/current/runtime-config-compatible.html |
| SQLITE-EXPR | https://www.sqlite.org/lang_expr.html |
| SQLITE-TYPES | https://www.sqlite.org/datatype3.html |
| SQLITE-OPT | https://www.sqlite.org/optoverview.html |
| SQLITE-LIMITS | https://www.sqlite.org/limits.html |
| SQLITE-ROWVAL | https://www.sqlite.org/rowvalue.html |
| SQLITE-AGG | https://www.sqlite.org/lang_aggfunc.html |
| SQLITE-3.30 | https://www.sqlite.org/releaselog/3_30_0.html |
| SQLITE-FTS5 | https://www.sqlite.org/fts5.html |
| MY-LIKE | https://dev.mysql.com/doc/refman/8.4/en/string-comparison-functions.html |
| MY-NULL | https://dev.mysql.com/doc/refman/8.4/en/working-with-null.html |
| MY-CONV | https://dev.mysql.com/doc/refman/8.4/en/type-conversion.html |
| MY-SELECT | https://dev.mysql.com/doc/refman/8.4/en/select.html |
| MY-ROWCTOR | https://dev.mysql.com/doc/refman/8.4/en/row-constructor-optimization.html |
| MY-CHARSET | https://dev.mysql.com/doc/refman/8.4/en/charset-server.html |
| MY-AGG | https://dev.mysql.com/doc/refman/8.4/en/aggregate-functions.html |
| MY-ROLLUP | https://dev.mysql.com/doc/refman/8.4/en/group-by-modifiers.html |
| MY-FT | https://dev.mysql.com/doc/refman/8.4/en/fulltext-search.html |
| MY-FTBOOL | https://dev.mysql.com/doc/refman/8.4/en/fulltext-boolean.html |
| MY-ERR | https://dev.mysql.com/doc/mysql-errors/8.4/en/server-error-reference.html |
| MS-LIKE | https://learn.microsoft.com/en-us/sql/t-sql/language-elements/like-transact-sql |
| MS-ORDER | https://learn.microsoft.com/en-us/sql/t-sql/queries/select-order-by-clause-transact-sql |
| MS-CAP | https://learn.microsoft.com/en-us/sql/sql-server/maximum-capacity-specifications-for-sql-server |
| MS-PREC | https://learn.microsoft.com/en-us/sql/t-sql/data-types/data-type-precedence-transact-sql |
| MS-DATETIME | https://learn.microsoft.com/en-us/sql/t-sql/data-types/datetime-transact-sql |
| PGRST-TV | https://raw.githubusercontent.com/PostgREST/postgrest/main/docs/references/api/tables_views.rst |
| PGRST-URL | https://raw.githubusercontent.com/PostgREST/postgrest/main/docs/references/api/url_grammar.rst |
| OWASP-SQLI | https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html |
| PRISMA-RAW | https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries |
| PRISMA-CASE | https://www.prisma.io/docs/orm/prisma-client/queries/case-sensitivity |
| KYSELY-SQL | https://kysely-org.github.io/kysely-apidoc/interfaces/Sql.html |
| DRIZZLE-SQL | https://orm.drizzle.team/docs/sql |
| NODEPG-TYPES | https://github.com/brianc/node-pg-types , https://node-postgres.com/features/types |

---

## 1. LIKE / ILIKE escaping and case policy

### Facts
- Wildcards: `%` (any run, incl. empty), `_` (one char) everywhere [PG-LIKE, SQLITE-EXPR, MY-LIKE, MS-LIKE].
  MSSQL adds `[set]`, `[a-f]`, `[^set]`; a literal wildcard can be bracketed (`'5[%]'`, `'[_]n'`, `'[ [ ]'`) [MS-LIKE].
- LIKE matches the whole string; substring needs `%v%` [PG-LIKE].
- Default escape char:
  - PG: backslash. `ESCAPE ''` disables escaping (non-standard; the standard says no ESCAPE = no escape char) [PG-LIKE].
  - SQLite: none unless `ESCAPE` given; the escape expr must be one char [SQLITE-EXPR].
  - MySQL: backslash, unless `NO_BACKSLASH_ESCAPES` is on (then none). `ESCAPE` must be constant at execution time;
    under `NO_BACKSLASH_ESCAPES` it cannot be empty [MY-LIKE].
  - MSSQL: no default; must evaluate to one char. Escape followed by a non-wildcard: escape is dropped. Escape at the
    end of the pattern: pattern invalid, LIKE returns FALSE [MS-LIKE].
- Backslash in string literals: PG `standard_conforming_strings` defaults `on` since 9.1 (backslash literal in `'...'`)
  [PG-SCS]. MySQL string literals are C-escaped, so a backslash in a LIKE literal is stripped twice: `'\\\\'` matches one
  `\` [MY-LIKE]. Neither matters for bound parameters (the parser never sees the value) - DERIVED.
- Trailing spaces: always significant in MySQL LIKE [MY-LIKE]. MSSQL: trailing blanks in the pattern are significant;
  trailing blanks in the matched non-Unicode expression are ignored; for `nchar/nvarchar` they are significant [MS-LIKE].
- MySQL LIKE compares per character: `'ä' LIKE 'ae' COLLATE latin1_german2_ci` = 0 while `=` gives 1 [MY-LIKE].
- MySQL allows LIKE on numbers (`10 LIKE '1%'` = 1); MSSQL converts non-string args to string [MY-LIKE, MS-LIKE].
- PG: LIKE is "much simpler" than SIMILAR TO / POSIX regex, so safer with hostile patterns [PG-LIKE].

### Decision: one escaper, explicit ESCAPE, bound pattern
Use the escape char `!` in every engine and always emit an explicit `ESCAPE '!'`. Reasons: SQLite and MSSQL have no
default; MySQL's default depends on `sql_mode`; backslash in SQL text is mode-dependent in MySQL (DERIVED).

```ts
const escLike = (v: string, dialect: Dialect) =>
  v.replace(dialect === "mssql" ? /[!%_[]/g : /[!%_]/g, "!$&");
// contains:   `%${escLike(v)}%`   startsWith: `${escLike(v)}%`   endsWith: `%${escLike(v)}`
```
```sql
-- PG / SQLite / MySQL / MSSQL, pattern bound as a parameter:
WHERE col LIKE ? ESCAPE '!'
```
- `]`, `^`, `-` are special only inside `[...]` in MSSQL; escaping `[` neutralizes every bracket class (DERIVED from MS-LIKE).
- The escape character literal is compiler-owned SQL text, never user data.
- PostgREST has no ESCAPE clause: PG's default backslash applies, and `*` is an alias of `%` in `like`/`ilike`
  [PGRST-TV]. So for PostgREST: escape `\`, `%`, `_` with a backslash. A literal `*` in user text becomes a wildcard;
  whether it can be escaped is UNVERIFIED. Options: document `*` as wildcard, reject it, or route contains-filters
  through an RPC function that uses `ESCAPE`.

### Case-insensitive matching per engine
| Engine | Mechanism | Notes |
|---|---|---|
| PG | `col ILIKE ? ESCAPE '!'` | case-insensitive "according to the active locale"; ILIKE does not support nondeterministic collations [PG-LIKE] |
| PG | `lower(col) LIKE lower(?)` | `lower` follows the database locale [PG-STR]; needs index on `lower(col)`, and the query must use the same expression [PG-EXPRIDX] |
| PG | `casefold(col) LIKE casefold(?)` | Unicode Default Caseless Matching; may change length (`ß` -> `ss` under `PG_UNICODE_FAST`); UTF8 only; libc provider: identical to `lower` [PG-STR]. Version availability not stated on the page (UNVERIFIED: PG 18+) |
| PG | nondeterministic ICU collation (`und-u-ks-level2`) | LIKE supports nondeterministic collations [PG-LIKE]; performance penalty, no btree dedup, "some pattern matching operations" impossible [PG-COLL] |
| PG | `citext` column | calls `lower`; folding from `LC_CTYPE`; not full Unicode folding; docs recommend nondeterministic collations instead [PG-CITEXT] |
| SQLite | plain `LIKE` | case-insensitive for ASCII only; `'æ' LIKE 'Æ'` false; ICU extension adds Unicode folding; `PRAGMA case_sensitive_like` [SQLITE-EXPR]; `NOCASE` folds ASCII only [SQLITE-TYPES] |
| MySQL | plain `LIKE` | case-insensitive unless a case-sensitive or binary collation is involved [MY-LIKE]; default collation `utf8mb4_0900_ai_ci` [MY-CHARSET] (`ai` = accent-insensitive: UNVERIFIED from the fetched page, standard naming) |
| MSSQL | plain `LIKE` | collation decides [MS-LIKE]; case-insensitive by default per [PRISMA-CASE] |
| Prisma | `mode: 'insensitive'` | PG and MongoDB only; MySQL/MSSQL already CI by collation; SQLite needs `COLLATE NOCASE` [PRISMA-CASE] |

Decision: the spec states the *intent* `caseSensitive: false` (default) and the compiler maps it per engine:
PG `ILIKE`; SQLite `LIKE` (document ASCII-only folding); MySQL/MSSQL `LIKE` (document collation dependence and
that `_ai_` collations also ignore accents). For `caseSensitive: true`: PG `LIKE`; SQLite `GLOB` is case-sensitive
with Unix glob wildcards [SQLITE-EXPR] (needs its own escaper; `[*]`-style bracket escaping UNVERIFIED) - or
`instr(col, ?) > 0` for contains (UNVERIFIED, avoids patterns entirely); MySQL `col LIKE ? COLLATE utf8mb4_bin`; MSSQL `COLLATE Latin1_General_CS_AS` (UNVERIFIED collation name per server).
- Unicode pitfalls: one-to-many folds (`ß`/`ss`) and "uppercase letter with two lowercase equivalents" [PG-CITEXT, PG-STR].
  Turkish dotted/dotless i under a `tr` locale lowercases `I` to `ı`, so `lower('I') LIKE 'i'` fails there - UNVERIFIED.
  Client-side JS `toLowerCase()` and server folding will disagree on such inputs; document "server decides".

### Index consequences
- Btree serves LIKE/`~` only for a constant pattern anchored at the start (`'foo%'`), not `'%bar'`; in a non-C locale it
  needs `text_pattern_ops`/`varchar_pattern_ops`; ILIKE/`~*` use btree only if the pattern starts with non-alphabetic
  characters [PG-IDXTYPES, PG-OPCLASS]. `pattern_ops` indexes do not serve `<`/`>` - keep a default index too [PG-OPCLASS].
- PG prefix: `col ^@ ?` / `starts_with(col, ?)` avoid escaping entirely [PG-STR] (index support UNVERIFIED).
- pg_trgm GIN/GiST serve `LIKE`, `ILIKE`, `~`, `~*`, `=` with unanchored patterns; a pattern with no extractable
  trigrams (very short) degenerates to a full-index scan [PG-TRGM].
- SQLite LIKE index optimization: pattern literal or bound param not starting with a wildcard; TEXT-affinity column (or
  pattern not starting with `-`/digit); index must be `NOCASE` when `case_sensitive_like` is off; ESCAPE char must be
  ASCII/single-byte UTF-8 (`!` qualifies) [SQLITE-OPT]. So `contains` (`%v%`) never uses a btree in any engine - DERIVED.

---

## 2. NULL and empty semantics

### Facts
- `=`, `<>`, `<` etc. yield NULL if either side is NULL; WHERE keeps only TRUE [PG-CMP, MY-NULL, SQLITE-EXPR].
- `x NOT IN (a, NULL)` is NULL when no match - it can never be TRUE [PG-SUBQ/ROW]. `x IN (1, NULL)` is NULL for x=3.
- `NULL NOT LIKE p` is NULL; MySQL docs show `bar NOT LIKE '%baz%' OR bar IS NULL` to include NULLs [MY-LIKE].
- Null-safe comparison: PG `IS [NOT] DISTINCT FROM` (never NULL) [PG-CMP]; SQLite `IS` / `IS NOT`
  (= `IS NOT DISTINCT FROM` / `IS DISTINCT FROM`) [SQLITE-EXPR]; MySQL `<=>` [MY-NULL, secondary note in fetch];
  MSSQL `IS DISTINCT FROM` (UNVERIFIED: SQL Server 2022+).
- NULL is not `''` or `0` in PG/MySQL/SQLite/MSSQL [MY-NULL]. Oracle treats `''` as NULL (note only, UNVERIFIED here).
- PG: comparing an integer column with a non-numeric string literal errors (`int_col = ''` ->
  `invalid input syntax for type integer`): the unknown literal takes the column's type [PG-TYPECONV].
- MySQL: string vs number compares as double; `0 = 'x6'` is 1, so `int_col = ''` silently matches 0 [MY-CONV].
- MSSQL: the lower-precedence type converts to the higher one (`nvarchar` -> `int`); a failed conversion errors [MS-PREC].

### Decisions (the leaf owns its NULL policy; the tree has only AND/OR, so policies compose without a NOT-over-group trap)
| Operator | NULL row matches? | Rationale |
|---|---|---|
| equals, startsWith, endsWith, contains, gt/gte/lt/lte, isBetween, isAnyOf | no | natural SQL |
| notEquals, notContains, isNoneOf | **yes** | "not X" includes blanks for the user; emit `OR col IS NULL` explicitly |
| empty | yes (NULL, and `''` for text only) | |
| notEmpty | no (`IS NOT NULL`, and `<> ''` for text) | |

```sql
-- notEquals (portable; null-safe forms differ per engine)
(col <> ? OR col IS NULL)
-- notContains
(col NOT LIKE ? ESCAPE '!' OR col IS NULL)
-- isNoneOf: never put NULL in the list
(col NOT IN (?, ?, ?) OR col IS NULL)
-- empty, text column
(col IS NULL OR col = '')
-- empty, number/date/boolean/enum column: never compare with ''
col IS NULL
```
- A "(Blanks)" entry in a set filter is a sentinel, not a NULL list element: `isAnyOf ["a", BLANK]` ->
  `(col IN (?) OR col IS NULL [OR col = ''])`; `isNoneOf ["a", BLANK]` -> `(col NOT IN (?) AND col IS NOT NULL [AND col <> ''])`.
- Whitespace-only text: decide "not empty" (no trim) to keep `=` sargable. Note: MSSQL non-Unicode compare ignores
  trailing blanks in LIKE [MS-LIKE]; MySQL `=` padding depends on the collation pad attribute [MY-LIKE]. So `col = ''`
  may match `'  '` on some engines - divergence to document.

---

## 3. Coercing client text values

Rule: parse every value in the compiler by column kind; never rely on implicit engine coercion
(PG errors, MySQL float compare, SQLite affinity, MSSQL precedence errors - all above). Bind typed values.

### Numbers
- Accept only an anchored, length-bounded decimal grammar, e.g. `^-?(0|[1-9][0-9]*)(\.[0-9]+)?$` (+ optional exponent),
  max ~40 chars. Linear-time regex, no nested quantifiers.
- Reject `NaN`, `Infinity`, `inf`: PG `numeric` and float types accept these strings case-insensitively; NaN sorts above
  all numbers and `NaN = NaN` is true [PG-NUM]. Passing raw text through would let clients query them.
- Integers: check range against the column type before binding (bigint: -9223372036854775808..9223372036854775807;
  out-of-range errors [PG-NUM]). Use `BigInt`, never JS `Number`, above 2^53 - DERIVED.
- Decimal precision: bind as a string with an explicit cast (`?::numeric` in PG) rather than a JS float.
  MySQL compares big integer vs string approximately (`'9223372036854775807' = 9223372036854775806` is 1) unless CAST [MY-CONV].
- Fractional value vs integer column: PG `int_col > '3.5'` errors (literal typed as integer) [PG-TYPECONV] - DERIVED:
  emit `int_col > CAST(? AS numeric)` or reject fractions for integer columns. Pick one; recommended: cast to numeric.
- Locale decimal separators (`3,5`): the client normalizes to `.`; the compiler rejects `,`. Thousands separators: reject.
- SQLite: a text value compared with an INTEGER/NUMERIC-affinity column is converted to a number only if lossless
  [SQLITE-TYPES]; bind JS numbers anyway, so storage-class order (NULL < numbers < TEXT < BLOB) never decides a filter.

### Booleans
- Accept `true`/`false` (optionally `1`/`0`), bind as boolean. SQLite stores 0/1, `TRUE`/`FALSE` are aliases since
  3.23.0 [SQLITE-TYPES]; MySQL `BOOLEAN` = `TINYINT(1)` and "0 or NULL is false" [MY-NULL]; MSSQL `bit`.
- `notEquals true` must include NULL (section 2): `(col <> TRUE OR col IS NULL)`.

### Dates and timestamps
- Day-granular operators on a timestamp column expand to half-open ranges; never use `23:59:59.999`:
  MSSQL `datetime` rounds `.999` up to the next day `00:00:00.000` [MS-DATETIME]; PG resolution is 1 microsecond, so
  `.999` misses `.9995..` [PG-DT].

```sql
-- equals D            col >= :d0 AND col < :d1        (d1 = next day start)
-- gt D                col >= :d1
-- gte D               col >= :d0
-- lt D                col <  :d0
-- lte D               col <  :d1
-- isBetween [A, B]    col >= :a0 AND col < :b1          (open bound: drop that side)
-- date column: compare dates directly (col = :d, col BETWEEN :a AND :b)
```
- Keep predicates sargable: no `date(col) = ?` / `CAST(col AS date) = ?` - DERIVED (expression vs plain index, [PG-EXPRIDX]).
- Who defines "a day": the spec must carry it. Recommend `timeZone` (IANA name) on the request, default `UTC`; the
  compiler computes `[d0, d1)` instants in JS and binds explicit-offset timestamps.
  - PG `timestamptz`: stored as UTC; input without a zone uses the session `TimeZone` [PG-DT] - so always send an offset.
  - PG `timestamp` (no tz): zone indications in input are "silently ignored" [PG-DT] - bind wall-clock values, no conversion.
  - `timestamp` <-> `timestamptz` conversion uses `TimeZone` unless `AT TIME ZONE` is given [PG-DT].
  - DST: a local day is not always 24 h; compute `d1` as next local midnight, not `d0 + 86400 s` - DERIVED.
- node-postgres parses `DATE` and `TIMESTAMP` into the Node process's local time (`process.env.TZ`) [NODEPG-TYPES]:
  a `date` column read as JS `Date` can shift a day. Read dates as strings for cursors and set-filter values.
- SQLite has no date type: TEXT ISO-8601, REAL Julian day, or INTEGER Unix time [SQLITE-TYPES]. Text compare is
  lexicographic, so mixed separators break ranges (`'2024-01-01T00:00'` > `'2024-01-01 23:00'` since `T` > space) -
  DERIVED. The column definition must declare the storage format; bind bounds in the same format.
- MSSQL: ISO 8601 `yyyy-MM-ddTHH:mm:ss[.mmm]` is unaffected by `SET DATEFORMAT`/`SET LANGUAGE` [MS-DATETIME]; bind typed
  values anyway.

---

## 4. Collation and ordering

### NULL placement defaults
| Engine | ASC | DESC | NULLS FIRST/LAST syntax |
|---|---|---|---|
| PG | last | first ("nulls sort as if larger") [PG-ORDER] | yes [PG-ORDER] |
| SQLite | first | last (NULL < all storage classes [SQLITE-TYPES]) | yes since 3.30.0 [SQLITE-3.30] |
| MySQL | first | last [MY-NULL] | no (grammar has only ASC/DESC) [MY-SELECT] |
| MSSQL | first | last ("NULL values are treated as the lowest possible values") [MS-ORDER] | no in the documented grammar [MS-ORDER] |
| PostgREST | PG default | | `order=col.desc.nullslast` [PGRST-TV] |

Decision: the spec defines NULL placement explicitly; recommended canonical = **nulls last in both directions**
(blanks at the bottom). Always emit it, never inherit an engine default.
```sql
-- PG, SQLite >= 3.30
ORDER BY col ASC NULLS LAST, id ASC
-- MySQL (col IS NULL yields 0/1)
ORDER BY (col IS NULL), col ASC, id ASC
-- MSSQL
ORDER BY CASE WHEN col IS NULL THEN 1 ELSE 0 END, col ASC, id ASC
```
- Cost: the MySQL/MSSQL emulation is an expression sort key (index order unusable for that key) - DERIVED. In PG a btree
  scanned backward gives `DESC NULLS FIRST`; `DESC NULLS LAST` needs an index declared that way (UNVERIFIED wording;
  see PG index ordering docs).

### Text collation
- PG `ORDER BY` uses the sort key's collation; default = database locale; `C` sorts by bytes [PG-COLL].
- SQLite default `BINARY` = `memcmp` (so `'B' < 'a'`), `NOCASE` ASCII-only [SQLITE-TYPES].
- MySQL default `utf8mb4_0900_ai_ci` [MY-CHARSET]; MSSQL per-column collation, `ORDER BY ... COLLATE` overrides [MS-ORDER].
- Consequence: server order differs from a client `Intl.Collator` sort; the grid must not re-sort server pages
  client-side - DERIVED. Expose an optional per-column `collation` only as an allow-listed name.

### Total order
- Without a unique ORDER BY, LIMIT/OFFSET pages are unpredictable and may differ between page sizes; "This is not a bug"
  [PG-LIMIT]. MSSQL: stable OFFSET/FETCH paging needs a unique ORDER BY and unchanged data or snapshot/serializable
  isolation [MS-ORDER].
- Decision: always append the primary key (non-null, unique) as the final sort key; with no sorts, sort by PK only.
  Multi-sort: keys in spec order, each with its own direction and null placement [PG-ORDER].

---

## 5. Paging

### Offset paging
- Skipped rows are still computed; large OFFSET is slow [PG-LIMIT]; SQLite cost grows with the offset [SQLITE-ROWVAL].
- MySQL `LIMIT offset, count`; "to the end" needs `18446744073709551615` [MY-SELECT]. MSSQL `OFFSET n ROWS FETCH NEXT m
  ROWS ONLY` requires ORDER BY [MS-ORDER].
- Bounds: `end - start <= maxPageSize` (e.g. 1000), `start <= maxOffset` (e.g. 100 000; beyond that require a cursor).

### Cursor (keyset) paging
- Row values: `WHERE (a, b) > (?, ?) ORDER BY a, b` - SQLite >= 3.15.0 [SQLITE-ROWVAL]; PG lexicographic, stops at the
  first unequal or NULL pair and then yields NULL [PG-SUBQ/ROW]. MySQL may use indexes less well for row constructors;
  the manual suggests the expanded OR form [MY-ROWCTOR].
- Row values only work when all keys share one direction and no key is nullable - DERIVED. Decision: always emit the
  expanded form; it handles mixed directions and NULLs.

Cursor = values of every sort key + PK, plus a hash of `{sorts, filters, quickSearch}`; reject a cursor whose hash
does not match. Encode values as text exactly as the DB returns them: JS `Date` has millisecond precision while PG
timestamps have microseconds [PG-DT], so a `Date` cursor skips or repeats rows - DERIVED.

Expansion for keys k1..kn (kn = PK), cursor values c1..cn:
```
after(k_i, c_i)  for ASC NULLS LAST : c_i IS NULL -> FALSE ;  else (k_i > c_i OR k_i IS NULL)
after(k_i, c_i)  for DESC NULLS LAST: c_i IS NULL -> FALSE ;  else (k_i < c_i OR k_i IS NULL)
after(k_i, c_i)  for ASC NULLS FIRST: c_i IS NULL -> k_i IS NOT NULL ; else k_i > c_i
same(k_i, c_i)   : c_i IS NULL -> k_i IS NULL ; else k_i = c_i
WHERE  after(k1) OR (same(k1) AND after(k2)) OR (same(k1) AND same(k2) AND after(k3)) ...
```
```sql
-- sorts: price ASC NULLS LAST, id ASC ; cursor (price=10.00, id=42)
WHERE (price > ? OR price IS NULL) OR (price = ? AND id > ?)
-- cursor (price=NULL, id=42)
WHERE (price IS NULL AND id > ?)
```
The compiler decides `c_i IS NULL` in JS, so the SQL holds no `? IS NULL` tests - DERIVED.

### Total count
- MySQL InnoDB has no stored row count; `COUNT(*)` scans the smallest secondary index (transaction-visible rows);
  `SHOW TABLE STATUS` gives an approximate count [MY-AGG]. PG exact counts also scan (UNVERIFIED from a primary page here).
- PG estimates: `pg_class.reltuples` (whole table, as of last VACUUM/ANALYZE; planner scales by current pages)
  [PG-ROWEST]; `EXPLAIN` `rows=` estimates a filtered query [PG-ROWEST].
- PostgREST: `Prefer: count=exact|planned|estimated` (UNVERIFIED in this pass: docs host rate-limited).
- Options, in order of cost:
  1. `hasMore` only: fetch `pageSize + 1` rows.
  2. capped count: `SELECT count(*) FROM (SELECT 1 FROM t WHERE <filters> LIMIT 10001) s` -> "10 000+".
  3. exact count over the same WHERE (separate query).
  4. `count(*) OVER ()` in the page query - computes the full filtered set before LIMIT (cost = exact count).
  5. estimate (PG EXPLAIN / reltuples, MySQL table status) - label as approximate.
- Consistency: count and page from different snapshots can disagree under writes. Run both in one transaction at
  REPEATABLE READ/snapshot when exactness matters [MS-ORDER for the principle]; otherwise clamp the client (end of data
  = first short page).

---

## 6. Set filters (isAnyOf / isNoneOf / distinct values)

### Parameter limits
| Engine | Limit | Source |
|---|---|---|
| PG | parameter count is an Int16 field in Bind/Parse -> at most 65535 (DERIVED; exact max UNVERIFIED) | [PG-PROTO] |
| SQLite | `SQLITE_MAX_VARIABLE_NUMBER` 999 before 3.32.0, 32766 after; runtime-lowerable | [SQLITE-LIMITS] |
| MySQL | error 1390 `ER_PS_MANY_PARAM` "Prepared statement contains too many placeholders"; limit 65535 UNVERIFIED | [MY-ERR] |
| MSSQL | 2100 parameters per stored procedure / UDF (parameterized batches: same limit, UNVERIFIED) | [MS-CAP] |

- Big lists in one parameter: PG `col = ANY(?::text[])`, `col <> ALL(?::text[])` - empty array gives false / true
  [PG-SUBQ/ROW], which matches the empty-list semantics below. SQLite `col IN (SELECT value FROM json_each(?))`,
  MySQL `JSON_TABLE`, MSSQL `OPENJSON`/table-valued parameter (all UNVERIFIED in this pass).
- Decision: cap list length in the spec validator (e.g. 1000 values, each <= 256 chars) regardless of engine; one
  array/JSON parameter where supported, else chunk-free rejection above the cap.
- `<> ALL(array with NULL)` / `NOT IN (..., NULL)` never TRUE [PG-SUBQ/ROW]: strip NULL/BLANK from the list; handle
  blanks with the sentinel rule (section 2).

### Empty lists
- SQLite accepts `IN ()` (false) and `NOT IN ()` (true, even for NULL left side); "most other engines and SQL92 require
  at least one element" [SQLITE-EXPR].
- Decision: `isAnyOf []` -> constant FALSE (`1 = 0`); `isNoneOf []` -> TRUE (drop the leaf). Never emit `IN ()`.

### Distinct values query (faceting)
```sql
SELECT col AS value, count(*) AS n
FROM t
WHERE <all filters except leaves on this column>
  AND col ILIKE ? ESCAPE '!'          -- optional search, same escaper
GROUP BY col
ORDER BY n DESC, value ASC NULLS LAST
LIMIT ?                                -- cap + 1 to report "more values"
```
- GROUP BY puts all NULLs in one group [MY-NULL]. If `empty` treats `''` as blank, group `NULLIF(col, '')` for text so
  NULL and `''` form one "(Blanks)" entry - DERIVED.
- Date/number values returned as text (exact round-trip into the next isAnyOf) - DERIVED from section 3.
- Values are data: render as text, never as markup.

---

## 7. Quick search across columns

- Default semantics = the client's: case-insensitive substring per column, OR across columns, AND across terms:
```sql
-- term t1, columns name, email
(name ILIKE ? ESCAPE '!' OR email ILIKE ? ESCAPE '!')
```
  Only text columns take part; numeric columns match only when the term parses as a number (`= ?`) - recommended
  decision. Cost: no btree helps (`%v%`); PG needs pg_trgm GIN per column or on a concatenated expression [PG-TRGM].
- Full-text is a different operator, not a faster contains: stemming, stop words, whole tokens; prefix only - DERIVED.
  - PG: `websearch_to_tsquery` "will never raise syntax errors" -> safe for raw input; `plainto_tsquery` ignores operators;
    `to_tsquery` errors on bad syntax - never pass user text to it [PG-FTS]. Index use requires the same
    2-argument `to_tsvector('cfg', col)` as the index, or a stored generated `tsvector` column [PG-FTSIDX].
    `ts_rank` is expensive (reads each matching tsvector) [PG-FTS].
  - SQLite FTS5: `MATCH` takes a query language: `AND OR NOT` (case-sensitive keywords), `NEAR(...)`, `col:` filters,
    `^`, `*`, `+`, parentheses; malformed input is a syntax error [SQLITE-FTS5]. Escape: wrap every user term in double
    quotes and double embedded quotes (`"o""brien"`), join with spaces (implicit AND) [SQLITE-FTS5]. Unquoted barewords
    with other characters may gain meaning in future versions [SQLITE-FTS5]. Trigram tokenizer gives substring matching
    and indexed LIKE/GLOB, but substrings < 3 chars match no rows in MATCH and LIKE falls back to a scan [SQLITE-FTS5].
    `bm25()`: lower = better [SQLITE-FTS5].
  - MySQL FULLTEXT: InnoDB/MyISAM, CHAR/VARCHAR/TEXT; modes natural (only `"` special), boolean, query expansion
    [MY-FT]. Boolean operators `+ - > < ( ) ~ * "` and `@distance`; InnoDB rejects `'++apple'`, `'apple+'`, `'+-'`;
    only-`-` query returns empty; no 50% threshold in boolean mode [MY-FTBOOL]. Token size vars
    `innodb_ft_min_token_size` / `ft_min_word_len` (defaults 3 / 4 UNVERIFIED) [MY-FTBOOL]. Escaping: use natural
    mode, or strip operator chars and quote each term in boolean mode (completeness UNVERIFIED).
- Decision: `quickSearch` = escaped LIKE/ILIKE OR-chain (semantics match the client); an optional `fullText` mode is
  per-engine, documented as token-based, built only via `websearch_to_tsquery` (PG), quoted terms (FTS5), natural mode
  (MySQL).
- Bounds: max terms (e.g. 8), max term length (e.g. 128), max searched columns.

---

## 8. Aggregates and group-by pushdown

### Semantics
- Aggregates ignore NULL; except `count`, they return NULL on no rows (`sum` of nothing is NULL, not 0) [PG-AGG, MY-AGG].
- `count(*)` counts rows; `count(col)` non-NULL values; `count(DISTINCT col)` distinct non-NULL [MY-NULL note, SQLITE-AGG].
- Return types:
  - PG: `sum(int)` -> bigint, `sum(bigint)` -> numeric, `avg(integer types)` -> numeric, `count` -> bigint [PG-AGG].
  - MySQL: `SUM/AVG` -> DECIMAL for exact args, DOUBLE for FLOAT/DOUBLE [MY-AGG].
  - SQLite: `sum` integer if all inputs integer, raises "integer overflow"; `total()` float, 0.0 on empty; `avg` always
    float [SQLITE-AGG].
  - MSSQL: `AVG(int)` returns int (truncates) - UNVERIFIED; cast to decimal before AVG.
- JS drivers: node-postgres returns int8 as string (JS lacks 64-bit ints) [NODEPG-TYPES]; numeric likewise (UNVERIFIED);
  Prisma raw maps 64-bit ints to `BigInt`, decimals to `Decimal` [PRISMA-RAW].
- Decision: the aggregate contract returns `{ value: string | null }` (decimal string) and lets the column formatter
  parse; never `Number()` silently. `sum` of no rows stays NULL (shown blank); `count` is 0.

### Totals and subtotals
- PG: `GROUPING SETS`, `ROLLUP`, `CUBE`; `()` = grand total, output even with no input rows; ungrouped columns become
  NULL; `GROUPING(a, b)` bit mask tells subtotal NULLs from data NULLs [PG-GROUPSETS, PG-AGG].
- MySQL: `GROUP BY ... WITH ROLLUP` or `ROLLUP(...)`, `GROUPING()` in select/HAVING/ORDER BY [MY-ROLLUP, MY-SELECT];
  `CUBE`/`GROUPING SETS` not documented (UNVERIFIED absent). MATCH() on a grouping column + ROLLUP is rejected [MY-FT].
- MSSQL: ROLLUP/CUBE/GROUPING SETS; <= 32 distinct expressions with them, <= 4096 grouping sets, WITH CUBE/ROLLUP <= 10
  columns [MS-CAP].
- SQLite: no ROLLUP in the grammar (UNVERIFIED) -> emulate with `UNION ALL` of one GROUP BY per level, or one query per level.
- Decision: one query per requested level is the portable baseline; ROLLUP is a PG/MySQL/MSSQL optimization that must
  use `GROUPING()` to label rows.

### WHERE vs HAVING, paging groups
- Row filters (spec filters, quick search) -> WHERE, before grouping; filters on aggregate values -> HAVING [PG-GROUPSETS].
- Group count for paging: `SELECT count(*) FROM (SELECT 1 FROM t WHERE ... GROUP BY g) s`. Group order needs a tie-
  breaker too: all group keys.
- Cost: every aggregate scans the full filtered set; aggregates for the footer and the page are separate queries -
  share the WHERE builder so they agree - DERIVED.

### Pivot via conditional aggregation
```sql
-- PG, SQLite >= 3.30 [SQLITE-3.30, SQLITE-AGG]
SELECT region,
       sum(amount) FILTER (WHERE quarter = ?) AS p0,
       sum(amount) FILTER (WHERE quarter = ?) AS p1
FROM t WHERE <filters> GROUP BY region;
-- MySQL / MSSQL
SELECT region, SUM(CASE WHEN quarter = ? THEN amount END) AS p0, ...
```
- Pivot values are data -> bound parameters; output aliases are compiler-generated (`p0..pn`) and mapped back in JS,
  never derived from data - DERIVED from OWASP identifier rule.
- Cap pivot columns (e.g. 200); MSSQL hard limit 4096 select columns [MS-CAP]. Fetch the pivot value list first with
  the distinct-values query (capped).

---

## 9. Injection safety

- Parameters cannot carry table/column names or keywords such as ASC/DESC; map user choices to application-owned
  tokens and reject unknown ones; escaping-based construction is "STRONGLY DISCOURAGED" [OWASP-SQLI].
  Prisma: "Variables cannot be used for identifiers" [PRISMA-RAW].
- Decision: `columnId` -> lookup in a server-side column registry (ORM column object or vetted expression); unknown id
  = 400. `direction`, `operator`, aggregate fn, null placement -> `switch` over closed enums to fixed SQL fragments.
- Identifier quoting (only for registry-owned names): PG/SQLite `"name"` (double `"`), MySQL `` `name` ``, MSSQL
  `[name]` (double `]`) - UNVERIFIED in this pass. Quoting protects syntax but does not restrict which objects are
  reachable [OWASP-SQLI], so the registry is the control.
- ORM raw fragments:
  - Prisma: `$queryRaw` tagged template binds `${}`; `$queryRawUnsafe` and `Prisma.raw` inject [PRISMA-RAW].
  - Kysely: `sql` binds `${}`; `sql.raw`, `sql.lit` "WILL lead to SQL injection" with unchecked input; `sql.ref`,
    `sql.table`, `sql.id` quote in examples but "input is not checked or escaped" [KYSELY-SQL].
  - Drizzle: `sql` binds `${}` and escapes table/column objects; `sql.raw()` neither escapes nor binds [DRIZZLE-SQL].
  - Drizzle/Kysely `like(col, v)` style helpers bind `v` but do not escape wildcards (UNVERIFIED) - always run `escLike`.
  - PostgREST/supabase: values sit inside a URL grammar; reserved `, . : * ( )` need double quotes, and `"`/`\` inside
    quotes need a backslash [PGRST-URL]. A raw user value inside `or=(...)` can add or alter conditions - DERIVED.
    Build `.or()`/`in` strings only through one quoting function; never concatenate.
- Regex: no `~`, `REGEXP`, `SIMILAR TO` from user input [PG-LIKE]; no JS `RegExp` built from user text. SQLite caps LIKE
  patterns at 50 000 bytes because matching can be O(N^2); "paranoid" apps lower it to a few hundred [SQLITE-LIMITS].
- Engine limits that bound the tree: SQLite `SQLITE_MAX_EXPR_DEPTH` 1000, `SQLITE_MAX_SQL_LENGTH` 1e9 bytes
  [SQLITE-LIMITS]; MSSQL nested subqueries 32, identifier 128 chars [MS-CAP].

Recommended validator bounds (applied before compiling):
| Item | Bound |
|---|---|
| filter leaves | <= 50 |
| tree depth | <= 2 groups (spec) |
| value length | <= 256 chars (text), <= 40 (number), ISO date grammar |
| isAnyOf/isNoneOf list | <= 1000 values |
| sorts | <= 8 keys (+ PK) |
| page size | <= 1000; offset <= 100 000 |
| quick-search terms / length | <= 8 / <= 128 |
| group-by keys / aggregates / pivot columns | <= 5 / <= 20 / <= 200 |

---

## 10. Canonical semantic decision table

Placeholders: `?` bound, `P` = escaped LIKE pattern, `[a,b]` list param. Case policy CI = case-insensitive intent.
Kinds: T text, N number, D date/timestamp, B boolean, E enum/choice (stored as text or int).

| Operator | Kinds | NULL rows | PG | SQLite | MySQL |
|---|---|---|---|---|---|
| contains | T | no | `col ILIKE P ESCAPE '!'` | `col LIKE P ESCAPE '!'` (ASCII CI) | `col LIKE P ESCAPE '!'` (collation CI) |
| notContains | T | yes | `(col NOT ILIKE P ESCAPE '!' OR col IS NULL)` | `NOT LIKE` + `OR IS NULL` | same as SQLite |
| startsWith / endsWith | T | no | `ILIKE 'v%'` / `'%v'` | `LIKE` | `LIKE` |
| equals | T | no | CI: `lower(col) = lower(?)` or ILIKE without wildcards; CS: `col = ?` | `col = ? COLLATE NOCASE` (ASCII) | `col = ?` (collation CI; trailing-pad rules) |
| equals | N, D(date), B, E | no | `col = ?` typed | same | same |
| equals | D(timestamp) | no | `col >= ? AND col < ?` (day bounds) | same, bounds in stored format | same |
| notEquals | all | yes | `(col <> ? OR col IS NULL)` / `col IS DISTINCT FROM ?` | `col IS NOT ?` | `NOT (col <=> ?)` |
| gt/gte/lt/lte | N, D, T | no | `col > ?` (D: day-bound rule; T: collation order) | same | same |
| isBetween | N, D | no | `col >= ? AND col <= ?` (D: `< next day`); open bound drops a side | same | same |
| isAnyOf | T, N, E, B | no (unless BLANK) | `col = ANY(?::type[])` | `col IN (?,...)` / `json_each` | `col IN (?,...)` |
| isAnyOf [] | | | `FALSE` | `0` | `FALSE` |
| isNoneOf | T, N, E, B | yes | `(col <> ALL(?::type[]) OR col IS NULL)` | `(col NOT IN (...) OR col IS NULL)` | same |
| isNoneOf [] | | | drop leaf (TRUE) | drop | drop |
| empty | T | yes | `(col IS NULL OR col = '')` | same | same |
| empty | N, D, B, E | yes | `col IS NULL` | same | same |
| notEmpty | T | no | `(col IS NOT NULL AND col <> '')` | same | same |
| notEmpty | N, D, B, E | no | `col IS NOT NULL` | same | same |

Operators not listed for a kind (e.g. contains on N, gt on B) are rejected by the validator, not coerced.
CI `equals` via `lower()` needs an expression index [PG-EXPRIDX]; via ILIKE it must escape wildcards.

### Where engines diverge (document, do not hide)
| Topic | PG | SQLite | MySQL | MSSQL |
|---|---|---|---|---|
| CI matching | locale ILIKE; `casefold` for Unicode | ASCII only without ICU | collation; `_ai_` also accent-insensitive | collation |
| default escape | `\` | none | `\` unless NO_BACKSLASH_ESCAPES | none; `[` also special |
| trailing spaces | significant | significant (BINARY) | LIKE significant; `=` per pad attribute | LIKE ignores trailing blanks in non-Unicode match expr |
| NULL sort ASC | last | first | first | first |
| NULLS LAST syntax | yes | >= 3.30 | emulate | emulate |
| `IN ()` | error | allowed | error | error |
| bad number literal vs int col | error | affinity conversion | silent float compare | conversion error |
| sum/avg types | bigint/numeric | int (overflow error)/float | DECIMAL/DOUBLE | avg(int) int (UNVERIFIED) |
| ROLLUP / GROUPING SETS | full | none (UNVERIFIED) | ROLLUP only (UNVERIFIED for others) | full |
| FILTER clause | yes | >= 3.30 | CASE WHEN | CASE WHEN |
| max bind params | 65535 (DERIVED) | 999 / 32766 | 65535 (UNVERIFIED) | 2100 |
| full-text raw input | `websearch_to_tsquery` safe | FTS5 quote every term | natural mode / strip ops | n/a here |
| date type | date/timestamp/timestamptz | none (TEXT/REAL/INT) | DATE/DATETIME/TIMESTAMP | date/datetime2/datetimeoffset; avoid datetime |

### Decide-once checklist for the compiler
1. Escape char `!`, explicit `ESCAPE`, per-dialect escape set (MSSQL adds `[`); PostgREST `*` policy.
2. Case policy intent per column; per-engine mapping and documented Unicode gaps.
3. Negative operators include NULL; `''` is blank for text only; never compare `''` with non-text.
4. Values parsed by column kind before SQL; NaN/Infinity rejected; decimals as strings; BigInt range checks.
5. Day = `[local midnight, next local midnight)` in a request `timeZone` (default UTC); half-open only.
6. Explicit null placement (nulls last), PK tie-breaker always.
7. Keyset via expanded OR form; cursor = text values + spec hash; offset capped.
8. Count mode: none / hasMore / capped / exact / estimate; same WHERE builder as the page.
9. Lists: strip NULL, BLANK sentinel, empty-list constants, cap length, one array param where possible.
10. Aggregates as decimal strings; NULL on empty except count; `GROUPING()` for subtotal rows; pivot aliases generated.
11. Identifiers from a registry only; operators/directions from closed enums; validator bounds before compile.

# Part 2: Drizzle and Kysely

Date: 2026-11-05. Goal: render a pure logical plan (sorts, filter tree, quick search, offset/cursor paging, count, aggregates, group-by, distinct values with counts) into each ORM's primitives with an allow-listed column map.

## D/K: Versions tested

| Package | Version | License | Runtime deps | Notes |
|---|---|---|---|---|
| drizzle-orm | 0.45.4 (npm `latest`, 2026-10-08) | Apache-2.0 | none | 29 peer deps, all optional; `type: module`, `sideEffects: false`, also loads with `require` |
| kysely | 0.29.8 (2026-11-01) | MIT | none | ESM only (`exports` has only `default`), `engines.node >=22.0.0`, `sideEffects: false` |
| @electric-sql/pglite | 0.5.15 (PostgreSQL 18.6 in WASM) | Apache-2.0 | none | no native build |
| better-sqlite3 | 13.0.3 (SQLite 3.53.4) | MIT | node-addon-api | ships `prebuilds/` for win32-x64/arm64, linux(-musl) x64/arm64, darwin x64/arm64 in the tarball: no compile on install |
| node:sqlite (Node 24.15.0) | SQLite 3.51.3 | built-in | - | ran without a flag on Node 24 |
| kysely-pglite-dialect | 1.4.0 | MIT | none | not needed: Kysely 0.29.8 ships `PGliteDialect` |


Sources (labels used below):
- [npm-dz] `npm view drizzle-orm` / local `node_modules/drizzle-orm/package.json`
- [npm-ky] `npm view kysely` / local `node_modules/kysely/package.json`
- [dz-ops] https://orm.drizzle.team/docs/operators
- [dz-sql] https://orm.drizzle.team/docs/sql
- [dz-select] https://orm.drizzle.team/docs/select
- [dz-goodies] https://orm.drizzle.team/docs/goodies
- [dz-cursor] https://orm.drizzle.team/docs/guides/cursor-based-pagination
- [dz-rel] https://github.com/drizzle-team/drizzle-orm/releases (and tag 0.32.1: https://github.com/drizzle-team/drizzle-orm/releases/tag/0.32.1)
- [dz-444] https://github.com/drizzle-team/drizzle-orm/issues/444 (open since 2023-04-13: "Add user input escaping function to like/ilike/notLike/notIlike")
- [dz-1699] https://github.com/drizzle-team/drizzle-orm/issues/1699 (open since 2023-12-25: NULLS FIRST/LAST for orderBy)
- [dz-5978] https://github.com/drizzle-team/drizzle-orm/issues/5978 (open: `.desc()` index is DESC NULLS LAST, `desc()` orderBy is bare DESC = NULLS FIRST in pg)
- [dz-1295] https://github.com/drizzle-team/drizzle-orm/issues/1295 (closed: allow empty values in inArray)
- [dz-2479] https://github.com/drizzle-team/drizzle-orm/issues/2479 (open: D1 "too many SQL variables")
- [ky-readme] https://github.com/kysely-org/kysely
- [ky-dialects] https://kysely.dev/docs/dialects
- [ky-expr] https://kysely.dev/docs/recipes/expressions
- [ky-rel] https://github.com/kysely-org/kysely/releases
- [ky-709] https://github.com/kysely-org/kysely/issues/709 ("IN" on empty array causes invalid SQL; closed 2025-01-04)
- [probe] local run, scripts above. Everything marked VERIFIED was executed.

---

## D/K: 1. Filter primitives

### Drizzle (`drizzle-orm` root exports, dialect-agnostic)
`eq, ne, gt, gte, lt, lte, like, notLike, ilike, notIlike, inArray, notInArray, isNull, isNotNull, between, notBetween, exists, notExists, and, or, not`, plus `sql` template [dz-ops]. The docs page states no dialect restriction for any operator ("We natively support all dialect specific filter and conditional operators") [dz-ops].
- `ilike`/`notIlike` compile on every dialect builder (VERIFIED: sqlite and mysql builders emit `ilike ?`). On SQLite it fails at run time: `near "ilike": syntax error` (VERIFIED, better-sqlite3). MySQL: no ILIKE operator either (runtime UNVERIFIED, no MySQL run). The adapter must choose per dialect: pg `ilike`; sqlite `like` (ASCII case-insensitive by default, VERIFIED: `like(name,'hello')` matched `Hello`) or `lower(col) like lower(?)`; mysql `like` under a case-insensitive collation (UNVERIFIED).
- No ESCAPE clause in `like`/`ilike`; the docs mention none [dz-ops]; escaping helper is an open request [dz-444]. Safe pattern: escape `\`, `%`, `_` in the value, keep the value a bound param, add the ESCAPE literal through the template (VERIFIED):
  - SQLite has no default escape char: `like '%50\%%'` without ESCAPE matched nothing; with `escape '\'` matched (VERIFIED).
  - PostgreSQL uses `\` as default LIKE escape: worked without ESCAPE (VERIFIED). Emit `escape '\'` anyway for uniformity.
  - MySQL: `\` is also a string-literal escape, so the ESCAPE literal must be written `'\\'` (compile VERIFIED in Kysely, runtime UNVERIFIED).
- Parameterization: every value interpolated in `sql\`\`` becomes a placeholder (`$1` pg, `?` sqlite/mysql) with values in a separate array; columns/tables become quoted identifiers [dz-sql]. `sql.raw()` inserts text unescaped [dz-sql]: never pass user input. `sql.identifier('we"ird')` quotes and doubles quotes: `"we""ird"` (VERIFIED).
- JS arrays interpolated into `sql\`\`` are expanded to a list `($1,$2,...)`, NOT one array param (VERIFIED: `= any(${arr})` with 70k items failed "ROW expressions can have at most 1664 entries"). Use `sql.param(arr)` to bind a single array: `"t"."id" = any($1)`, 1 param (VERIFIED on PGlite).
- Values pass through the column's `mapToDriverValue` when the left side is a column: `eq(pgTimestampModeDate, '2024-01-01')` THROWS `TypeError value.toISOString is not a function` (VERIFIED). The adapter must coerce spec strings to the column's JS type (Date for `mode:'date'`, boolean for sqlite `mode:'boolean'` which binds `1`, number for sqlite `mode:'timestamp'` which binds epoch seconds `1704067200`) or bypass mapping with `sql\`${col} > ${str}\``. Integer columns accept the string `'5'` (pg casts; `'abc'` throws `invalid input syntax for type integer`, VERIFIED) - validate numbers before the query.

### Kysely (`ExpressionBuilder` `eb`)
- Binary ops via `eb(lhs, op, rhs)` / `.where(ref, op, value)`; operator is a string checked against an internal allow-list: `where('name','or 1=1 --',1)` THROWS `invalid operator "or 1=1 --"` (VERIFIED). Ops used: `=, <>, >, >=, <, <=, like, not like, ilike, not ilike, in, not in, is, is not`. Helpers: `eb.and([...])`, `eb.or([...])`, `eb.not(x)`, `eb.between(ref, a, b)`, `eb.exists`, `eb.fn(name, args)`, `eb.val(v)`, `eb.ref(s)`, `eb.refTuple`, `eb.tuple` [ky-expr] (VERIFIED).
- `ilike` compiles for sqlite and mysql too (VERIFIED) and fails on SQLite at run time with `near "ilike": syntax error` (VERIFIED). Same per-dialect choice as Drizzle.
- No ESCAPE builder. Either `sql\`${eb.ref(col)} like ${pattern} escape '\\'\`` or put ESCAPE on the right operand: `eb(eb.ref(col), 'like', sql\`${pattern} escape '\\'\`)` -> `"name" like $1 escape '\'` (both VERIFIED). Pattern stays a param.
- Parameterization: all values bind as params; `eb.val([1,2])` binds an array as ONE param (`= any($1)` with `[[1,2]]`, VERIFIED, 70k-element array ran on PGlite). `sql.lit` inlines a literal; `sql.raw` inlines text unescaped: never for user input.

### Dialect differences that matter for the operator set (VERIFIED unless marked)
| Concern | PostgreSQL (PGlite) | SQLite | MySQL |
|---|---|---|---|
| case-insensitive contains | `ilike` | `like` (ASCII only) | `like` + ci collation (UNVERIFIED) |
| default LIKE escape | `\` | none, ESCAPE required | `\` (UNVERIFIED) |
| `true`/`false` literals | yes | yes (Drizzle emits `where false`, ran OK) | yes (compile only) |
| `in ()` empty list | syntax error | accepted, matches nothing | UNVERIFIED |
| `NULLS FIRST/LAST` | yes | yes (3.30+; ran on 3.53) | Kysely compiles it; MySQL support UNVERIFIED, emulate `ORDER BY (col IS NULL), col` |
| `FILTER (WHERE ...)` on aggregates | yes | yes (ran) | Kysely compiles it; runtime UNVERIFIED (use `sum(case when ... then 1 else 0 end)`) |
| row-value `(a,b) > (x,y)` | yes | yes (ran) | UNVERIFIED |
| default null order | ASC nulls last, DESC nulls first | nulls smallest: ASC first | UNVERIFIED |
| bound-param limit | 65535 (wire uint16) | 32766 (`SQLITE_MAX_VARIABLE_NUMBER` default; 40k params failed) | UNVERIFIED |

---

## D/K: 2. Resolving a column by string id

### Drizzle
- `getTableColumns(table)` returns a plain object (prototype `Object.prototype`) keyed by the JS property names (VERIFIED). `Object.hasOwn(cols, 'constructor') === false` (VERIFIED).
- Pitfall: `table[id]` reads the prototype chain. `P['constructor']` is a function and `P['__proto__']` an object (VERIFIED). Table metadata lives on symbols (`Symbol(drizzle:Name)`, `Symbol(drizzle:Columns)`, ...) so string keys cannot hit them, but prototype keys can. Safe lookup:
  ```ts
  const cols = getTableColumns(table);
  const col = Object.hasOwn(allow, id) && Object.hasOwn(cols, allow[id]) ? cols[allow[id]] : undefined;
  // or build a Map once: new Map(Object.entries(cols)) and only read ids from the allow-list
  ```
  Also guard with `is(col, Column)` (`is(P['constructor'], Column) === false`, VERIFIED) [dz-goodies recommends `is()` over `instanceof`].
- `getColumns` is what the current docs site shows [dz-goodies], but 0.45.4 does NOT export `getColumns` (VERIFIED: `'getColumns' in drizzle === false`, `getTableColumns` present). The docs site tracks the 1.0 line; pin the adapter to one API and feature-detect.
- Empty filter: `and()`, `or()`, `and(undefined)` all return `undefined`; `.where(undefined)` emits no WHERE (VERIFIED). Note the semantics: empty OR group becomes "no condition" = match all, not "match nothing". The adapter must decide: drop empty groups before rendering, or emit `sql\`false\`` for an empty OR if the spec means "no rows". `and(x)` with one arg emits `x` without parentheses (VERIFIED).

### Kysely
- `eb.ref('name')`, `sql.ref('t.name')` parse dots: `t.name` -> `"t"."name"`; up to `schema.table.column`; `a.b.c.d` THROWS `invalid column reference` (VERIFIED). Quotes are doubled: `sql.ref('we"ird')` -> `"we""ird"`, mysql `` `we``ird` `` (VERIFIED). `eb.ref('x; drop table t')` -> `"x; drop table t"` (quoted, safe, VERIFIED).
- Pitfall: string selections parse ` as `: `select('name as x')` -> `"name" as "x"`; `eb.ref('name as x')` is quoted as one identifier (VERIFIED). Use `sql.id(...parts)` for no-parse identifiers: `sql.id('t','na"me')` -> `"t"."na""me"` (VERIFIED). Column ids containing `.` must go through `sql.id`, not `ref`.
- Typed vs untyped: with `Kysely<DB>` the string refs are type-checked against `DB`; a runtime-string column map uses `Kysely<any>` or casts. Typing does not change the compiled SQL; the allow-list is the only runtime guard [ky-expr].
- Empty filter: `eb.and([])` -> `1 = 1`, `eb.or([])` -> `1 = 0` on pg, sqlite, mysql (VERIFIED, runtime counts 7 and 0 on SQLite and PGlite). Opposite of Drizzle's `undefined`: Kysely's empty OR matches nothing. `eb.and([single])` emits the bare expression (VERIFIED). `eb.and({ id: 1, name: 'x' })` object form also exists (VERIFIED).

---

## D/K: 3. Sorting

### Drizzle
- `orderBy(asc(c), desc(c2), ...)`; multiple args or array spread; docs show no NULLS FIRST/LAST [dz-select]; feature request open [dz-1699]. `asc()` result has no `.nullsLast` (VERIFIED). Use `sql\`${col} asc nulls last\`` (VERIFIED pg + sqlite). Beware [dz-5978]: bare `desc()` means NULLS FIRST on pg, which mismatches a default `.desc()` index.
- Dynamic list: map spec -> `(dir === 'asc' ? asc : desc)(cols[id])`, spread into `orderBy(...)`. `$dynamic()` lets you call `.where/.orderBy` on a builder held in a variable (VERIFIED compile).
- Order by aggregate works: `orderBy(desc(count()))` (VERIFIED).

### Kysely
- `orderBy('name','asc').orderBy('id','desc')` chains (VERIFIED). Modifiers: `orderBy('name', (ob) => ob.asc().nullsLast())` -> `"name" asc nulls last` on pg/sqlite/mysql compilers (VERIFIED; mysql runtime UNVERIFIED). `orderBy(sql.ref(id), 'desc')` works for dynamic ids (VERIFIED). `orderBy('name desc')` still compiles but logs a deprecation warning: "`orderBy('column asc')` is deprecated" (VERIFIED).

### NULLS LAST, verified SQL and rows (data: ids 1..7, id 3 name NULL, id 4 name '')
```
Drizzle sqlite: select "id" from "people" order by "people"."name" desc nulls last []
Drizzle pg:     select "id" from "people" order by "people"."name" asc nulls last, "people"."id" desc []
Kysely sqlite:  select "id" from "t" order by "name" desc nulls last []
Kysely pg:      select "id" from "t" order by "name" asc nulls last []
Runtime asc nulls last, both DBs, both ORMs: [4,2,1,7,6,5,3]   (NULL id 3 last)
SQLite plain asc: [3,4,2,...] (NULL first)   PG plain asc: [4,2,...,3] (NULL last)
```

---

## D/K: 4. Pagination and counting

- Offset: Drizzle `.limit(n).offset(m)` -> `limit $1 offset $2` (VERIFIED); docs: "order by is mandatory" for stable pages [dz-select]. Kysely `.limit().offset()` same (VERIFIED); `km.offset(50)` without limit compiles to `offset ?` for MySQL, which MySQL rejects (UNVERIFIED runtime): always emit a limit.
- Count:
  - Drizzle `count()` -> `count(*)` with `mapWith(Number)`; `countDistinct(col)`; `db.$count(table, where?)` wrapper usable in subqueries [dz-select]. Results are JS numbers on SQLite and PGlite (VERIFIED). Raw `sql\`count(*)\`` without mapWith returns the driver type.
  - Kysely `eb.fn.countAll()` / `eb.fn.count(col).distinct()`; type param `O extends number | string | bigint` (from `function-module.d.ts`): the value type is driver-dependent. PGlite returned number 7 (VERIFIED); node-postgres returns int8 as string (UNVERIFIED here). Normalize with `Number()` after range check.
  - Window count in the page query: `count(*) over()` works in both (VERIFIED: `[{"id":1,"total":7},...]`); no total when the page is empty.
- Relational query API (Drizzle `db.query.*`) requires a schema passed to `drizzle()`; without it `db.query` is `{}` (VERIFIED). Use the select builder for the adapter: it takes arbitrary `where/orderBy/limit` and aggregates.
- Cursor/keyset: Drizzle's guide builds `or(gt(a,x), and(eq(a,x), gt(id,y)))`, not row values, and needs a unique tiebreaker [dz-cursor]. Row values via template work on pg and sqlite (VERIFIED):
  ```
  Drizzle: where ("people"."name", "people"."id") > ($1, $2) order by ... limit $3  ["m",10,50]
  Kysely:  eb(eb.refTuple('n','id'), '>', eb.tuple(2,3)) -> ("n", "id") > ($1, $2)   (ran on SQLite: [7,1,6,4])
  ```
  Row values only work when every sort key has the same direction and no NULLs; mixed directions or nullable keys need the expanded OR/AND form with explicit `is null` branches.
- Consistency: both ORMs ran page + count inside one transaction (Drizzle `db.transaction(tx => ...)`, sync callback on better-sqlite3, async on PGlite; Kysely `db.transaction().execute(async tx => ...)`) (VERIFIED). Snapshot strength depends on isolation level (UNVERIFIED here: pg default READ COMMITTED gives each statement its own snapshot; use REPEATABLE READ or a single statement with `count(*) over()` for a consistent pair).

---

## D/K: 5. Aggregates and group-by

| | Drizzle | Kysely |
|---|---|---|
| count/countDistinct | `count()`, `countDistinct(c)` | `fn.countAll()`, `fn.count(c).distinct()` |
| sum/avg/min/max | `sum, avg, min, max, sumDistinct, avgDistinct` | `fn.sum/avg/min/max`, `.distinct()` |
| filter-where | `sql\`count(*) filter (where ${c} > 2)\`.mapWith(Number)` | `fn.countAll().filterWhere('n','>',2)` -> `count(*) filter(where "n" > $1)` |
| groupBy/having | `.groupBy(c).having(({ n }) => gt(n, 1))` | `.groupBy('n').having(eb => eb.fn.countAll(), '>', 1)` |
| rollup/grouping sets | `.groupBy(sql\`rollup(${a}, ${b})\`)` + `sql\`grouping(${a})\`` | `.groupBy(sql\`rollup(${sql.ref('n')})\`)` |
(all VERIFIED compile; filter-where, rollup + grouping() ran on PGlite; filter-where ran on SQLite)

Return types (VERIFIED):
```
Drizzle SQLite: {"c":7,"cd":6,"s":"17","a":"2.8333333333333335","mn":1,"mx":"4.00"}      sum/avg -> string
Drizzle PGlite: {"c":7,"cd":6,"s":"17","a":"2.8333333333333333","mxa":"10.00","sa":"20.85","sb":"28000000000000"}
                select numeric -> "1.50" (string); bigint mode:'number' -> 1000000000000 (number)
                sum(...).mapWith(Number) -> 17
Kysely SQLite:  {"c":7,"s":17,"a":2.8333333333333335,"cf":3}   raw driver types (numbers)
Kysely PGlite:  {"c":7,"s":17,"a":"2.8333333333333333","sa":"20.85","sb":"28000000000000","mx":"10.00","cf":3}
PGlite int8: count(*) -> number 7, but (2^60)::bigint -> 1152921504606846976n (bigint)  => mixed number/bigint per value
```
Drizzle docs: pg `count()` is bigint/string, convert with `cast` or `.mapWith(Number)`; sum/avg examples use `.mapWith(String)` [dz-select]. Rule for the adapter: treat sum/avg/numeric as decimal strings, never `Number()` blindly; normalize count via `Number` with a `Number.isSafeInteger` check.

Distinct values with counts (VERIFIED compile): `select "status", count(*) from "people" group by "people"."status" order by count(*) desc`.

---

## D/K: 6. Dry-run and test story

- Drizzle dry-run: `new QueryBuilder()` from `drizzle-orm/pg-core` | `sqlite-core` | `mysql-core` builds queries without a driver; `.toSQL()` -> `{ sql, params }` (VERIFIED). Raw fragments: `new PgDialect().sqlToQuery(sql\`...\`)` -> `{ sql, params, typings }` (VERIFIED; documented [dz-sql]). `new SQLiteSyncDialect().sqlToQuery(...)` for SQLite (VERIFIED).
- Kysely dry-run: `new Kysely({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new DummyDriver(), createIntrospector: db => new PostgresIntrospector(db), createQueryCompiler: () => new PostgresQueryCompiler() } })`, then `.compile()` -> `{ sql, parameters }` (VERIFIED for Postgres/Sqlite/Mysql adapters). Builders throw at build time for bad refs (`a.b.c.d`), not at `.compile()` (VERIFIED) - wrap the whole build in try.
- Real in-process DBs, zero native build on Windows (VERIFIED):
  - PGlite: `drizzle-orm/pglite` `drizzle(new PGlite())`; Kysely built-in `new PGliteDialect({ pglite })` (exported from `kysely` 0.29.8; also listed under core dialects [ky-dialects]). Pure WASM. Kysely `db.destroy()` closes the PGlite instance (from `pglite-dialect-config.d.ts`).
  - better-sqlite3 13.0.3: prebuilt N-API binaries inside the package, installed in 3 min on this network with no compiler. `drizzle-orm/better-sqlite3`; Kysely `new SqliteDialect({ database })`.
  - node:sqlite: Drizzle 0.45.4 has no node:sqlite driver (exports include better-sqlite3, libsql, d1, bun-sqlite, durable-sqlite, expo-sqlite, op-sqlite, sqlite-proxy; VERIFIED). Kysely `SqliteDialect` with `DatabaseSync` runs but SILENTLY RETURNS `[]` for selects (VERIFIED): the dialect checks `stmt.reader`, which `node:sqlite` statements lack, so it calls `run()`. Needs a wrapper or a community "Node SQLite" dialect [ky-dialects].

---

## D/K: 7. Schema -> column map

### Drizzle (VERIFIED on 0.45.4)
Per column: `name`, `dataType`, `columnType`, `notNull`, `primary`, `hasDefault`, `enumValues`, `getSQLType()`; `getTableConfig(t)` (pg-core) gives `columns, indexes, foreignKeys, checks, primaryKeys, name, schema` [dz-goodies]; `pg.isPgEnum(e)`; `getTableName(t)`.
```
serial pk          dataType number  columnType PgSerial          primary true notNull true hasDefault true
text notNull       string           PgText
pgEnum('mood')     string           PgEnumColumn   enumValues ["sad","ok","happy"]  sqlType "mood"
text {enum:[..]}   string           PgText         enumValues ["a","b"]   (TS-only enum, no DB type)
bigint mode number number           PgBigInt53
bigint mode bigint bigint           PgBigInt64
numeric(10,2)      string           PgNumeric      sqlType "numeric(10, 2)"
numeric mode number number          PgNumericNumber   | mode bigint -> bigint / PgNumericBigInt
timestamp tz date  date             PgTimestamp    sqlType "timestamp with time zone"
timestamp string   string           PgTimestampString
date (default)     string           PgDateString
boolean            boolean          PgBoolean
jsonb              json             PgJsonb
varchar(20)        string           PgVarchar
integer/double     number           PgInteger / PgDoublePrecision
sqlite integer boolean   boolean    SQLiteBoolean   (sqlType integer)
sqlite integer timestamp date       SQLiteTimestamp
sqlite text json         json       SQLiteTextJson
```
Mapping rule: `boolean` -> checkbox; `date` or columnType matching `/Timestamp|Date/` -> date; `number`/`bigint` -> number; `string` with `enumValues` -> select (real pg enum when `columnType === 'PgEnumColumn'`); `string` with columnType `PgNumeric` -> number but keep as string value; `json` -> text/readonly. Detecting pg enum vs TS enum: `columnType` (`PgEnumColumn` vs `PgText`).
Stability: [dz-goodies] documents `getColumns` (1.0 docs), `getTableConfig`, `is()`, type helpers; it does not document `dataType`/`columnType`/`enumValues`. Those are runtime fields of the column classes, typed in `.d.ts` but undocumented; the 1.0 line adds new numeric modes (dist-tag `numeric-modes`, `PgNumericNumber` already in 0.45.4). Treat `columnType` strings as unstable: switch on `dataType` first, use `columnType` only as a hint, cover with a snapshot test per Drizzle version. UNVERIFIED: whether 1.0 changes `dataType` values.

### Kysely (no runtime schema)
- Types only (`Kysely<DB>`), so the column map must come from elsewhere: hand-written map; generated types (kysely-codegen 0.20.0, MIT; credited in [ky-readme]) give TS types, not runtime metadata; or runtime `db.introspection.getTables()` which returns `ColumnMetadata { name, dataType, dataTypeSchema?, isAutoIncrementing, isNullable, hasDefaultValue, comment? }` (VERIFIED on PGlite: `id/int4/notnull, name/text/null, n/int4/null, amt/numeric/null, big/int8/null`). Introspection has no enum values; you would need a pg_enum query (UNVERIFIED). Recommendation: the Kysely adapter takes an explicit column map (id -> { ref, type, choices? }).
- kysely-codegen peer range `better-sqlite3 >=7.6.2 <13.0.0` conflicts with better-sqlite3 13.0.3 (npm metadata, VERIFIED).

---

## D/K: 8. Peer deps, runtimes, license

- drizzle-orm: Apache-2.0, zero deps, 29 optional peers (drivers) [npm-dz]. Stable line 0.45.x; 1.0.0-beta/rc published in parallel (beta.24 2026-04-30; RQB v2 changes appear in rc releases per [dz-rel]). Risk: docs site shows 1.0 APIs (`getColumns`) that 0.45 lacks; peer range for the adapter should be explicit (`>=0.45 <1` or a separate 1.x adapter). Edge: driver entry points for d1, durable-sqlite, neon/vercel/planetscale/xata/rds-data, sqlite-proxy (exports list); core has no Node built-ins (UNVERIFIED by bundling).
- kysely: MIT, zero deps, no peers, ESM only, `engines.node >=22` [npm-ky]. CJS consumers need `require(esm)` (UNVERIFIED for older Node). README: mainly Node, also Deno, Bun, Cloudflare Workers, browsers [ky-readme]. 0.28.x and 0.29.x both maintained (0.28.19 backports 0.29.8 fixes) [ky-rel]. TypeScript 7 type-performance work in 0.29.5 [ky-rel].
- PGlite 0.5.x Apache-2.0; kysely-pglite-dialect peers `@electric-sql/pglite ^0.2..^0.5` (would break on 0.6) - prefer Kysely's built-in dialect.
- better-sqlite3 13: `engines.node >=22`.

---

## D/K: 9. Gotchas for dynamic filter building

1. `ilike` compiles everywhere, fails on SQLite (both ORMs, VERIFIED). Pick the operator from the adapter's dialect, not from the builder.
2. Empty list: Drizzle `inArray(c, [])` -> `false`, `notInArray(c, [])` -> `true` on all three dialects since 0.32.1 ("Make inArray and notInArray accept empty list, closes #1295") [dz-rel, dz-1295] (VERIFIED). Kysely `in []` -> `in ()`: PG syntax error `syntax error at or near ")"`, SQLite accepts and returns no rows (VERIFIED) [ky-709]. Kysely ships `HandleEmptyInListsPlugin` (VERIFIED in 0.29.8):
   - `replaceWithNoncontingentExpression` -> `in` = `1 = 0`, `not in` = `1 = 1` (keeps NULL rows, VERIFIED).
   - `pushValueIntoList(sentinel)` is a factory (passing it uncalled crashes the compiler, VERIFIED) -> `in (null)`, `cast("name" as char) not in ('sentinel')`: drops NULL rows and casts to `char` (in pg, `char` = `char(1)`) - avoid. Better: the adapter short-circuits empty lists itself.
3. Empty groups: Drizzle `and()/or()` -> `undefined` (no filter); Kysely `and([])` -> `1 = 1`, `or([])` -> `1 = 0`. Normalize empty groups in the logical plan before rendering so both adapters agree.
4. `notEquals`/`notContains` with NULLs: `ne(c,'a')` -> `<> $1` excludes NULL rows (three-valued logic). If the spec wants NULLs included, emit `or(isNull(c), ne(c, v))`.
5. Parameter limits: pg 65535 params; 70000 `in` items failed with a misleading `bind message has 4464 parameter formats but 0 parameters` (70000 mod 65536) in BOTH ORMs (VERIFIED); 65535 ran. SQLite: 40000 -> `too many SQL variables`; Drizzle with 250000 items -> `Maximum call stack size exceeded` while building (VERIFIED). D1 has a much lower limit [dz-2479]. Bound `isAnyOf` list length in the spec, or on pg bind one array param (`sql.param(arr)` / `eb.val(arr)` with `= any(...)`).
6. Drizzle `sql` template expands arrays into lists (see 1); `sql.param` binds one value.
7. Drizzle column value mapping throws on wrong JS types (`toISOString` on a string); coerce per `dataType`.
8. `not` precedence: both emit `not "ts" is null` (VERIFIED), which pg/sqlite parse as `not ("ts" is null)`; fine, but wrap custom `sql` fragments in parentheses before `not`.
9. Kysely string refs parse dots and ` as `; use `sql.id` for raw ids. Drizzle string lookup must use own-property checks.
10. Aggregates come back as strings (numeric/sum/avg) or mixed number/bigint (PGlite int8). Normalize in the adapter.
11. Kysely `node:sqlite` via `SqliteDialect` silently returns `[]`.
12. `like` without ESCAPE on SQLite treats `\` literally, so escaped wildcards silently match nothing (VERIFIED).

---

## D/K: Verified snippets (compiled SQL + params, from [probe])

Contains with escaped wildcard (`esc = s => s.replace(/[\\%_]/g, c => '\\' + c)`):
```
Drizzle sqlite: sql`${S.name} like ${'%' + esc('50%_off') + '%'} escape '\\'`
  -> select "id" from "people" where "people"."name" like ? escape '\' ["%50\\%\\_off%"]
Drizzle pg ilike: -> where "people"."name" ilike $1 escape '\' ["%a\\_b%"]      (ran: matched only 'a_b', not 'aXb')
Kysely sqlite: -> select "id" from "t" where "name" like ? escape '\' ["%50\\%%"]   (ran: [1])
Kysely pg (escape on rhs): eb(eb.ref(col),'like',sql`${p} escape '\\'`) -> "name" like $1 escape '\'
```
Case-insensitive equality:
```
Drizzle pg:     eq(sql`lower(${P.name})`, v.toLowerCase()) -> where lower("people"."name") = $1 ["abc"]
Drizzle sqlite: sql`${S.name} = ${v} collate nocase`       -> where "people"."name" = ? collate nocase ["ABC"]
Kysely pg:      eb(eb.fn('lower',[eb.ref(col)]),'=','abc')  -> where lower("name") = $1 ["abc"]
```
(`lower(col) = lower(?)` is the portable form; index use needs an expression index.)

isAnyOf with empty array:
```
Drizzle pg/sqlite/mysql: inArray(c, [])    -> where false []     notInArray(c, []) -> where true []
Kysely pg:               where(c,'in',[])  -> where "name" in () []   (PG: syntax error; SQLite: [] rows)
Kysely + HandleEmptyInListsPlugin(replaceWithNoncontingentExpression): in -> 1 = 0, not in -> 1 = 1
```
empty (null or ''):
```
Drizzle: or(isNull(c), eq(c,'')) -> ("people"."name" is null or "people"."name" = $1) [""]   (ran: ids 3,4)
         notEmpty: and(isNotNull(c), ne(c,'')) -> ("people"."name" is not null and "people"."name" <> $1) [""]
Kysely:  eb.or([eb(c,'is',null), eb(c,'=','')]) -> ("name" is null or "name" = $1) [""]
```
isBetween (inclusive) with open bound:
```
Drizzle: between(P.i,1,5) -> "people"."i" between $1 and $2 [1,5];  open lower only: and(gte(P.i,1), undefined) -> "people"."i" >= $1 [1]
Kysely:  eb.between('n',1,5) -> "n" between $1 and $2 [1,5];          open: eb.and([eb('n','>=',1)]) -> "n" >= $1 [1]
```
(`between` with `a > b` returns no rows per standard SQL, UNVERIFIED here; normalize bounds or reject in the spec.)

Nested and/or:
```
Drizzle: or(and(eq(name,'a'), gt(i,2)), and(eq(name,'b'), not(isNull(ts))))
  -> where (("people"."name" = $1 and "people"."i" > $2) or ("people"."name" = $3 and not "people"."ts" is null)) ["a",2,"b"]
Kysely: eb.or([eb.and([...]), eb.and([...])])
  -> where (("name" = $1 and "n" > $2) or ("name" = $3 and not "ts" is null)) ["a",2,"b"]
```
Quick search across columns (pg, ran):
```
or(ilike(P.name,'%hel%'), sql`${P.amt}::text ilike ${'%hel%'}`)  -> ids [7]
```
Order by with NULLS LAST: see section 3.

# Part 3: Prisma and Supabase (PostgREST)

Date: 2026-11-05. Purpose: facts for compiling a typed UI query spec (sorts, AND/OR filter tree depth <= 2, 15 leaf operators, quick search, offset/cursor paging, total count, aggregates/group-by, distinct values with counts) into Prisma and Supabase (postgrest-js) queries through adapters that receive a logical plan plus an allow-listed column map.

Status tags: **VERIFIED** = observed by running code (probe scripts listed at the end). **SOURCE** = read in the library's source code. **DOCS** = official docs or release notes. **UNVERIFIED** = not confirmed by either.

## 0. Versions (npm metadata, 2026-11-05)

| Package | Version used | Notes |
|---|---|---|
| `prisma`, `@prisma/client` | **7.10.1** (2026-10-19) | Stable. **Gotcha: the npm `latest` dist-tag points at `8.0.0-rc.30`** (`prev` = 7.10.1). A bare `npm i prisma` installs the 8 RC. GitHub marks all v8 releases as prerelease. [npm dist-tags `npm view prisma dist-tags`; GH releases https://github.com/prisma/orm/releases] |
| `@prisma/adapter-better-sqlite3`, `@prisma/adapter-pg` | 7.10.1 | Driver adapters are required in v7. |
| `@supabase/supabase-js`, `@supabase/postgrest-js` | **2.119.0** | Same version line. The npm package ships `src/*.ts`. [npm https://www.npmjs.com/package/@supabase/postgrest-js] |
| PostgREST | **v16.5** (2026-10-18) | Latest release. Hosted Supabase projects run their own pinned PostgREST version, which can be older. Check per project. [GH https://github.com/PostgREST/postgrest/releases] |

Prisma repo was renamed `prisma/prisma` -> `prisma/orm` (GitHub API resolves `prisma/prisma` to `prisma/orm`).

---

## A: PRISMA 7.10.1

### A1. Prisma 7 platform changes that matter for an adapter

- **Driver adapter or Accelerate URL is required.** `new PrismaClient()`, `{}`, `datasources`, and `datasourceUrl` were removed. Example: `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`. [DOCS PR-7.0.0 https://github.com/prisma/orm/releases/tag/7.0.0]
- **The `prisma-client` generator (Rust-free, ESM) is the default.** `output` is **required**, and the client is imported from the generated path, not from `@prisma/client`. `prisma-client-js` with `output` needs `@prisma/client-runtime-utils`. [DOCS PR-7.0.0]
- `prisma.config.ts` holds `datasource.url`. The schema `datasource` block has no `url`. VERIFIED: the probe used `defineConfig({ schema, datasource: { url } })`.
- **MongoDB is not supported in Prisma 7** ("please stay on Prisma v6"). So the `mode: 'insensitive'` support for MongoDB applies to v6 only. [DOCS PR-7.0.0]
- `prisma generate` hung in this sandbox until `CHECKPOINT_DISABLE=1` was set (the update check needs network). VERIFIED (local environment quirk).
- **Prisma 8 (RC)** is a different architecture: contracts, `prisma contract emit`, and a callback query builder such as `.where((p) => p.name.ilike(...))` and `.orderBy((p) => p.content.desc({ nulls: "last" }))`. Its docs say that cursor pagination with a `nulls` placement throws `ORM.ARGUMENT_INVALID`. **prisma.io/docs (unversioned) shows v8 content. v7 docs live under `/docs/orm/v7/`.** An adapter that targets v7 object-`where` will need a separate v8 adapter. [DOCS PR-8rc https://github.com/prisma/orm/releases/tag/v8.0.0-rc.22; PR-filt8 https://www.prisma.io/docs/orm/prisma-client/queries/filtering-and-sorting]

### A2. Where-filter operators (v7 object API)

String fields: `equals, not, in, notIn, lt, lte, gt, gte, contains, startsWith, endsWith, mode` (+ `search` with the full-text preview flag). Number, Decimal, BigInt and DateTime fields: `equals, not, in, notIn, lt, lte, gt, gte`. Logical: `AND, OR, NOT` (object or array). [DOCS PR-ref https://www.prisma.io/docs/orm/reference/prisma-client-reference]

Generated SQL (VERIFIED from the `query` log event, Postgres via adapter-pg on PGlite, and SQLite via better-sqlite3):

| Prisma input | PostgreSQL SQL | SQLite SQL |
|---|---|---|
| `contains: v` | `"name"::text LIKE ('%' \|\| $1 \|\| '%')` | `` `name` LIKE ('%' \|\| ? \|\| '%') `` |
| `contains: v, mode:'insensitive'` | `"name" ILIKE ('%' \|\| $1 \|\| '%')` | **ValidationError** `Unknown argument mode` |
| `startsWith` / `endsWith` | `LIKE ($1 \|\| '%')` / `LIKE ('%' \|\| $1)` | same |
| `equals: v` | `"name" = $1` | `= ?` |
| `equals: v, mode:'insensitive'` | **`"name" ILIKE $1`** (pattern, not equality) | n/a |
| `in: [v], mode:'insensitive'` | `LOWER("name") IN (LOWER($1))` | n/a |
| `not: v, mode:'insensitive'` | `"name" NOT ILIKE $1` | n/a |
| `gt: v, mode:'insensitive'` | `LOWER("name") > LOWER($1)` | n/a |
| `not: v` | `"name" <> $1` | `<> ?` |
| `not: { contains: v }` | `NOT LIKE (...)` | same |
| `NOT: { name: { contains: v } }` | `(NOT "name" LIKE (...))` | same |
| `notIn: [a]` | `NOT IN ($1)` | same |
| `name: null` / `not: null` | `IS NULL` / `IS NOT NULL` | same |
| `gte: a, lte: b` (one object) | `("age" >= $1 AND "age" <= $2)` | same |

### A2.1 LIKE wildcards are NOT escaped (VERIFIED, both providers)
- PG: `contains: '%_'` matched every non-empty name. `contains: '50%'` matched `50%_off` **and** `50Xoff`. `contains: 'a\\'` (a value that ends in a backslash) matched **nothing**, because the param `%a\%` makes `\%` an escaped literal `%` (PG's default LIKE escape is `\`). [PROBE-PR-PG]
- Open issue confirms the behavior: `equals`/`contains`/`startsWith`/`endsWith` "use LIKE in SQL under the hood and ... the characters are not escaped" (#19506, open since 2023). [GH https://github.com/prisma/orm/issues/19506]
- **Fix on PG (VERIFIED):** escape the value first: `v.replaceAll('\\','\\\\').replace(/[%_]/g, '\\$&')`. Results: `contains: esc('50%_')` -> only `50%_off`. `contains: esc('a\\')` -> `a\b`. `equals: esc('a_ice'), mode:'insensitive'` -> only `A_ICE` (unescaped, it also matched `Alice`/`alice`/`ALICE`). **Do NOT escape for plain `equals` (no mode)**: that is `=`, and the escaped value then matched nothing. VERIFIED.
- **SQLite:** Prisma emits no `ESCAPE` clause. SQLite LIKE then has no escape character, so a backslash is literal (VERIFIED: `startsWith: 'a\\'` matched `a\b`). As a result, `%`/`_` in user input **cannot be neutralized** through `contains` on SQLite. Options: `$queryRaw ... LIKE ? ESCAPE '\'` (VERIFIED working: `LIKE ${'50\\%%'} ESCAPE '\\'` -> only id 5), or post-filtering. MySQL: default escape `\` (UNVERIFIED in Prisma).
- SQLite `LIKE` is case-insensitive for ASCII: `contains:'ali'` matched `Alice` and `alice`, while `equals:'alice'` matched only `alice`. VERIFIED. So on SQLite, contains/startsWith/endsWith are effectively insensitive and equals is sensitive.

### A2.2 Case-insensitive support per provider
- `mode` is "Supported by the PostgreSQL and MongoDB connectors only". [DOCS PR-ref] VERIFIED: the SQLite client types have no `mode`, and at runtime it gives `PrismaClientValidationError: Unknown argument 'mode'`. The PG client generates `QueryMode = { default, insensitive }`.
- MySQL/SQL Server: case sensitivity follows the column collation (usually `_ci`). There is no `mode`. UNVERIFIED locally.
- **Case-insensitive equality gap:** on PG, `equals + insensitive` = `ILIKE $1`. That is wildcard-sensitive (escape the value, see above) and cannot use a btree index on the column. `in + insensitive` uses `LOWER() IN (LOWER())` (an exact match, no wildcard issue). Alternative for exact CI equality: `in: [v], mode: 'insensitive'`. VERIFIED. This is a neat trick: a single-element `in` gives a wildcard-free CI equals.
- No accent-insensitive mode (open issue #6428). [GH https://github.com/prisma/orm/issues/6428]

### A2.3 NULL vs empty string (VERIFIED, SQLite and PG)
Data: names `Alice, alice, NULL, '', 50%_off, 50Xoff, a\b`.
- `not: 'Alice'` -> excludes the NULL row (`<>` is three-valued). Docs warn the same. [DOCS PR-ref: "`NULL` values are not returned ... use an OR with `{ name: null }`"]
- `not: ''` -> excludes the NULL row **and** `''`. "notEmpty" written as `not: ''` happens to be correct because NULL is excluded too.
- `notIn: [...]` and `NOT: { contains }` and `not: { contains }` -> exclude NULL rows.
- `name: null` -> `IS NULL` only (not `''`). "empty" = `OR: [{ name: null }, { name: '' }]` -> ids 3, 4.
- **`equals: undefined` -> `WHERE 1=1` (the filter is silently dropped, so ALL rows return).** An adapter must never pass `undefined` for a leaf value. It must reject the leaf or skip it explicitly.

### A2.4 Logical operators and empty arrays (VERIFIED, SQLite SQL shown)
| Input | SQL | Rows |
|---|---|---|
| `in: []` | `1=0` | none |
| `notIn: []` | `1=1` | all |
| `AND: []` | `1=1` | all |
| `OR: []` | `1=0` | **none** |
| `NOT: []` | `1=1` | all |
| `NOT: [A, B]` | `(NOT A) AND (NOT B)` | "none of" |
- Docs: AND "All conditions must return true", OR "One or more", NOT "All conditions must return false". [DOCS PR-ref]
- Consequence: an empty OR group in the UI must be **dropped by the adapter**, or it will empty the grid.
- Nesting `AND/OR/NOT` to any depth is accepted. A depth-2 tree maps 1:1: `{ AND: [ leaf, { OR: [leaf, leaf] } ] }`.

### A2.5 Value types: strings must be coerced (VERIFIED)
- `age: { gt: '5' }` (a string for an Int field) -> `PrismaClientValidationError: Expected Int or IntFieldRefInput, provided String`. The spec's `value: string` must be parsed per field type: Int/Float -> number, BigInt -> `bigint`, Decimal -> `string` or `Prisma.Decimal` (a Decimal accepts a string, VERIFIED on create), DateTime -> `Date` or an ISO string, Boolean -> boolean. Invalid input (`'abc'`) must be rejected by the adapter before the call. Otherwise Prisma throws a validation error that reveals the schema (field names and "Did you mean").

### A2.6 Resolving fields by string key (VERIFIED)
- An unknown key -> `ValidationError: Unknown argument 'nope'. Did you mean 'name'?` (this leaks field names into errors).
- `constructor` key -> rejected (Unknown argument).
- **`JSON.parse('{"__proto__":{...}}')` as `where` -> silently ignored -> `WHERE 1=1` (all rows).** A hostile key does not throw. It removes the filter.
- Recommendation: resolve `columnId -> Prisma field` only through the allow-listed column map (a `Map` or a null-prototype object with an `Object.hasOwn` check). Build `where` objects with literal or computed keys only from map values. Never spread user objects into `where`.

### A3. Ordering
- `orderBy: [{ age: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }]` -> PG `ORDER BY "age" DESC NULLS FIRST, "id" ASC`. SQLite emulates it with `CASE WHEN age IS NULL THEN ...`. VERIFIED on both, with no preview flag in 7.10.1.
- `nulls` is "For use on optional scalar fields only". A required field -> error (docs: P2009. In 7.10.1 the observed error was a `ValidationError: Expected SortOrder, provided Object`). The adapter must emit `nulls` only for nullable fields, which needs field metadata (A7). [DOCS PR-ref; VERIFIED]
- Multi-sort: an array of single-key objects (order is preserved). Add a unique tie-breaker (`id`) for stable paging. VERIFIED.

### A4. Paging and count
- Offset: `skip`, `take`. "becomes more expensive as the offset grows". [DOCS PR-page https://www.prisma.io/docs/orm/v7/prisma-client/queries/pagination]
- Cursor: `cursor: { id }, skip: 1, take: n` with the same `orderBy`. `cursor` must be a **unique** input (`WhereUniqueInput`). A non-unique field -> ValidationError. VERIFIED.
- With a composite orderBy (`city asc, id asc`, cursor id 4), Prisma generates a correct row-comparison via subselects: `city = (SELECT city ... WHERE id=$1) AND id >= (SELECT id ...)` etc. Results were correct. With a nullable sort key and `nulls:'last'`, the results were also correct in 7.10.1. VERIFIED [PROBE-PR-PG]. The subselects re-read the cursor row: if that row was deleted, the page is empty (UNVERIFIED).
- A negative `take` pages backwards. [DOCS PR-ref]
- Count with the same where: `prisma.person.count({ where })`. Page and count in one round trip: `prisma.$transaction([findMany(args), count({ where })])` -> `[rows, total]` (batch transaction, VERIFIED).
- `count({ select: { _all: true, name: true } })` -> `{ _all: 7, name: 6 }` (non-null count per field). VERIFIED.
- **IN list size:** `id: { in: 40_000 ids }` on adapter-pg -> `P2029 The query parameter limit supported by your database is exceeded`. VERIFIED. Chunk the list, or use `$queryRaw ... = ANY(${array})` (one array param, PG only; UNVERIFIED).

### A5. Aggregates, groupBy, distinct
- `aggregate({ _sum, _avg, _min, _max, _count })`. VERIFIED return types: `_sum.age` number. `_sum.score` (Decimal) -> `Decimal`. `_sum.big` (BigInt) -> `bigint`. `_avg.age` -> number (float, `34.1666...`). `_avg.score` -> `Decimal`. `_count._all` -> number. "Aggregations on nullable fields can return a number or null". `_count` returns 0. [DOCS PR-agg https://www.prisma.io/docs/orm/v7/prisma-client/queries/aggregation-grouping-summarizing]
- `groupBy({ by: ['city'], _count: { _all: true }, _sum: { score: true }, having: { age: { _avg: { gt: 1 } } }, orderBy: [{ _count: { city: 'desc' } }, { city: 'asc' }] })` -> `GROUP BY city HAVING AVG(age) > ? ORDER BY COUNT(city) DESC, city`. VERIFIED.
  - "Within having, you can only filter on aggregate values or fields available in by". "You cannot use select with groupBy()". [DOCS PR-agg]
  - `skip`/`take` require `orderBy`. Without it: `P2019 Input error` (VERIFIED). [DOCS PR-agg]
  - NULL is its own group (`{ name: null, _count: 1 }`). `''` is a separate group. VERIFIED.
  - Order by `_count: { _all }` is not offered in the types. Use `_count: { <byField>: 'desc' }`.
- **Distinct values with counts** = `groupBy({ by: [col], where, _count: { _all: true }, orderBy: [{ _count: { [col]: 'desc' } }, { [col]: 'asc' }], take })`. Caveat: `_count.col` counts non-null values only, so the NULL group reports `_count.col = 0` when ordered by it. Read `_count._all` for display. UNVERIFIED for NULL-group ordering.
- `findMany({ distinct: ['city'] })`: "does not use SQL SELECT DISTINCT". It dedups in memory (VERIFIED: the SQL selected `id, city` for all rows and did no `DISTINCT`). This does not scale for value lists. Use `groupBy`. Distinct is case-sensitive (`Oslo` and `oslo` are separate groups). [DOCS PR-agg; VERIFIED]
- Return types for serialization: `Decimal` is decimal.js (`Prisma.Decimal.isDecimal(x)` true, constructor name `Decimal2` in 7.10.1). `bigint` breaks `JSON.stringify` (TypeError). Convert both in the adapter (to string) before the result crosses a JSON boundary. VERIFIED.

### A6. Raw SQL path
- `$queryRaw\`...${v}...\`` and `Prisma.sql`: "Template variables can only be used for data values". Variables become bound parameters. `Prisma.join(list)` for `IN (...)`. `Prisma.empty` for an optional fragment. `Prisma.raw(str)` = **unescaped** ("a common source of injection"). `$queryRawUnsafe(sql, ...params)` binds params, but its SQL string is raw. Identifiers (table, column, `ASC/DESC`) can't be parameters. [DOCS PR-raw https://www.prisma.io/docs/orm/v7/prisma-client/using-raw-sql/raw-queries]
  - VERIFIED: `SELECT ${Prisma.raw('"city"')} AS value, COUNT(*) AS n FROM "Person" WHERE "name" LIKE ${'%li%'} OR "id" IN (${Prisma.join([1,2])}) GROUP BY 1 ORDER BY 2 DESC` -> SQL `... LIKE ? OR "id" IN (?,?)` with params `["%li%",1,2]`.
  - Identifier rule for the adapter: `Prisma.raw` only on a quoted identifier taken from the allow-listed column map (`"` + name.replaceAll('"','""') + `"` for PG, backticks for MySQL). Direction only from the enum `ASC|DESC`.
  - LIKE patterns: put `%` in the value (`${'%' + esc(v) + '%'}`), not in the SQL. "Using `%$2` as an argument would not work". [DOCS PR-raw]
  - Raw `COUNT(*)` returns **bigint** on both PG and SQLite (`"6n"`). VERIFIED. Raw results aren't normalized across DBs (MySQL booleans are 1/0). A generic type such as `$queryRaw<T[]>` is not validated at runtime. [DOCS PR-raw]
- TypedSQL: preview `previewFeatures = ["typedSql"]`, `.sql` files in `prisma/sql`, `prisma generate --sql` (needs a live DB), `prisma.$queryRawTyped(fn(args))`. "does not natively support ... dynamically added columns". It is not useful for a generic grid adapter, except for fixed per-table RPC-like queries. [DOCS PR-typed https://www.prisma.io/docs/orm/v7/prisma-client/using-raw-sql/typedsql]

### A7. Runtime metadata for building a column map
- `prisma-client` generator (v7): **`Prisma.dmmf` does not exist** (VERIFIED `'dmmf' in Prisma === false`). Available exports: `Prisma.ModelName` (`{ Person: 'Person' }`) and `Prisma.PersonScalarFieldEnum` (field-name map), both VERIFIED. Also an internal `config.runtimeDataModel` in `generated/.../internal/class.ts` with `{ name, kind, type }` per field only: no `isRequired`, `isList`, `isId`, `isUnique`. It is internal and unstable. [SOURCE generated client; GH issue #27028 "`Prisma.dmmf` has been removed" https://github.com/prisma/orm/issues/27028; #28348 "DMMF simplified when using engineType = client ... missing isRequired, isList, isId, isUnique" https://github.com/prisma/orm/issues/28348]
- Implication: the adapter **cannot discover nullability at runtime** (needed for `nulls:` and for "empty" on non-nullable columns). Options: (a) the user declares column types and nullability in the column map (recommended, explicit); (b) a codegen step with `@prisma/internals` `getDMMF({ datamodel })` at build time (an internal package, not a public API, UNVERIFIED stability); (c) a custom generator. `PersonScalarFieldEnum` is a good allow-list source for *names*.

### A8. Testing without a live database
1. **Pure unit tests:** the adapter output (`where`, `orderBy`, `skip`/`take`/`cursor`, `groupBy` args) is a plain object. Assert it with deep equality. No client is needed.
2. **SQLite file DB:** `@prisma/adapter-better-sqlite3` + `prisma db push`. It ran in about 1 s here. Gives semantics for empty arrays, NULL, and paging. Caveats: no `mode`, ASCII-insensitive LIKE, no LIKE escaping (A2.1). VERIFIED.
3. **Real Postgres semantics in-process: PGlite + `@electric-sql/pglite-socket` + `@prisma/adapter-pg`.** Start `new PGLiteSocketServer({ db, port, host:'127.0.0.1' })` and connect adapter-pg with `max: 1`. This VERIFIED ILIKE, `NULLS FIRST`, cursor subselects, and the P2029 param limit. The test needs no Docker. Create the table with `db.exec(DDL)` (or `prisma db push` against the socket).
4. The `log: [{ emit: 'event', level: 'query' }]` + `$on('query')` hook gives the SQL and params for snapshot assertions. VERIFIED with driver adapters.

---

## B: SUPABASE / PostgREST (postgrest-js 2.119.0, PostgREST v16.5)

### B1. Operators (PostgREST)
`eq =, gt, gte, lt, lte, neq <>, like, ilike, match ~, imatch ~*, in (= ANY), is (null|not_null|true|false|unknown), isdistinct (IS DISTINCT FROM), fts/plfts/phfts/wfts @@ (to_tsquery/plainto/phraseto/websearch_to_tsquery), cs @>, cd <@, ov &&, sl, sr, nxr, nxl, adj, not, or, and, all/any modifiers` (e.g. `like(any).{O*,P*}`). [DOCS PGRST-ops https://docs.postgrest.org/en/stable/references/api/tables_views.html]
- `isdistinct` since PostgREST v11.0.0. Aggregates since v12.0.0. [DOCS PGRST-CL https://github.com/PostgREST/postgrest/blob/v16.5/CHANGELOG.md]
- A non-tsvector column given to `fts` is auto-converted with `to_tsvector()` (index the expression). [DOCS PGRST-ops]
- Casting inside horizontal filters is "not allowed" (use computed columns). So `ilike` cannot be applied to an int column via a cast. Quick search works on text columns or computed text columns only. [DOCS PGRST-ops]

### B2. How PostgREST parses values (SOURCE: QueryParams.hs / SqlFragment.hs v16.5)
[SOURCE https://github.com/PostgREST/postgrest/blob/v16.5/src/library/PostgREST/ApiRequest/QueryParams.hs, https://github.com/PostgREST/postgrest/blob/v16.5/src/library/PostgREST/Query/SqlFragment.hs]
- **Top-level filter value** (`?col=op.VALUE`): `pSingleVal = many anyChar`. The entire rest of the param is the value. No quoting is needed **and none is stripped**. `?name=eq."x"` matches the literal `"x"` including the quotes. `,` `(` `)` are fine here.
- **Inside `in.(...)`**: `pListElement = try (pQuotedValue <* notFollowedBy (noneOf ",)")) <|> many (noneOf ",)")`. Unquoted elements end at `,` or `)`. Quoted: `"..."` with `\x` escaping any char (`pCharsOrSlashed = noneOf "\\\"" <|> (char '\\' *> anyChar)`).
- **Inside `or=(...)` / `and=(...)` logic trees**: `pLogicSingleVal` = a quoted value (same `\` escaping), or `{...}` a PG array literal, or `many (noneOf ",)")`. Trees nest recursively (`pLogicTree ... sepBy1`). There is **no depth limit in the grammar**. `not.` prefixes a filter or a group: `not.and(...)`.
- Docs: reserved chars `, . : * ( )` -> wrap in double quotes. In `in`, escape `"` as `\"` and `\` as `\\`. [DOCS PGRST-grammar https://docs.postgrest.org/en/stable/references/api/url_grammar.html]
- **All values are bound as parameters** (`unknownLiteral` -> `unknownEncoder`). This removes SQL injection. Only **PostgREST grammar injection** remains (in `or`/`and`/`in`).
- **`like`/`ilike`: every `*` is mapped to `%`** (`T.map star val`, star `'*' -> '%'`), including in quoted values. So **a literal `*` can never be matched with like/ilike**. `%` and `_` stay wildcards, and `\` is PG's LIKE escape. To match user text exactly: escape `\ % _` with `\`. For a literal `*`, use `imatch` with a regex-escaped pattern (`~*`, is not rewritten), or an RPC. UNVERIFIED against a live server (derived from source).
- `in` -> `= ANY('{...}')`. **`in.()` parses to `[""]` and is special-cased to `= ANY('{}')` -> matches nothing** (an empty list is safe and returns no rows). [SOURCE SqlFragment.hs `In vals -> case vals of [""] -> "= ANY('{}') "`]. Side effect: `in.("")` (a list with only the empty string) also becomes "matches nothing", not "= ''" (derived from the same code, UNVERIFIED).
- `not.op` -> `NOT col op val`. **NULL rows are excluded** for `not.eq`, `not.ilike`, `not.in`, and `neq` (3-valued logic). Null-safe forms: `isdistinct.v` (= NULL-inclusive notEquals) or `or=(col.neq.v,col.is.null)`. [SOURCE pgFmtFilter]
- `is` accepts only `null|not_null|true|false|unknown` (case-insensitive). [SOURCE pIsVal]
- Type coercion: the value is an unknown-typed literal cast by PG. `age=gt.abc` on an int -> PG error 22P02 -> HTTP **400** (the error table maps "other" SQLSTATEs to 400). A parse error in the query string = `PGRST100` 400. UNVERIFIED end-to-end (no server). [DOCS PGRST-err https://docs.postgrest.org/en/stable/references/errors.html]

### B3. What postgrest-js does (and does not) escape (SOURCE + VERIFIED by capturing fetch)
[SOURCE npm @supabase/postgrest-js@2.119.0 `src/PostgrestFilterBuilder.ts`, `src/PostgrestTransformBuilder.ts`, `src/PostgrestQueryBuilder.ts`]
- Simple filters: `this.url.searchParams.append(column, \`${op}.${value}\`)`. No escaping, but none is needed at the top level (B2). URL encoding by `URLSearchParams`: `&`->`%26`, `+`->`%2B`, space->`+`. VERIFIED: `eq('ts','2024-01-01T00:00:00+02:00')` -> `ts=eq.2024-01-01T00%3A00%3A00%2B02%3A00`.
- **`.in()` / `.notIn()`**: dedups the values (`new Set`). It wraps a value in `"..."` **only if it matches `/[,()]/`**, and **does not escape `"` or `\`**. VERIFIED:
  - `in('name', ['a','b,c','d(e)','q"x','b\\s','null','a.b','k:v','st*r'])` -> `in.(a,"b,c","d(e)",q"x,b\s,null,a.b,k:v,st*r)`
  - `in('name', ['c"d,e'])` -> `in.("c"d,e")`. PostgREST's parser then reads two elements `"c"d` and `e"`, so **the wrong values are matched silently** (derived from B2 grammar).
  - Safe alternative (VERIFIED URL): quote every value yourself and use `.filter(col, 'in', '(' + vals.map(q).join(',') + ')')`, or `.not(col, 'in', '(...)')` -> `name=not.in.("a,b","c\"d")`. Here `q = v => '"' + v.replace(/[\\"]/g, '\\$&') + '"'`.
- **`.or(filters)` / `.or(filters, { referencedTable })`**: `searchParams.append('or', \`(${filters})\`)`. **Raw string, no escaping.** Supabase docs: "`filters` is used as-is and needs to follow PostgREST syntax ... make sure it's properly sanitized". [DOCS SB-or https://supabase.com/docs/reference/javascript/or]
  - **Injection, VERIFIED:** user text `x),id.gt.0,name.eq.(y` in `.or(\`name.ilike.*${q}*\`)` -> `or=(name.ilike.*x),id.gt.0,name.eq.(y*)`. The user has injected an extra `id.gt.0` branch, which widens the OR. With RLS this cannot exceed the row policy. With a service key, it can expose any row of the table.
  - **Safe construction, VERIFIED URL:** for each leaf `${col}.${op}.${q(value)}`, with `col` from the allow-list and `op` from a fixed enum. For like ops, the value is `'%' + likeEsc(v) + '%'`, where `likeEsc = v => v.replace(/[\\%_]/g, '\\$&')`. Result for hostile input `x),id.gt.0,name.eq.(y "q" \ 50%_`: `or=(name.ilike."%x),id.gt.0,name.eq.(y \"q\" \\\\ 50\\%\\_%",city.ilike."...")`. That is one quoted value per leaf (the PostgREST unquote gives `\\` -> LIKE literal `\`).
  - `.or()` "not possible ... across multiple tables". [DOCS SB-or]
- `.not(col, op, value)` -> `col=not.op.value` (raw value). `.not('or', ...)` is **wrong** (VERIFIED: it gives `or=not.null.(...)`). For a negated group use `.or('not.and(a.eq.1,b.eq.2)')` (VERIFIED URL `or=(not.and(a.eq.1,b.eq.2))`), or append `not.or` manually.
- `.eq(col, null)` -> `eq.null` (compares with the text `'null'`, or gives 400 on non-text). `.eq(col, undefined)` -> `eq.undefined`. VERIFIED URL. Use `.is(col, null)`.
- `.match({a:1,b:'x'})` -> `a=eq.1&b=eq.x`. VERIFIED.
- `.textSearch(col, q, { type:'websearch', config:'english' })` -> `col=wfts(english).fat+&+cat` (the space is encoded as `+`). VERIFIED URL. The server decoding `+` as a space is UNVERIFIED (expected from standard query decoding).
- JSON path filter: `.eq('meta->>color','red')` -> `meta->>color=eq.red`. VERIFIED URL. Use `->>` for text comparison and `->` for JSON/number. [DOCS PGRST-ops]

### B4. Ordering, range, limit, count
- `.order(col, { ascending, nullsFirst, referencedTable })` appends to one `order` param: `order=a.desc.nullslast,b.asc.nullsfirst,id.asc`. With `nullsFirst` undefined, no suffix is added (PG default: NULLS LAST for asc, FIRST for desc). `referencedTable` -> `author.order=name.asc`. VERIFIED.
- `.range(from, to)` is **inclusive** -> `offset=from&limit=to-from+1` (`range(20,39)` -> `offset=20&limit=20`). `.limit(n)` -> `limit=n`. VERIFIED.
- Count: `select('*', { count: 'exact'|'planned'|'estimated', head? })` -> header `Prefer: count=...`. `head: true` -> HTTP **HEAD** (no body, count only). VERIFIED. The total comes back in `Content-Range: 0-24/3573458` (206 Partial Content). [DOCS PGRST-page https://docs.postgrest.org/en/stable/references/api/pagination_count.html]
  - `exact`: "the larger the table the slower". `planned`: from PG statistics (depends on ANALYZE). `estimated`: exact up to the `db-max-rows` threshold, planned above it. [DOCS PGRST-page]
  - v16.0: `count=exact` "no longer does a double count on requests that do not use ranges or db-max-rows". [DOCS PGRST-CL]
  - Note: planned/estimated count the **unfiltered plan estimate of the filtered query**. Accuracy under filters depends on PG's estimate (UNVERIFIED magnitude).
- `db-max-rows` (default unlimited in PostgREST): "A hard limit to the number of rows PostgREST will fetch". It clamps silently, and the client sees fewer rows than `limit` (check `Content-Range`). [DOCS PGRST-conf https://docs.postgrest.org/en/stable/references/configuration.html] **Supabase default: 1,000 rows** (postgrest-js JSDoc: "By default, Supabase projects return a maximum of 1,000 rows"). [SOURCE PostgrestQueryBuilder.ts] The adapter must cap the page size at <= max rows or detect a short page.
- Prefer handling: unknown preferences are ignored unless `Prefer: handling=strict` (PGRST122). [DOCS PGRST-pref https://docs.postgrest.org/en/stable/references/api/preferences.html]

### B5. Cursor (keyset) pagination
No native cursor. Build it with `or` + nested `and`, plus a matching `order` and `limit`. VERIFIED URL:
`.or('created_at.gt.2024-01-01T00:00:00Z,and(created_at.eq.2024-01-01T00:00:00Z,id.gt.42)').order('created_at').order('id').limit(50)`
-> `or=(created_at.gt.2024-01-01T00:00:00Z,and(created_at.eq.2024-01-01T00:00:00Z,id.gt.42))&order=created_at.asc,id.asc&limit=50`
- Quote cursor values with `q()` (timestamps contain `:` and `.`, which are reserved per docs, but they parse unquoted in a logic value because only `,` and `)` terminate it). Quoting is still the safe default.
- With a nullable sort key, add `is.null` branches per NULLS placement (the adapter must generate them). A spec `or` filter plus the cursor `or` -> two `or` params are ANDed (multiple params are ANDed by default). [DOCS PGRST-ops "evaluated using AND by default"]

### B6. Aggregates and group-by
- `avg() count() max() min() sum()` in `select`: `select=amount.sum()`, aliases `total:amount.sum()`, casts `amount.avg()::int`, `order_details->tax_amount::numeric.sum()`. **Implicit GROUP BY** over the non-aggregated selected columns: `select=status,count(),amount.sum()` groups by status. `count()` counts rows, while `col.count()` counts non-NULL values. [DOCS PGRST-agg https://docs.postgrest.org/en/stable/references/api/aggregate_functions.html]
- **Disabled by default** (`db-aggregates-enabled` default False, PGRST123 "Aggregate functions are disabled"). The docs recommend a statement timeout or `pg_plan_filter` as safeguards. [DOCS PGRST-conf; PGRST-err]. On Supabase: `alter role authenticator set pgrst.db_aggregates_enabled = 'true'; notify pgrst, 'reload config';`. [DOCS SB-agg https://supabase.com/blog/postgrest-aggregate-functions]
- "**HAVING** clause and **ordering by aggregated columns are not yet supported**". [DOCS PGRST-agg] -> "top N values by count" is impossible via REST. You can only order by the group column. `limit` applies to groups (UNVERIFIED).
- postgrest-js passes the select string through: `select('status, count(), amount.sum(), amount.avg()')` -> `select=status,count(),amount.sum(),amount.avg()` (the whitespace is stripped). VERIFIED URL. The select string is grammar too: build it only from allow-listed names.
- **Distinct values with counts:** (a) aggregates enabled -> `select=col,count()&<filters>&order=col.asc`. There is no ordering by count, so sort client-side and bound the group count. (b) **RPC** (recommended): a `stable` SQL function `distinct_values(col text, ...)` returning `table(value text, n bigint)`, with a whitelisted column via `format('%I')` inside the function.

### B7. RPC override
- `db.rpc('fn', args)` -> `POST rpc/fn` with a JSON body. `{ get: true }` -> `GET rpc/fn?arg=...`. `{ head: true }` -> HEAD. VERIFIED.
- Table-valued functions accept the normal filters, order, and range on top: `db.rpc('search_t', {q:'x'}).gt('age',3).order('id').range(0,9)` -> `POST rpc/search_t?age=gt.3&order=id.asc&offset=0&limit=10` with body `{"q":"x"}`. VERIFIED. Inlinable SQL functions get the filters pushed down. [DOCS PGRST-fn https://docs.postgrest.org/en/stable/references/api/functions.html]
- Large IN lists: postgrest-js has `urlLengthLimit` (default 8000) for its abort hint only: "consider using an RPC function to pass values server-side". It does not switch to POST automatically. [SOURCE PostgrestBuilder.ts] Pass large lists as an array arg via `POST /rpc` (body, no URL limit).

### B8. Embedded resources, JSON, RLS
- `select('*, author!inner(name)').eq('author.name','x')`: an embedded filter only filters the parent rows with `!inner`. Without it, only the embedded array is filtered. `author=not.is.null` is equivalent to `!inner`. `is.null` = anti-join. [DOCS PGRST-embed https://docs.postgrest.org/en/stable/references/api/resource_embedding.html; VERIFIED URL]
- `order=directors(last_name).desc` orders by a to-one embed. [DOCS PGRST-embed]
- RLS: a publishable/anon key runs as `anon`/`authenticated` and RLS applies. The **secret/service_role key "bypasses every Row Level Security policy"** and is server-only (HTTP 401 in browsers). Supabase is "deprecating the anon and service_role keys by the end of 2026" in favor of `sb_publishable_...`/`sb_secret_...`. [DOCS SB-keys https://supabase.com/docs/guides/api/api-keys]
- Adapter implication: a server-only adapter with a secret key has **no row boundary except the adapter's own filters**. Grammar injection (B3) then becomes data exposure. Prefer forwarding the user's JWT (RLS stays in force), and treat the allow-list plus quoting as mandatory, not optional.

### B9. Testing without a server
- Pass `fetch` to `new PostgrestClient(url, { fetch })` (or `createClient(url, key, { global: { fetch } })`). Capture `init.method`, `String(url)`, `new Headers(init.headers)`, `init.body`, and return `new Response('[]', { status: 200, headers: { 'content-type': 'application/json', 'content-range': '0-0/0' } })`. Builders are thenables, so `await builder` triggers the fetch. VERIFIED: all URLs in this file came from this stub.
- Assert on the **raw** URL (encoded) and also on a decoded form for readability. Note that `decodeURIComponent` does not decode `+`.
- Semantics (NULL, `in.()`, the `*` mapping, 22P02->400) need a real PostgREST (Docker/CI). These are marked UNVERIFIED above where only source-derived.

---

## C: the 15 operators side by side

Notation: `v` = the escaped value. `likeEsc(v)` = `v` with `\`,`%`,`_` prefixed by `\`. `q(v)` = `"`+v with `\`/`"` backslash-escaped+`"`. Prisma column = `name` (String?). PostgREST column = `name`. URL fragments are decoded. CI = case-insensitive. Prisma PG with `mode:'insensitive'` is the default for text operators. SQLite is noted where it differs.

| # | Operator | Prisma `where` (PG) | PostgREST builder -> URL fragment (top-level) | Inside `or()` leaf | Semantic deltas vs plain SQL |
|---|---|---|---|---|---|
| 1 | contains | `{ name: { contains: likeEsc(v), mode:'insensitive' } }` -> `ILIKE ('%'\|\|$1\|\|'%')` | `.ilike('name', \`%${likeEsc(v)}%\`)` -> `name=ilike.%v%` | `name.ilike.${q('%'+likeEsc(v)+'%')}` | Both: wildcards are not escaped by the library (VERIFIED). PostgREST: a literal `*` is unmatchable (`*`->`%`). SQLite: escaping impossible, LIKE is ASCII-CI already |
| 2 | notContains | `{ NOT: { name: { contains: likeEsc(v), mode:'insensitive' } } }` -> `NOT ... ILIKE` | `.not('name','ilike',\`%${likeEsc(v)}%\`)` -> `name=not.ilike.%v%` | `name.not.ilike.${q(...)}` | **Excludes NULL rows** on both. For NULL-inclusive: `OR:[{NOT:...},{name:null}]` / `or=(name.not.ilike...,name.is.null)` |
| 3 | equals | `{ name: v }` (case-sensitive `=`). CI exact: `{ name: { in:[v], mode:'insensitive' } }` -> `LOWER(name) IN (LOWER($1))` | `.eq('name', v)` -> `name=eq.v` (raw value, no quotes). CI: `.ilike('name', likeEsc(v))` | `name.eq.${q(v)}` | Prisma `equals+insensitive` = `ILIKE $1` (needs likeEsc, no index). PostgREST CI equals cannot contain a literal `*`. Never pass `null`/`undefined` (Prisma: filter dropped; postgrest-js: `eq.null` text) |
| 4 | notEquals | `{ name: { not: v } }` -> `<>`. CI: `{ name: { not: likeEsc(v), mode:'insensitive' } }` -> `NOT ILIKE` | `.neq('name', v)` -> `name=neq.v`. Null-safe: `.isDistinct('name', v)` -> `name=isdistinct.v` | `name.neq.${q(v)}` / `name.isdistinct.${q(v)}` | `<>` **excludes NULL**. UI usually expects NULL rows included. Prisma: `OR:[{name:{not:v}},{name:null}]`. PostgREST: `isdistinct` (v11+, case-sensitive) |
| 5 | startsWith | `{ name: { startsWith: likeEsc(v), mode:'insensitive' } }` -> `ILIKE ($1\|\|'%')` | `.ilike('name', \`${likeEsc(v)}%\`)` -> `name=ilike.v%` | `name.ilike.${q(likeEsc(v)+'%')}` | As #1. A btree index is usable only for case-sensitive `LIKE 'v%'` with `text_pattern_ops`/C collation |
| 6 | endsWith | `{ name: { endsWith: likeEsc(v), mode:'insensitive' } }` -> `ILIKE ('%'\|\|$1)` | `.ilike('name', \`%${likeEsc(v)}\`)` -> `name=ilike.%v` | `name.ilike.${q('%'+likeEsc(v))}` | As #1. Needs pg_trgm for index use |
| 7 | empty | `{ OR: [{ name: null }, { name: '' }] }`. Non-nullable: `{ name: '' }`. Non-text: `{ col: null }` | `.or('name.is.null,name.eq.')` -> `or=(name.is.null,name.eq.)` (the empty value after `eq.` = `''`) | `or(name.is.null,name.eq."")` | SQL `= ''` never matches NULL, so both branches are required. Non-text columns: only `is.null` (`eq.` on int = 400) |
| 8 | notEmpty | `{ AND: [{ name: { not: null } }, { name: { not: '' } }] }` (VERIFIED `not:''` alone already excludes NULL) | `.not('name','is',null).neq('name','')` -> `name=not.is.null&name=neq.` | `and(name.not.is.null,name.neq."")` | `neq.''` alone excludes NULL by 3-valued logic. Explicit is clearer |
| 9 | gt | `{ age: { gt: Number(v) } }` (typed, see A2.5) | `.gt('age', v)` -> `age=gt.v` | `age.gt.${q(v)}` | Prisma rejects string values for non-string fields. PostgREST casts the text (bad input -> 400). String columns: Prisma `mode:'insensitive'` -> `LOWER() > LOWER()` |
| 10 | gte | `{ age: { gte: x } }` | `.gte('age', v)` -> `age=gte.v` | `age.gte.${q(v)}` | NULL never matches |
| 11 | lt | `{ age: { lt: x } }` | `.lt('age', v)` -> `age=lt.v` | `age.lt.${q(v)}` | same |
| 12 | lte | `{ age: { lte: x } }` | `.lte('age', v)` -> `age=lte.v` | `age.lte.${q(v)}` | same |
| 13 | isBetween [a,b] incl., open bounds | `{ age: { gte: a, lte: b } }`. Omit the missing bound key. Prisma drops `undefined` keys, so `{ gte: a, lte: undefined }` also works, but omitting the key is explicit | `.gte('age',a).lte('age',b)` -> `age=gte.a&age=lte.b`. Open bound -> emit one side only | `and(age.gte.${q(a)},age.lte.${q(b)})` | Both bounds open -> no filter (drop the leaf, do not emit an empty group). `a > b` -> empty result (SQL BETWEEN semantics) |
| 14 | isAnyOf [..] | `{ name: { in: vals } }`. CI: `{ name: { in: vals, mode:'insensitive' } }`. `[]` -> `1=0` (no rows) | **Do not use `.in()` with untrusted strings** (it does not escape `"`/`\`). Use `.filter('name','in',\`(${vals.map(q).join(',')})\`)` -> `name=in.("a","b,c")`. `[]` -> `in.()` = no rows | `name.in.(${vals.map(q).join(',')})` | NULL is not matched by IN (use `OR is null` if the list holds an "(empty)" choice). Prisma: P2029 above about 40k params. PostgREST: URL length (use RPC) |
| 15 | isNoneOf [..] | `{ name: { notIn: vals } }`. `[]` -> `1=1` (all rows) | `.not('name','in',\`(${vals.map(q).join(',')})\`)` -> `name=not.in.("a","b,c")`. `[]` -> `not.in.()` -> NOT(= ANY('{}')) = all rows (derived, UNVERIFIED) | `name.not.in.(...)` | **Excludes NULL rows** (`NOT IN`/`NOT = ANY`). For NULL-inclusive: OR `is null` |

**Group translation**
- Prisma: `{ AND: [...] }` / `{ OR: [...] }`. Drop empty groups (`OR: []` = no rows). Depth 2 is trivial.
- PostgREST: the root AND = separate query params (implicitly ANDed). A root OR = `.or('l1,l2,and(l3,l4)')`. A nested group = `and(...)`/`or(...)` inside it. Negation = `not.and(...)`. Each leaf must be `col.op.q(value)`. **Never use `.in()`/`.or()` with unquoted user strings.**

**Quick search (text over several columns)**
- Prisma: `{ OR: cols.map(c => ({ [c]: { contains: likeEsc(t), mode: 'insensitive' } })) }`, ANDed with the filter tree. Only String fields (other types need `$queryRaw` with a `::text` cast).
- PostgREST: `.or(cols.map(c => \`${c}.ilike.${q('%'+likeEsc(t)+'%')}\`).join(','))`, text columns only (no casts in filters; use a computed column or RPC for numbers). Two `.or()` calls (search + spec) produce two `or` params that are ANDed. VERIFIED that the params are emitted separately (`orNested`, `cursorComposite` probes).

---

## D: Adapter design notes (derived)

1. **Column map is the only trust boundary.** Resolve `columnId` via `Map`/`Object.hasOwn`. Prisma silently ignores `__proto__` (all rows) and leaks field names in errors. PostgREST treats column names as grammar (`a.b`, `or`, `select`).
2. **Per-field metadata must come from the column map** (type, nullable, text-searchable, sortable). Prisma 7 has no public runtime DMMF with nullability. PostgREST needs the type for casting input and for choosing `ilike` vs `eq`.
3. **Normalize values before emitting:** typed coercion for Prisma, string serialization for PostgREST, and rejection of `undefined`/`null` leaves. Escape LIKE input (both). Quote every logic or `in` value with backslash escaping (PostgREST).
4. **Return-type normalization (Prisma):** `Decimal` -> string, `bigint` -> string (or number when safe) before JSON. Raw `COUNT(*)` is `bigint`.
5. **Page size:** clamp to the Supabase max rows (1,000 default). Detect clamping from `Content-Range`.
6. **Distinct values with counts:** Prisma `groupBy` (orderable by count). PostgREST: RPC preferred (aggregates are off by default and cannot order by count).
7. **Empty-group and empty-list rules must be explicit in the plan:** `OR: []` = no rows in Prisma. `in: []` = no rows in both. `notIn: []` = all rows.

---


# Part 4: Conclusions the spec takes

1. **One plan, adapter-owned rendering.** Builders differ on empty groups (Drizzle `and()`/`or()` give `undefined`; Kysely gives `1 = 1` / `1 = 0`; Prisma `OR: []` matches nothing), on empty lists (Kysely emits invalid `in ()` on PostgreSQL), and on `undefined` values (Prisma drops the filter). The core normalizes empty groups and lists to `true`/`false` constants before any adapter sees the plan.
2. **LIKE escaping is adapter-owned, the text is core-owned.** Drizzle and Kysely have no ESCAPE clause: add `ESCAPE '!'` through the `sql` template and bind the pattern. Prisma's object API never escapes and has no ESCAPE: on PostgreSQL escape with `\` (the default escape); on SQLite escaping is impossible through the object API. PostgREST maps `*` to `%` in `like`/`ilike`, so a literal `*` cannot match; `%`, `_`, `\` escape with `\`.
3. **`ilike` compiles on every Drizzle and Kysely dialect and fails on SQLite.** The adapter picks the operator from its `dialect` option, never from the builder.
4. **Negative operators include NULL rows by an explicit `OR IS NULL` branch.** Every builder's `<>`, `NOT LIKE`, `NOT IN`, `neq`, `not.in` excludes NULL.
5. **Parse values by column kind first.** Drizzle throws on wrong JS types (`toISOString`), Prisma rejects strings for Int fields and leaks field names in its error, PostgreSQL errors on `int_col = ''`.
6. **Lists:** bind one array parameter on PostgreSQL (`sql.param(arr)`, `eb.val(arr)`, `= ANY`); a plain list hits 65,535 parameters with a misleading error, SQLite 32,766, Prisma P2029 near 40,000. The spec caps lists at 1,000.
7. **Nulls last:** Drizzle needs `sql` for it; Kysely has `nullsLast()`; Prisma has `nulls: 'last'` on nullable fields only; PostgREST has `.nullslast`. MySQL and SQL Server need an emulation.
8. **Counts and aggregates return strings or bigint.** Normalize in the adapter: decimal strings for sum, avg, numeric; safe-integer check for counts. Prisma returns `Decimal` and `bigint` objects that break JSON.
9. **Column metadata:** Drizzle 0.45 exposes `dataType`, `columnType`, `enumValues`, `notNull` (undocumented fields, so switch on `dataType`, treat `columnType` as a hint, snapshot-test per version). Prisma 7 has no public runtime metadata (`Prisma.dmmf` is gone), so the column map is hand-written. Kysely and PostgREST have none.
10. **Test engines:** PGlite (WASM) and better-sqlite3 13 (prebuilt binaries) run everywhere with no compile. `node:sqlite` is not usable with Kysely's `SqliteDialect` (silent empty results) and Drizzle has no driver for it. Prisma runs on PGlite through `pglite-socket` plus `adapter-pg`, and on SQLite through `adapter-better-sqlite3`, after a `prisma generate` step. PostgREST semantics need a real server; URL generation tests use a capturing `fetch`.
11. **Prisma version risk:** the npm `latest` tag points at an 8.0 release candidate with a different (callback) query API. The adapter targets the 7.x object API and pins its peer range.
12. **PostgREST risks:** `.or()` passes its string through unescaped (grammar injection, shown); `.in()` quotes only values with `, ( )` and never escapes `"` or `\`. One quoting function builds every logic value. Aggregates are off by default and cannot order by an aggregate, so distinct values go through an RPC. A secret key bypasses row-level security, so the adapter forwards the caller's JWT when given one.
