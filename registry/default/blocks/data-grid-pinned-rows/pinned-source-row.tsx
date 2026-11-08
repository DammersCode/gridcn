"use client";

import { useLayoutEffect, useMemo, type ReactNode } from "react";
import { DataGridPinnedRow, type DataGridPinnedRowProps } from "./pinned-row";
import type { PinnedRowSource } from "./pinned-row-source";
import { useDataGridAggregate } from "./use-data-grid-aggregate";
import { useDataGridServerAggregate, type ServerAggregateStatus } from "./use-data-grid-server-aggregate";

type SourceRowProps = Omit<DataGridPinnedRowProps, "row" | "byColumnId"> & {
  source: PinnedRowSource;
  /** Reports the source's server status to the band; clears it on unmount. */
  onStatus: (bandIndex: number, status: ServerAggregateStatus | undefined) => void;
};

function withCells(cells: Readonly<Record<string, unknown>> | undefined, values: Record<string, unknown>): Record<string, unknown> {
  return cells ? { ...cells, ...values } : values;
}

function AggregateSourceRow(props: SourceRowProps & { source: Extract<PinnedRowSource, { kind: "aggregate" }> }): ReactNode {
  const { source, onStatus: _onStatus, ...rowProps } = props;
  const values = useDataGridAggregate(source.specs, { scope: source.scope });
  const row = useMemo(() => withCells(source.cells, values), [source.cells, values]);
  return <DataGridPinnedRow {...rowProps} row={row} byColumnId />;
}

function ServerAggregateSourceRow(props: SourceRowProps & { source: Extract<PinnedRowSource, { kind: "server-aggregate" }> }): ReactNode {
  const { source, onStatus, ...rowProps } = props;
  const result = useDataGridServerAggregate(source.options);
  const row = useMemo(() => withCells(source.cells, result.row), [source.cells, result.row]);

  const { bandIndex } = rowProps;
  useLayoutEffect(() => {
    onStatus(bandIndex, result.status);
  }, [onStatus, bandIndex, result.status]);
  useLayoutEffect(() => () => onStatus(bandIndex, undefined), [onStatus, bandIndex]);

  return <DataGridPinnedRow {...rowProps} row={row} byColumnId />;
}

/** One pinned band entry built by `aggregateRow` or `serverAggregateRow`; resolves its values inside the grid provider. */
export function DataGridPinnedSourceRow(props: SourceRowProps): ReactNode {
  const { source } = props;
  return source.kind === "aggregate" ? <AggregateSourceRow {...props} source={source} /> : <ServerAggregateSourceRow {...props} source={source} />;
}
