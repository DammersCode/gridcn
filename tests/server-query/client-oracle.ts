import { makeFilterPredicate, rowAccessorFor } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { FIXTURE_ROWS, type FixtureRow } from "./fixture";

const COLUMNS = ["id", "name", "tag", "score", "qty", "active", "price", "createdAt"].map((id) => ({ id, header: id, accessorFn: (row: unknown) => (row as Record<string, unknown>)[id] }));

export type FilterTree = readonly Record<string, unknown>[];

/** The ids the grid's own client filter engine keeps, evaluated over the fixture literals (never over driver rows). */
export function oracleIds(filters: FilterTree, rows: readonly FixtureRow[] = FIXTURE_ROWS): number[] {
  const accessor = rowAccessorFor(COLUMNS as never, rows, undefined);
  const keep = makeFilterPredicate(accessor, filters as never);
  return rows.filter((_, index) => keep(index)).map((row) => row.id);
}
