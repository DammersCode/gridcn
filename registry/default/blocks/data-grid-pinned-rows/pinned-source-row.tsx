"use client";

import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { DataGridPinnedRow, type DataGridPinnedRowProps } from "./pinned-row";
import { liveServerOptions, liveSpecs, reducerVersion, subscribeReducers, type PinnedRowSource } from "./pinned-row-source";
import { useDataGridAggregate } from "./use-data-grid-aggregate";
import { useDataGridServerAggregate, type ServerAggregateResult, type ServerAggregateStatus } from "./use-data-grid-server-aggregate";

type SourceRowProps = Omit<DataGridPinnedRowProps, "row" | "byColumnId"> & {
  source: PinnedRowSource;
  /** Reports the source's server status to the band; clears it on unmount. */
  onStatus: (bandIndex: number, status: ServerAggregateStatus | undefined) => void;
  /** Reports the full server result to `useDataGridPinnedRows`; clears it on unmount. */
  onResult?: (source: PinnedRowSource, result: ServerAggregateResult | undefined) => void;
};

function withCells(cells: Readonly<Record<string, unknown>> | undefined, values: Record<string, unknown>): Record<string, unknown> {
  return cells ? { ...cells, ...values } : values;
}

function AggregateSourceRow(props: SourceRowProps & { source: Extract<PinnedRowSource, { kind: "aggregate" }> }): ReactNode {
  const { source, onStatus: _onStatus, onResult: _onResult, ...rowProps } = props;
  const subscribe = useCallback((listener: () => void) => subscribeReducers(source, listener), [source]);
  const version = useSyncExternalStore(subscribe, () => reducerVersion(source), () => reducerVersion(source));
  const specs = useMemo(() => liveSpecs(source, version), [source, version]);
  const values = useDataGridAggregate(specs, { scope: source.scope });
  const row = useMemo(() => withCells(source.cells, values), [source.cells, values]);
  return <DataGridPinnedRow {...rowProps} row={row} byColumnId />;
}

function ServerAggregateSourceRow(props: SourceRowProps & { source: Extract<PinnedRowSource, { kind: "server-aggregate" }> }): ReactNode {
  const { source, onStatus, onResult, ...rowProps } = props;
  const options = useMemo(() => liveServerOptions(source), [source]);
  const result = useDataGridServerAggregate(options);
  const row = useMemo(() => withCells(source.cells, result.row), [source.cells, result.row]);

  const { bandIndex } = rowProps;
  useLayoutEffect(() => {
    onStatus(bandIndex, result.status);
  }, [onStatus, bandIndex, result.status]);
  useLayoutEffect(() => () => onStatus(bandIndex, undefined), [onStatus, bandIndex]);
  useLayoutEffect(() => {
    onResult?.(source, result);
  }, [onResult, source, result]);
  useLayoutEffect(() => () => onResult?.(source, undefined), [onResult, source]);

  return <DataGridPinnedRow {...rowProps} row={row} byColumnId />;
}

/** One pinned band entry built by `aggregateRow` or `serverAggregateRow`; resolves its values inside the grid provider. */
export function DataGridPinnedSourceRow(props: SourceRowProps): ReactNode {
  const { source } = props;
  return source.kind === "aggregate" ? <AggregateSourceRow {...props} source={source} /> : <ServerAggregateSourceRow {...props} source={source} />;
}
