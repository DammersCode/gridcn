"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { DataGridPlugin, RowBandRenderCtx } from "@/registry/default/blocks/data-grid/data-grid";
import { isDev } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { DataGridPinnedRowBand } from "./pinned-row-band";
import { forwardSource, isPinnedRowSource, type PinnedRowSource } from "./pinned-row-source";
import { PENDING_SERVER_AGGREGATE, type ServerAggregateResult, type ServerAggregateStatus } from "./use-data-grid-server-aggregate";

/** Options for {@link useDataGridPinnedRows}. */
export type UseDataGridPinnedRowsOptions = {
  /** Rows pinned in a sticky band directly under the header, a SEPARATE array from `data`, not indices into it. An `aggregateRow` or `serverAggregateRow` entry shows computed totals; any other entry is a row object. Omit (or pass `[]`) for no top band. */
  topRows?: readonly unknown[];
  /** Rows pinned in a sticky band at the viewport's bottom edge; see {@link UseDataGridPinnedRowsOptions.topRows}. */
  bottomRows?: readonly unknown[];
  /** Marks both bands while server values load, go stale, or fail: the bands dim and set `data-status`, and set `aria-busy` only while values load or go stale. Default: the status of the band's `serverAggregateRow` entries, else `"ready"`. */
  status?: ServerAggregateStatus;
};

/** Return value of {@link useDataGridPinnedRows}. */
export type UseDataGridPinnedRowsResult = {
  /** Pass this into the grid's `plugins` prop (`plugins={[pinnedRows.plugin]}`). Stable across renders while `topRows` and `bottomRows` keep the same entries (a plain row object by its own values, an `aggregateRow` or `serverAggregateRow` by its content, so an inline array, an inline `aggregateRow`, and an inline `serverAggregateRow` are fine, also with inline functions) and `status` stays the same. */
  plugin: DataGridPlugin<unknown>;
  /** The result of each `serverAggregateRow` entry (`row`, `status`, `error`, `loading`, `refresh()`, `retry()`), top band first, in entry order. Empty without such an entry. Each result starts as `PENDING_SERVER_AGGREGATE` until the band mounts. */
  serverAggregates: readonly ServerAggregateResult[];
};

/** Holds the results that the bands report as an immutable map; a result is cleared when its row unmounts. */
class ServerResults {
  private results: ReadonlyMap<PinnedRowSource, ServerAggregateResult> = new Map();
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  getSnapshot = () => this.results;
  report = (source: PinnedRowSource, result: ServerAggregateResult | undefined) => {
    if (this.results.get(source) === result) return;
    const next = new Map(this.results);
    if (result) next.set(source, result);
    else next.delete(source);
    this.results = next;
    this.listeners.forEach((listener) => listener());
  };
}

const EMPTY_ROWS: readonly never[] = [];

const valueIds = new WeakMap<object, number>();
let nextValueId = 0;

function valueKey(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return `${typeof value}:${String(value)}`;
  let id = valueIds.get(value);
  if (id === undefined) valueIds.set(value, (id = nextValueId++));
  return `#${id}`;
}

/** Equal own keys and values give equal keys; with `skipFunctions`, every function gives the same key. */
function shallowKey(record: object | undefined, skipFunctions = false): string {
  if (record === undefined) return "-";
  const parts = Object.entries(record).map(([key, value]) => `${JSON.stringify(key)}=${skipFunctions && typeof value === "function" ? "fn" : valueKey(value)}`);
  return `{${parts.sort().join(",")}}`;
}

function entryKey(entry: unknown): string {
  if (!isPinnedRowSource(entry)) return typeof entry === "object" && entry !== null && Object.getPrototypeOf(entry) === Object.prototype ? `row${shallowKey(entry)}` : valueKey(entry);
  if (entry.kind === "aggregate") return `aggregate${JSON.stringify(entry.scope)}${shallowKey(entry.cells)}${shallowKey(entry.specs, true)}`;
  return `server${shallowKey(entry.cells)}${shallowKey(entry.options, true)}`;
}

class EntriesHolder {
  private key: string | null = null;
  private rows: readonly unknown[] = EMPTY_ROWS;

  /** The rows held for `key`: the last rows with an equal key, so a new array of equal entries keeps the identity. */
  hold(key: string, rows: readonly unknown[]): readonly unknown[] {
    if (key !== this.key) [this.key, this.rows] = [key, rows];
    return this.rows;
  }
}

// Keyed by content and held outside state, so an entry that changes on every render gives a new array instead of a render loop.
function useStableEntries(rows: readonly unknown[]): readonly unknown[] {
  const [holder] = useState(() => new EntriesHolder());
  const held = holder.hold(rows.map(entryKey).join("|"), rows);
  useLayoutEffect(() => {
    held.forEach((entry, i) => {
      if (isPinnedRowSource(entry) && isPinnedRowSource(rows[i])) forwardSource(entry, rows[i]);
    });
  });
  return held;
}

function useWarnSharedServerRow(topRows: readonly unknown[], bottomRows: readonly unknown[]): void {
  const warned = useRef(false);
  useEffect(() => {
    if (!isDev() || warned.current) return;
    const seen = new Set<unknown>();
    for (const entry of [...topRows, ...bottomRows]) {
      if (!isPinnedRowSource(entry) || entry.kind !== "server-aggregate") continue;
      if (seen.has(entry)) {
        warned.current = true;
        console.warn("[data-grid-pinned-rows] one serverAggregateRow is pinned more than once, so it fetches once per place. Create a second serverAggregateRow, or pin it once.");
        return;
      }
      seen.add(entry);
    }
  }, [topRows, bottomRows]);
}

/**
 * Pinned top/bottom row bands, as a single hook. Row bands affect layout height and `aria-rowcount`,
 * so the grid resolves the band row counts synchronously at first render (root.tsx keeps all of
 * that arithmetic and calls this plugin's `rowBands.render` per band segment). Cells render via the
 * same `DataGridCell`/cell-type pipeline as data rows (same columns, alignment, formatting) but
 * never edit: they have no pointer, click, or double-click handlers and no tab stop, so they are not
 * keyboard-navigable. A column's `readOnly: false` changes only their `data-readonly` attribute, unless the column has no `accessorKey` and no `setValue`.
 */
export function useDataGridPinnedRows(options: UseDataGridPinnedRowsOptions = {}): UseDataGridPinnedRowsResult {
  const { status } = options;
  const topRows = useStableEntries(options.topRows ?? EMPTY_ROWS);
  const bottomRows = useStableEntries(options.bottomRows ?? EMPTY_ROWS);
  useWarnSharedServerRow(topRows, bottomRows);
  const [serverResults] = useState(() => new ServerResults());
  const results = useSyncExternalStore(serverResults.subscribe, serverResults.getSnapshot, serverResults.getSnapshot);
  const serverAggregates = useMemo(
    () => [...topRows, ...bottomRows].filter(isPinnedRowSource).flatMap((entry) => (entry.kind === "server-aggregate" ? [results.get(entry) ?? PENDING_SERVER_AGGREGATE] : [])),
    [topRows, bottomRows, results],
  );
  const plugin = useMemo<DataGridPlugin<unknown>>(
    () => ({
      name: "pinned-rows",
      rowBands: {
        top: topRows,
        bottom: bottomRows,
        render: (ctx: RowBandRenderCtx) => renderPinnedRowBand(ctx, status, serverResults.report),
      },
    }),
    [topRows, bottomRows, status, serverResults],
  );

  return { plugin, serverAggregates };
}

function renderPinnedRowBand(ctx: RowBandRenderCtx, status: ServerAggregateStatus | undefined, onServerResult: (source: PinnedRowSource, result: ServerAggregateResult | undefined) => void) {
  const { position, rows, renderedColumns, layout, rowHeight, template, headerHeight, ariaRowIndexBase } = ctx;
  return (
    <DataGridPinnedRowBand
      position={position}
      rows={rows}
      renderedColumns={renderedColumns}
      layout={layout}
      rowHeight={rowHeight}
      template={template}
      headerHeight={headerHeight}
      ariaRowIndexBase={ariaRowIndexBase}
      status={status}
      onServerResult={onServerResult}
    />
  );
}
