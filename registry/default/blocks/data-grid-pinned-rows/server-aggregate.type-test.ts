/** Compile-time only: the server aggregate hook takes `fetchAggregates` and nothing else. */
import { useDataGridServerAggregate } from "./use-data-grid-server-aggregate";

export function Probe() {
  const { row, status } = useDataGridServerAggregate({ fetchAggregates: async () => ({ total: 1 }) });
  const _row: Record<string, unknown> = row;
  const _status: "loading" | "stale" | "ready" | "error" = status;
  return [_row, _status];
}
