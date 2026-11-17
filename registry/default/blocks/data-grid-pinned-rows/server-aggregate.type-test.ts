/** Compile-time only: the server aggregate hook takes `fetchAggregates` and nothing else. */
import { useDataGridServerAggregate } from "./use-data-grid-server-aggregate";

export function Probe() {
  const { row, status } = useDataGridServerAggregate({ fetchAggregates: async () => ({ total: 1 }) });
  const _row: Record<string, unknown> = row;
  const _status: "loading" | "stale" | "ready" | "error" = status;
  return [_row, _status];
}

import { useDataGridPinnedRows } from "./use-data-grid-pinned-rows";

export function PinnedProbe() {
  const { serverAggregates } = useDataGridPinnedRows();
  const _status: "loading" | "stale" | "ready" | "error" | undefined = serverAggregates[0]?.status;
  return _status;
}
