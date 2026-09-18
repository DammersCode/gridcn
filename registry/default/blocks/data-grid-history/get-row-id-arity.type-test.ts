/**
 * Compile-time-only check (B11): getRowId across data-grid-history's hooks must accept the same
 * 2-arg `(row, index)` shape as core's DataGrid getRowId, so a consumer writing an index-derived
 * fallback id compiles cleanly through these hooks too. tsc gate typechecks this file; vitest's
 * *.type-test.ts glob excludes it (see vitest.config.ts), matching the repo's other type-test files.
 */
import type { UseDataGridStateOptions } from "./use-data-grid-state";
import type { UseDataGridHistoryOptions } from "./use-data-grid-history";

type Row = { id: string; name: string };

const stateOptions: UseDataGridStateOptions<Row> = {
  getRowId: (row, index) => row.id ?? `row-${index}`,
};

const historyOptions: UseDataGridHistoryOptions<Row> = {
  data: [],
  setData: () => {},
  getRowId: (row, index) => row.id ?? `row-${index}`,
};

// existing 1-arg callers remain valid — this widening is additive, not breaking.
const legacyStateOptions: UseDataGridStateOptions<Row> = { getRowId: (row) => row.id };

void stateOptions;
void historyOptions;
void legacyStateOptions;

export {};
