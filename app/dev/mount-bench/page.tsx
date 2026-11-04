import type { ReactNode } from "react";
import { MountBench, type BenchMode, type BenchVariant } from "./mount-bench";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

export default async function MountBenchPage({ searchParams }: { searchParams: SearchParams }): Promise<ReactNode> {
  const params = await searchParams;
  const rows = Number(first(params["rows"]) ?? 1000);
  const mode: BenchMode = first(params["mode"]) === "hydrate" ? "hydrate" : "mount";
  const variant: BenchVariant = first(params["variant"]) === "markers" ? "markers" : "plain";
  return <MountBench rows={Number.isInteger(rows) && rows > 0 ? rows : 1000} mode={mode} variant={variant} />;
}
