"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
  useDataGridActions,
  useDataGridViewStale,
  type CellPatch,
} from "@/registry/default/blocks/data-grid/data-grid";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

type Ticker = { id: string; symbol: string; price: number; change: number; volume: number };

const columns = defineColumns<Ticker>()([
  { id: "symbol", header: "Symbol", accessorKey: "symbol", type: "text", width: 90, flex: 1 },
  { id: "price", header: "Price", accessorKey: "price", type: "number", width: 90, flex: 1 },
  { id: "change", header: "Change %", accessorKey: "change", type: "number", width: 100, flex: 1 },
  { id: "volume", header: "Volume", accessorKey: "volume", type: "number", width: 100, flex: 1 },
] as const);

const SYMBOLS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOG", "META", "TSLA", "AMD", "INTC", "NFLX"];

function initialRows(): Ticker[] {
  return SYMBOLS.map((symbol, i) => ({
    id: symbol,
    symbol,
    price: 100 + i * 17.5,
    change: 0,
    volume: 1_000_000 + i * 25_000,
  }));
}

const getRowId = (row: Ticker) => row.id;

/** Pushes a batch of price/change patches four times per second while `running` is true. */
function TickerFeed({ running, autoSort }: { running: boolean; autoSort: boolean }): ReactNode {
  const actions = useDataGridActions();
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const autoSortRef = useRef(autoSort);
  autoSortRef.current = autoSort;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const patches: CellPatch[] = [];
      for (const symbol of SYMBOLS) {
        const change = Number((Math.random() * 4 - 2).toFixed(2));
        patches.push({ rowId: symbol, columnId: "change", value: change });
        patches.push({ rowId: symbol, columnId: "volume", value: 1_000_000 + Math.floor(Math.random() * 500_000) });
      }
      actionsRef.current.updateCells(patches, { reorder: autoSortRef.current ? "immediate" : "defer" });
    }, 250);
    return () => clearInterval(id);
  }, [running]);

  return null;
}

/** Shows a re-sort control only while a deferred batch has left the displayed order stale; hidden in auto-sort mode. */
function ReSortBar({ autoSort }: { autoSort: boolean }): ReactNode {
  const actions = useDataGridActions();
  const viewStale = useDataGridViewStale();
  if (autoSort || !viewStale) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">New values changed the sort order.</span>
      <Button size="sm" variant="outline" onClick={() => actions.reconcileView()}>
        Re-sort
      </Button>
    </div>
  );
}

/** A live ticker: `updateCells` streams new values in place. Auto-sort re-sorts every tick; otherwise rows hold position until you re-sort. */
export default function DataGridStreamingDemo(): ReactNode {
  const [running, setRunning] = useState(true);
  const [autoSort, setAutoSort] = useState(false);

  return (
    <div className="w-full flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <Button size="sm" variant={running ? "default" : "outline"} onClick={() => setRunning((r) => !r)}>
          {running ? "Pause feed" : "Start feed"}
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={autoSort} onCheckedChange={setAutoSort} />
          Auto-sort
        </label>
      </div>
      <p className="text-sm text-muted-foreground">
        Click the Change % header to sort: with Auto-sort off, rows hold their position as new values
        stream in and a &quot;Re-sort&quot; bar appears once the order goes stale; with Auto-sort on, the
        grid re-sorts on every tick (4/s).
      </p>
      <DataGridProvider
        defaultData={initialRows()}
        columns={columns}
        getRowId={getRowId}
        headerClickBehavior="sort"
      >
        <TickerFeed running={running} autoSort={autoSort} />
        <ReSortBar autoSort={autoSort} />
        <DataGridRoot className="h-[320px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}
