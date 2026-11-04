"use client";

import { Profiler, useEffect, useMemo, type ProfilerOnRenderCallback, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { generateBenchmarkRows, ROLE_CHOICES, DATE_DISPLAY_FORMAT, DATE_LOCALE, type BenchmarkRow } from "../benchmark/_lib/dataset";

export type BenchMode = "mount" | "hydrate";
export type BenchVariant = "plain" | "markers";

const columns = defineColumns<BenchmarkRow>()([
  { id: "id", header: "ID", accessorKey: "id", type: "text", width: 120 },
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 180 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 220 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", options: { min: 18, max: 100 }, width: 80 },
  { id: "active", header: "Active", accessorKey: "active", type: "checkbox", width: 100 },
  { id: "role", header: "Role", accessorKey: "role", type: "select", options: { choices: ROLE_CHOICES }, width: 140 },
  { id: "joined", header: "Joined", accessorKey: "joined", type: "date", options: { displayFormat: DATE_DISPLAY_FORMAT, locale: DATE_LOCALE }, width: 140 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", options: { min: 0, max: 100, decimals: 1 }, width: 100 },
] as const);

type ProfileEntry = { phase: string; actualDuration: number; baseDuration: number; startTime: number; commitTime: number };

type BenchWindow = Window & {
  __benchProfile?: ProfileEntry[];
  __benchRowsMs?: number;
  __benchHydratedAt?: number;
  __mountBench?: MountBenchApi;
};

export type MountRunResult = {
  rowsPaintedMs: number;
  headerPaintedMs: number;
  settledMs: number;
  commits: number;
  actualMs: number;
  mountCommits: number;
  updateCommits: number;
  rowsAtFirstPaint: number;
  cellsAtFirstPaint: number;
  rowsAtSettle: number;
  cellsAtSettle: number;
  longTasksMs: number[];
  domNodes: number;
  commitsDetail: { phase: string; actual: number; at: number }[];
};

type MountBenchApi = { run: (rows: number, variant: BenchVariant) => Promise<MountRunResult>; unmount: () => void };

const onRender: ProfilerOnRenderCallback = (_id, phase, actualDuration, baseDuration, startTime, commitTime) => {
  const w = window as BenchWindow;
  (w.__benchProfile ??= []).push({ phase, actualDuration, baseDuration, startTime, commitTime });
};

function BenchGrid({ data, variant }: { data: BenchmarkRow[]; variant: BenchVariant }): ReactNode {
  return (
    <Profiler id="grid" onRender={onRender}>
      <DataGridProvider data={data} columns={columns} getRowId={(row) => row.id} rowMarkers={variant === "markers" ? "checkbox" : "none"}>
        <DataGridRoot className="h-[500px] w-full">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </Profiler>
  );
}

function HydrateGrid({ rows, variant }: { rows: number; variant: BenchVariant }): ReactNode {
  const data = useMemo(() => {
    const start = performance.now();
    const generated = generateBenchmarkRows(rows);
    if (typeof window !== "undefined") (window as BenchWindow).__benchRowsMs = performance.now() - start;
    return generated;
  }, [rows]);
  useEffect(() => {
    (window as BenchWindow).__benchHydratedAt = performance.now();
  }, []);
  return <BenchGrid data={data} variant={variant} />;
}

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const afterPaint = () =>
  new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });

const countIn = (host: HTMLElement) => ({
  rows: host.querySelectorAll('[role="row"]').length,
  cells: host.querySelectorAll('[role="gridcell"]').length,
});

/** Mounts a fresh React root, then watches frames until the DOM stops changing. */
function installMountApi(): void {
  const w = window as BenchWindow;
  const dataCache = new Map<number, BenchmarkRow[]>();
  let current: { host: HTMLElement; unmount: () => void } | null = null;

  const unmount = () => {
    current?.unmount();
    current?.host.remove();
    current = null;
  };

  const run: MountBenchApi["run"] = async (rows, variant) => {
    unmount();
    let data = dataCache.get(rows);
    if (!data) {
      data = generateBenchmarkRows(rows);
      dataCache.set(rows, data);
    }
    const host = document.createElement("div");
    host.className = "w-full";
    document.getElementById("bench-host")!.appendChild(host);
    const root = createRoot(host);
    current = { host, unmount: () => root.unmount() };

    w.__benchProfile = [];
    const longTasksMs: number[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasksMs.push(entry.duration);
    });
    observer.observe({ type: "longtask", buffered: false });

    let lastMutation = 0;
    const mutations = new MutationObserver(() => {
      lastMutation = performance.now();
    });
    mutations.observe(host, { subtree: true, childList: true, attributes: true, characterData: true });

    const t0 = performance.now();
    lastMutation = t0;
    root.render(<BenchGrid data={data} variant={variant} />);

    let rowsPaintedMs = -1;
    let headerPaintedMs = -1;
    let rowsAtFirstPaint = { rows: 0, cells: 0 };
    let settledMs = -1;
    const deadline = t0 + 10_000;
    let quietSince = t0;
    let lastSeenMutation = lastMutation;
    while (performance.now() < deadline) {
      await nextFrame();
      await afterPaint();
      const now = performance.now();
      if (headerPaintedMs < 0 && host.querySelector('[role="columnheader"]')) headerPaintedMs = now - t0;
      if (rowsPaintedMs < 0 && host.querySelector('[role="gridcell"]')) {
        rowsPaintedMs = now - t0;
        rowsAtFirstPaint = countIn(host);
      }
      if (lastMutation !== lastSeenMutation) {
        lastSeenMutation = lastMutation;
        quietSince = now;
      } else if (rowsPaintedMs >= 0 && now - quietSince > 100) {
        settledMs = lastSeenMutation - t0;
        break;
      }
    }
    observer.disconnect();
    mutations.disconnect();
    const settle = countIn(host);
    const profile = w.__benchProfile ?? [];
    return {
      rowsPaintedMs,
      headerPaintedMs,
      settledMs,
      commits: profile.length,
      actualMs: profile.reduce((sum, entry) => sum + entry.actualDuration, 0),
      mountCommits: profile.filter((entry) => entry.phase === "mount").length,
      updateCommits: profile.filter((entry) => entry.phase !== "mount").length,
      rowsAtFirstPaint: rowsAtFirstPaint.rows,
      cellsAtFirstPaint: rowsAtFirstPaint.cells,
      rowsAtSettle: settle.rows,
      cellsAtSettle: settle.cells,
      longTasksMs,
      domNodes: host.getElementsByTagName("*").length,
      commitsDetail: profile.map((entry) => ({ phase: entry.phase, actual: entry.actualDuration, at: entry.commitTime - t0 })),
    };
  };

  w.__mountBench = { run, unmount };
}

export function MountBench({ rows, mode, variant }: { rows: number; mode: BenchMode; variant: BenchVariant }): ReactNode {
  useEffect(() => {
    if (mode === "mount") installMountApi();
    return () => {
      (window as BenchWindow).__mountBench?.unmount();
      delete (window as BenchWindow).__mountBench;
    };
  }, [mode]);

  return (
    <>
      {/* Page text in the grid's fonts, so a cold run does not charge font decoding to the grid. */}
      <p className="px-2 py-1 text-sm">
        Mount benchmark <span className="font-medium">0123456789 Name Email Age Active Role Joined Score</span>
      </p>
      <div id="bench-host" className="w-full">
        {mode === "hydrate" && <HydrateGrid rows={rows} variant={variant} />}
      </div>
    </>
  );
}
