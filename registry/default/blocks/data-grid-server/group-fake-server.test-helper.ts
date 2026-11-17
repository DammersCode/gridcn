import { vi } from "vitest";
import type { ServerRowsAnswer, ServerRowsRequest } from "./read-answer";
import type { ServerGroupRow, ServerGroupsAnswer } from "./read-groups-answer";

export type Row = { id: string; region: string; city: string; qty: number };
export type Answer<T = Row> = ServerRowsAnswer<T, never> | ServerGroupsAnswer;

export const rowsOf = (regions: Record<string, number>): Row[] =>
  Object.entries(regions).flatMap(([region, count]) => Array.from({ length: count }, (_, i) => ({ id: `${region}${i}`, region, city: `${region}-c${i % 2}`, qty: 1 })));

const reduce = (reducer: string, values: number[]): number | null => {
  if (values.length === 0) return null;
  if (reducer === "count") return values.length;
  if (reducer === "min") return values.reduce((low, value) => Math.min(low, value));
  if (reducer === "max") return values.reduce((high, value) => Math.max(high, value));
  const sum = values.reduce((total, value) => total + value, 0);
  return reducer === "avg" ? sum / values.length : sum;
};

/** A server that implements the grouping contract over fixed rows: the oracle of the group tests. `rows` may change between requests. */
export function fakeServer<T extends { id: string }>(rows: T[], answerFor?: (request: ServerRowsRequest<never>) => Answer<T> | undefined) {
  const calls: ServerRowsRequest<never>[] = [];
  const valueOf = (row: T, columnId: string) => (row as Record<string, unknown>)[columnId];
  const fetchRows = vi.fn((request: ServerRowsRequest<never>): Promise<Answer<T>> => {
    calls.push(request);
    const override = answerFor?.(request);
    if (override) return Promise.resolve(override);
    const { spec, start, end, groupPath = [], childKind } = request;
    if (!childKind) return Promise.resolve({ rows: rows.slice(start, end), totalRowCount: rows.length });
    const groupBy = spec.groupBy ?? [];
    const inside = rows.filter((row) => groupPath.every((segment) => valueOf(row, segment.columnId) === segment.key));
    if (childKind === "rows") return Promise.resolve({ rows: inside.slice(start, end), totalRowCount: inside.length });
    const columnId = groupBy[groupPath.length]!;
    const keys = [...new Set(inside.map((row) => valueOf(row, columnId) as string))].sort();
    const groups: ServerGroupRow[] = keys.slice(start, end).map((key) => {
      const members = inside.filter((row) => valueOf(row, columnId) === key);
      const last = groupPath.length + 1 === groupBy.length;
      const childCount = last ? members.length : new Set(members.map((row) => valueOf(row, groupBy[groupPath.length + 1]!))).size;
      const aggregates = Object.fromEntries((spec.aggregates ?? []).map((aggregate) => [aggregate.columnId, reduce(aggregate.reducer, members.map((row) => Number(valueOf(row, aggregate.columnId))))]));
      return { key, childCount, totalRowCount: members.length, ...(spec.aggregates?.length ? { aggregates } : null) };
    });
    return Promise.resolve({ groups, groupCount: keys.length, ...(groupPath.length === 0 ? { totalRowCount: inside.length } : null) });
  });
  return { calls, fetchRows, rows };
}
