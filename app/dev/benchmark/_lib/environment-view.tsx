"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DEV_MODE_WARNING, readEnvironment, type BenchmarkEnvironment } from "./environment";
import { DATASET_SEED, RUN_ENVIRONMENT_NOTE, type BenchmarkRowSize } from "./dataset";

/** Read after mount: userAgent/deviceMemory don't exist during SSR and would hydrate-mismatch. */
export function useEnvironment(): BenchmarkEnvironment | null {
  const [env, setEnv] = useState<BenchmarkEnvironment | null>(null);
  useEffect(() => setEnv(readEnvironment()), []);
  return env;
}

/** Environment + dataset stamp shown next to any displayed result, with a loud dev-mode warning. */
export function EnvironmentBanner({ rowCount }: { rowCount?: BenchmarkRowSize }): ReactNode {
  const env = useEnvironment();

  return (
    <div className="shrink-0 space-y-1">
      {env?.isDev && (
        <p className="rounded-md border border-destructive bg-destructive/10 p-2 text-xs font-medium text-destructive">
          ⚠ dev mode — {DEV_MODE_WARNING}
        </p>
      )}
      {/* suppressHydrationWarning: this line is intentionally client-only (userAgent/deviceMemory/rows don't exist during SSR), so the server's placeholder text never matches. */}
      <p className="text-xs text-muted-foreground" suppressHydrationWarning>
        <span className="font-medium text-foreground">
          {`env: ${env?.mode ?? "…"}`}
          {env?.commit ? ` · commit ${env.commit}` : ""}
          {rowCount ? ` · ${rowCount.toLocaleString()} rows` : ""}
        </span>{" "}
        {`· dataset seed: ${DATASET_SEED}`}
        {env?.hardwareConcurrency ? ` · ${env.hardwareConcurrency} cores` : ""}
        {env?.deviceMemoryGb ? ` · ${env.deviceMemoryGb}GB` : ""}
        {env && !env.hasHeapApi ? " · no performance.memory (heap = n/a)" : ""}
        {` · ${RUN_ENVIRONMENT_NOTE}`}
      </p>
    </div>
  );
}
