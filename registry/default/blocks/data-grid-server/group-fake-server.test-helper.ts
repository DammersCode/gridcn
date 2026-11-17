import { vi } from "vitest";
import type { ServerRowsAnswer, ServerRowsRequest } from "./read-answer";
import type { ServerGroupRow, ServerGroupsAnswer } from "./read-groups-answer";

export type Row = { id: string; region: string; city: string; qty: number };
export type Answer = ServerRowsAnswer<Row, never> | ServerGroupsAnswer;

export const rowsOf = (regions: Record<string, number>): Row[] =>
  Object.entries(regions).flatMap(([region, count]) => Array.from({ length: count }, (_, i) => ({ id: `${region}${i}`, region, city: `${region}-c${i % 2}`, qty: 1 })));

/** A server that implements the grouping contract over fixed rows: the oracle of the group tests. `rows` may change between requests. */
export function fakeServer(rows: Row[], answerFor?: (request: ServerRowsRequest<never>) => Answer | undefined) {
  const calls: ServerRowsRequest<never>[] = [];
  const keyOf = (row: Row, columnId: string) => row[columnId as keyof Row] as string;
  const fetchRows = vi.fn((request: ServerRowsRequest<never>): Promise<Answer> => {
    calls.push(request);
    const override = answerFor?.(request);
    if (override) return Promise.resolve(override);
    const { spec, start, end, groupPath = [], childKind } = request;
    if (!childKind) return Promise.resolve({ rows: rows.slice(start, end), totalRowCount: rows.length });
    const groupBy = spec.groupBy ?? [];
    const inside = rows.filter((row) => groupPath.every((segment) => keyOf(row, segment.columnId) === segment.key));
    if (childKind === "rows") return Promise.resolve({ rows: inside.slice(start, end), totalRowCount: inside.length });
    const columnId = groupBy[groupPath.length]!;
    const keys = [...new Set(inside.map((row) => keyOf(row, columnId)))].sort();
    const groups: ServerGroupRow[] = keys.slice(start, end).map((key) => {
      const members = inside.filter((row) => keyOf(row, columnId) === key);
      const last = groupPath.length + 1 === groupBy.length;
      const childCount = last ? members.length : new Set(members.map((row) => keyOf(row, groupBy[groupPath.length + 1]!))).size;
      return { key, childCount, totalRowCount: members.length, aggregates: { qty: members.reduce((sum, row) => sum + row.qty, 0) } };
    });
    return Promise.resolve({ groups, groupCount: keys.length, ...(groupPath.length === 0 ? { totalRowCount: inside.length } : null) });
  });
  return { calls, fetchRows, rows };
}
