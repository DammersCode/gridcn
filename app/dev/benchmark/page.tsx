"use client";

import Link from "next/link";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { BENCHMARK_GRIDS } from "./_lib/grids";
import { ROW_SIZE_OPTIONS, DATASET_SEED, RUN_ENVIRONMENT_NOTE, type BenchmarkRowSize } from "./_lib/dataset";
import type { BenchmarkRunResult } from "./_lib/harness";
import { SCROLL_SPEED_TIERS } from "./_lib/metrics";
import { ParityMatrix } from "./_lib/parity-view";
import { EnvironmentBanner, useEnvironment } from "./_lib/environment-view";
import { DEV_MODE_WARNING, type BenchmarkEnvironment } from "./_lib/environment";
import { parityGapsFor } from "./_lib/parity";

type RunState = "idle" | "running" | "done" | "error";

type GridRunOutcome =
  | { status: "pending" }
  | { status: "running" }
  | { status: "done"; result: BenchmarkRunResult }
  | { status: "error"; message: string };

const READY_TIMEOUT_MS = 15_000;
const RESULT_TIMEOUT_MS = 60_000;

function formatFps(n: number): string {
  return n.toFixed(1);
}

function formatBytes(n: number | undefined): string {
  if (n === undefined) return "n/a";
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function resultsToMarkdown(
  rowCount: BenchmarkRowSize,
  outcomes: Record<string, GridRunOutcome>,
  env: BenchmarkEnvironment | null,
): string {
  const header = [
    "grid",
    "mount (ms)",
    ...SCROLL_SPEED_TIERS.flatMap((t) => [`${t.label} avg fps`, `${t.label} worst-100ms fps`, `${t.label} %<30fps`]),
    "click→paint (ms)",
    "heap after mount",
    "heap after scroll",
    "heap after 5 cycles",
    "DOM nodes",
    "long tasks",
  ];
  const lines = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
  for (const grid of BENCHMARK_GRIDS) {
    const outcome = outcomes[grid.id];
    if (!outcome || outcome.status !== "done") {
      lines.push(`| ${grid.label} | ${outcome?.status ?? "pending"} |${" |".repeat(header.length - 2)}`);
      continue;
    }
    const r = outcome.result;
    const cells = [
      grid.label,
      r.mountTimeMs.toFixed(1),
      ...SCROLL_SPEED_TIERS.flatMap((t) => {
        const s = r.scroll[t.label];
        return [formatFps(s.avgFps), formatFps(s.worstWindowFps), `${s.pctFramesBelow30.toFixed(1)}%`];
      }),
      r.clickToPaintMs.toFixed(1),
      formatBytes(r.heapAfterMountBytes),
      formatBytes(r.heapAfterScrollBytes),
      formatBytes(r.heapAfterCyclesBytes),
      String(r.domNodeCount),
      String(r.longTaskCount),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }
  lines.push("");
  if (env?.isDev) lines.push(`> ⚠ **DEV MODE RUN — NOT COMPARABLE.** ${DEV_MODE_WARNING}`, "");
  lines.push(
    `_env: ${env?.mode ?? "unknown"}${env?.commit ? ` · commit ${env.commit}` : ""} · rows: ${rowCount.toLocaleString()} · dataset seed: ${DATASET_SEED}_`,
  );
  lines.push("");
  lines.push(`_scroll tiers (burst→settle): ${SCROLL_SPEED_TIERS.map((t) => `${t.label} ${t.peakDelta}px peak × ${t.burstFrames}f + ${t.settleFrames}f settle`).join(" · ")}_`);
  lines.push("");
  lines.push(`_${RUN_ENVIRONMENT_NOTE}_`);
  lines.push("");
  lines.push("**Parity gaps** (see the runner's Parity table — metrics are only comparable insofar as the grids render the same thing):");
  for (const grid of BENCHMARK_GRIDS) {
    const gaps = parityGapsFor(grid.id);
    if (gaps.length === 0) continue;
    lines.push(`- **${grid.label}**: ${gaps.map((g) => `${g.aspect} (${g.level})`).join(", ")}`);
  }
  return lines.join("\n");
}

export default function BenchmarkRunnerPage(): ReactNode {
  const [rowCount, setRowCount] = useState<BenchmarkRowSize>(ROW_SIZE_OPTIONS[0]);
  const [runState, setRunState] = useState<RunState>("idle");
  const [outcomes, setOutcomes] = useState<Record<string, GridRunOutcome>>({});
  const [activeGridId, setActiveGridId] = useState<string | null>(null);
  const [copyLabel, setCopyLabel] = useState("Copy as markdown");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const env = useEnvironment();

  const runOne = useCallback(
    (gridId: string, path: string, rows: BenchmarkRowSize): Promise<GridRunOutcome> => {
      return new Promise((resolve) => {
        const iframe = iframeRef.current;
        if (!iframe) {
          resolve({ status: "error", message: "iframe not mounted" });
          return;
        }
        let settled = false;
        // Boxed so `onMessage`/`cleanup` (declared before either timer is set) can read the latest handle.
        const timeoutIds: { ready?: ReturnType<typeof setTimeout>; result?: ReturnType<typeof setTimeout> } = {};

        function cleanup() {
          window.removeEventListener("message", onMessage);
          clearTimeout(timeoutIds.ready);
          clearTimeout(timeoutIds.result);
        }
        function finish(outcome: GridRunOutcome) {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(outcome);
        }
        function onMessage(event: MessageEvent) {
          const data = event.data as { source?: string; type?: string; result?: BenchmarkRunResult; message?: string } | undefined;
          if (!data || data.source !== "gridcn-benchmark") return;
          if (data.type === "benchmark:ready") {
            clearTimeout(timeoutIds.ready);
            timeoutIds.result = setTimeout(() => finish({ status: "error", message: "timed out waiting for result" }), RESULT_TIMEOUT_MS);
          } else if (data.type === "benchmark:result" && data.result) {
            finish({ status: "done", result: data.result });
          } else if (data.type === "benchmark:error") {
            finish({ status: "error", message: data.message ?? "unknown error" });
          }
        }

        window.addEventListener("message", onMessage);
        timeoutIds.ready = setTimeout(() => finish({ status: "error", message: "timed out waiting for page ready" }), READY_TIMEOUT_MS);
        iframe.src = `${path}?rows=${rows}&auto=1`;
      });
    },
    [],
  );

  const runAll = useCallback(async () => {
    setRunState("running");
    const nextOutcomes: Record<string, GridRunOutcome> = {};
    for (const grid of BENCHMARK_GRIDS) nextOutcomes[grid.id] = { status: "pending" };
    setOutcomes({ ...nextOutcomes });

    for (const grid of BENCHMARK_GRIDS) {
      setActiveGridId(grid.id);
      nextOutcomes[grid.id] = { status: "running" };
      setOutcomes({ ...nextOutcomes });
      const outcome = await runOne(grid.id, grid.path, rowCount);
      nextOutcomes[grid.id] = outcome;
      setOutcomes({ ...nextOutcomes });
    }
    setActiveGridId(null);
    setRunState("done");
  }, [rowCount, runOne]);

  const handleCopy = useCallback(async () => {
    const markdown = resultsToMarkdown(rowCount, outcomes, env);
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyLabel("Copied!");
      setTimeout(() => setCopyLabel("Copy as markdown"), 1500);
    } catch {
      setCopyLabel("Copy failed");
      setTimeout(() => setCopyLabel("Copy as markdown"), 1500);
    }
  }, [rowCount, outcomes, env]);

  const hasResults = Object.keys(outcomes).length > 0;

  return (
    <div className="flex h-screen flex-col gap-4 overflow-y-auto bg-background p-6">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Benchmark runner</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Mounts each grid alone in an isolated iframe, runs the same scripted scenario, and reports one results
            table. For the human "feel" test, drive each grid directly via its page below.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            rows
            <select
              className="rounded-md border border-border bg-background px-2 py-1 text-foreground"
              value={rowCount}
              onChange={(e) => setRowCount(Number(e.target.value) as BenchmarkRowSize)}
              disabled={runState === "running"}
            >
              {ROW_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rounded-md border border-border bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            onClick={() => void runAll()}
            disabled={runState === "running"}
          >
            {runState === "running" ? `Running ${activeGridId ?? "…"}` : "Run benchmark"}
          </button>
          {hasResults && (
            <button
              type="button"
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground"
              onClick={() => void handleCopy()}
            >
              {copyLabel}
            </button>
          )}
        </div>
      </div>

      <EnvironmentBanner rowCount={rowCount} />

      <div className="shrink-0 overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-225 border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted text-left text-muted-foreground">
              <th className="p-2 font-medium">grid</th>
              <th className="p-2 font-medium">mount (ms)</th>
              {SCROLL_SPEED_TIERS.map((t) => (
                <th key={t.label} className="p-2 font-medium" colSpan={3}>
                  {t.label} scroll
                </th>
              ))}
              <th className="p-2 font-medium">click→paint (ms)</th>
              <th className="p-2 font-medium">heap Δ (mount/scroll/5-cycle)</th>
              <th className="p-2 font-medium">DOM nodes</th>
              <th className="p-2 font-medium">long tasks</th>
            </tr>
          </thead>
          <tbody>
            {BENCHMARK_GRIDS.map((grid) => {
              const outcome = outcomes[grid.id];
              return (
                <tr key={grid.id} className="border-b border-border last:border-0">
                  <td className="p-2 font-medium text-foreground">
                    {grid.label}
                    {activeGridId === grid.id && <span className="ml-2 text-xs text-muted-foreground">running…</span>}
                  </td>
                  {!outcome || outcome.status === "pending" || outcome.status === "running" ? (
                    <td className="p-2 text-muted-foreground" colSpan={11}>
                      {outcome?.status ?? "not run"}
                    </td>
                  ) : outcome.status === "error" ? (
                    <td className="p-2 text-destructive" colSpan={11}>
                      error: {outcome.message}
                    </td>
                  ) : (
                    <>
                      <td className="p-2">{outcome.result.mountTimeMs.toFixed(1)}</td>
                      {SCROLL_SPEED_TIERS.map((t) => {
                        const s = outcome.result.scroll[t.label];
                        return (
                          <td key={t.label} className="p-2" colSpan={3}>
                            {formatFps(s.avgFps)} avg / {formatFps(s.worstWindowFps)} worst / {s.pctFramesBelow30.toFixed(1)}%&lt;30fps
                          </td>
                        );
                      })}
                      <td className="p-2">{outcome.result.clickToPaintMs.toFixed(1)}</td>
                      <td className="p-2">
                        {formatBytes(outcome.result.heapAfterMountBytes)} / {formatBytes(outcome.result.heapAfterScrollBytes)} /{" "}
                        {formatBytes(outcome.result.heapAfterCyclesBytes)}
                      </td>
                      <td className="p-2">{outcome.result.domNodeCount}</td>
                      <td className="p-2">{outcome.result.longTaskCount}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ParityMatrix />

      <div className="shrink-0 rounded-md border border-border p-3 text-xs text-muted-foreground">
        <p className="mb-1 font-medium text-foreground">Per-grid caveats</p>
        <ul className="list-inside list-disc space-y-0.5">
          {BENCHMARK_GRIDS.map((grid) => (
            <li key={grid.id}>
              <span className="font-medium text-foreground">{grid.label}:</span> {grid.caveat}
            </li>
          ))}
        </ul>
      </div>

      <div className="shrink-0">
        <p className="mb-1 text-sm font-medium text-foreground">Manual feel — drive each grid by hand</p>
        <p className="mb-2 text-xs text-muted-foreground">
          Wheel/fling scroll, click, drag-select, and Ctrl+C are the real test; open each page directly (not through
          this iframe) and try them.
        </p>
        <div className="flex flex-wrap gap-2">
          {BENCHMARK_GRIDS.map((grid) => (
            <Link
              key={grid.id}
              href={grid.path}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground hover:bg-muted"
            >
              {grid.label} →
            </Link>
          ))}
        </div>
      </div>

      {/* Reused sequentially — one grid's page loaded at a time so mounts never overlap. Needs real layout size (0x0 would give every grid a zero scrollHeight). */}
      <div className="min-h-0 flex-1">
        <p className="mb-1 text-xs text-muted-foreground">
          {activeGridId ? `Live view — currently benchmarking ${activeGridId}:` : "Live view (idle until a run starts):"}
        </p>
        <iframe ref={iframeRef} title="benchmark-driver" className="h-125 w-full rounded-md border border-border" />
      </div>
    </div>
  );
}
