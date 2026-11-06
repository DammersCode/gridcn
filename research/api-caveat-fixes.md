# API caveat fixes for 2.0

Implements `research/api-caveat-audit.md` under the API principles in `AGENTS.md`. One entry per finding: what changed, the decision, and the
capability check (before / after).

## Capabilities

### F2 (done)
- Before: checked ids survived a page change only with `keepCheckedRows` and `totalRowCount`; a client filter hid-and-remembered checks only with `keepCheckedRows` and `keepHiddenCheckedRows`.
- After: `totalRowCount` alone turns on the id memory. `rememberCheckedRows` (`true` / `false`) overrides it in both directions, on client and window grids. `keepHiddenCheckedRows` stays as a deprecated alias. `keepCheckedRows` keeps only its row-operation meaning. Nothing is removed.
- Docs warning removed: "pass `keepCheckedRows` together with `totalRowCount`".

### F7 (done)
- Before: every server caller hand-wrote the bound check for the filter tree. After: `parseServerSpec` does it; callers still can set `limits`, per-column `operators`, `customOperators`, `sortable`, `filterable`, and can skip the function and check by hand. Nothing is removed.
- Docs warning removed: "Validate the column ids" (drizzle). Kept: cap the body size (the library cannot see the raw text).
