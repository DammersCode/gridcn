/**
 * Run environment stamped onto every result set. v1's numbers were taken under `next dev`, where
 * Turbopack's dev bundle + React's development build inflate per-commit cost for the grid that
 * commits most (gridcn) far more than for grids that coalesce into fewer, larger React renders —
 * so a dev-mode result is not comparable to a production one and must never be read as one.
 */

export type BenchmarkEnvironment = {
  mode: "development" | "production";
  isDev: boolean;
  /** Short commit sha, when the build exposes it (Vercel does; a local `next build` usually doesn't). */
  commit: string | null;
  userAgent: string;
  /** Chrome-only; absent means heap columns read n/a. */
  hasHeapApi: boolean;
  deviceMemoryGb: number | null;
  hardwareConcurrency: number | null;
};

export function readEnvironment(): BenchmarkEnvironment {
  const isDev = process.env.NODE_ENV !== "production";
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  // Non-standard but widely shipped in Chrome; typed locally rather than polluting the global lib.
  const extended = nav as (Navigator & { deviceMemory?: number }) | undefined;
  return {
    mode: isDev ? "development" : "production",
    isDev,
    commit: process.env["NEXT_PUBLIC_COMMIT_SHA"]?.slice(0, 7) ?? null,
    userAgent: nav?.userAgent ?? "unknown",
    hasHeapApi: typeof performance !== "undefined" && "memory" in performance,
    deviceMemoryGb: extended?.deviceMemory ?? null,
    hardwareConcurrency: nav?.hardwareConcurrency ?? null,
  };
}

export const DEV_MODE_WARNING =
  "Running under `next dev` — these numbers are NOT comparable across grids. Turbopack + React's development build tax every React commit, which penalizes commit-heavy architectures disproportionately. Run `pnpm build && pnpm start` and benchmark the production server before trusting any figure here.";
