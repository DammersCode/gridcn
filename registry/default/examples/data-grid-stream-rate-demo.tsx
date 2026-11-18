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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type Quote = { id: string; symbol: string; price: number; change: number; volume: number };
type Reorder = "defer" | "frame" | "immediate";
type Rate = "10" | "100" | "1000";
type Stats = { fps: number; p95: number; applied: number; calls: number };

const ROW_COUNT = 100_000;
const HOT_ROWS = 200;
const PRODUCE_MS = 20;
const RATES: Record<Rate, string> = { "10": "10 per second", "100": "100 per second", "1000": "1,000 per second" };
const REORDERS: readonly Reorder[] = ["defer", "frame", "immediate"];

const columns = defineColumns<Quote>()([
  { id: "symbol", header: "Symbol", accessorKey: "symbol", type: "text", width: 110, flex: 1 },
  { id: "price", header: "Price", accessorKey: "price", type: "number", width: 100, flex: 1 },
  { id: "change", header: "Change %", accessorKey: "change", type: "number", width: 110, flex: 1 },
  { id: "volume", header: "Volume", accessorKey: "volume", type: "number", width: 110, flex: 1 },
] as const);

function seededRows(): Quote[] {
  let seed = 7;
  const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
  return Array.from({ length: ROW_COUNT }, (_, i) => ({
    id: `q${i}`,
    symbol: `SYM${String(i).padStart(6, "0")}`,
    price: Math.round(next() * 50_000) / 100,
    change: Math.round((next() * 8 - 4) * 100) / 100,
    volume: Math.floor(next() * 1_000_000),
  }));
}

const getRowId = (row: Quote) => row.id;

function randomPatch(): CellPatch {
  const rowId = `q${Math.floor(Math.random() * HOT_ROWS)}`;
  const pick = Math.random();
  if (pick < 0.4) return { rowId, columnId: "price", value: Math.round(Math.random() * 50_000) / 100 };
  if (pick < 0.8) return { rowId, columnId: "change", value: Math.round((Math.random() * 8 - 4) * 100) / 100 };
  return { rowId, columnId: "volume", value: Math.floor(Math.random() * 1_000_000) };
}

/** Buffers the produced patches and applies them in one `updateCells` call per animation frame while `active`. */
function RateFeed({
  active,
  rate,
  reorder,
  flash,
  onStats,
}: {
  active: boolean;
  rate: number;
  reorder: Reorder;
  flash: boolean;
  onStats: (stats: Stats) => void;
}): ReactNode {
  const actions = useDataGridActions();
  const settings = useRef({ actions, rate, reorder, flash, onStats });
  useEffect(() => {
    settings.current = { actions, rate, reorder, flash, onStats };
  });

  useEffect(() => {
    if (!active) return;
    let buffer: CellPatch[] = [];
    let carry = 0;
    let frames: number[] = [];
    let calls = 0;
    let applied = 0;
    let last = performance.now();
    let windowStart = last;
    let frame = 0;

    const producer = setInterval(() => {
      carry += (settings.current.rate * PRODUCE_MS) / 1000;
      const count = Math.floor(carry);
      carry -= count;
      for (let i = 0; i < count; i++) buffer.push(randomPatch());
    }, PRODUCE_MS);

    const onFrame = (now: number) => {
      frames.push(now - last);
      last = now;
      if (buffer.length > 0) {
        const { actions, reorder, flash } = settings.current;
        applied += actions.updateCells(buffer, { source: "stream", reorder, flash }).applied;
        calls += 1;
        buffer = [];
      }
      const elapsed = now - windowStart;
      if (elapsed >= 1000) {
        const sorted = frames.toSorted((a, b) => a - b);
        const perSecond = 1000 / elapsed;
        settings.current.onStats({
          fps: Math.round(frames.length * perSecond),
          p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
          applied: Math.round(applied * perSecond),
          calls: Math.round(calls * perSecond),
        });
        frames = [];
        calls = 0;
        applied = 0;
        windowStart = now;
      }
      frame = requestAnimationFrame(onFrame);
    };
    frame = requestAnimationFrame(onFrame);

    return () => {
      clearInterval(producer);
      cancelAnimationFrame(frame);
    };
  }, [active]);

  return null;
}

function ReSortBar(): ReactNode {
  const actions = useDataGridActions();
  const viewStale = useDataGridViewStale();
  if (!viewStale) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">New values changed the sort order.</span>
      <Button size="sm" variant="outline" onClick={() => actions.reconcileView()}>
        Re-sort
      </Button>
    </div>
  );
}

function Counter({ label, stat, value }: { label: string; stat: string; value: string }): ReactNode {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm tabular-nums" data-stat={stat}>
        {value}
      </dd>
    </div>
  );
}

/** A 100,000-row feed with a rate control: patches buffer between frames and reach the grid in one call per frame. */
export default function DataGridStreamRateDemo(): ReactNode {
  const [running, setRunning] = useState(true);
  const [rate, setRate] = useState<Rate>("100");
  const [reorder, setReorder] = useState<Reorder>("frame");
  const [flash, setFlash] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [rows] = useState(seededRows);
  const [onScreen, setOnScreen] = useState(true);
  const [tabShown, setTabShown] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry?.isIntersecting ?? true));
    observer.observe(root);
    const onVisibility = () => setTabShown(!document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const text = (value: number | undefined) => (value === undefined ? "—" : String(value));

  return (
    <div ref={rootRef} className="w-full flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <Button size="sm" variant={running ? "default" : "outline"} onClick={() => setRunning((r) => !r)}>
          {running ? "Pause" : "Resume"}
        </Button>
        <Select value={rate} onValueChange={(value) => setRate(value as Rate)}>
          <SelectTrigger className="w-44" aria-label="Updates per second">
            <SelectValue>{(value: Rate) => RATES[value]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(RATES) as Rate[]).map((value) => (
              <SelectItem key={value} value={value}>
                {RATES[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={reorder} onValueChange={(value) => setReorder(value as Reorder)}>
          <SelectTrigger className="w-36" aria-label="Reorder">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REORDERS.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={flash} onCheckedChange={setFlash} />
          Flash
        </label>
      </div>
      <dl className="flex flex-wrap gap-6">
        <Counter label="Frames per second" stat="fps" value={text(stats?.fps)} />
        <Counter label="p95 frame time (ms)" stat="p95" value={text(stats?.p95)} />
        <Counter label="Applied cells per second" stat="applied" value={text(stats?.applied)} />
        <Counter label="Grid calls per second" stat="calls" value={text(stats?.calls)} />
      </dl>
      <DataGridProvider defaultData={rows} columns={columns} getRowId={getRowId} headerClickBehavior="sort">
        <RateFeed
          active={running && onScreen && tabShown}
          rate={Number(rate)}
          reorder={reorder}
          flash={flash}
          onStats={setStats}
        />
        <ReSortBar />
        <DataGridRoot className="h-[320px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}
