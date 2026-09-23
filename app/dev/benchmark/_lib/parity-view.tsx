"use client";

import type { ReactNode } from "react";
import { BENCHMARK_GRIDS } from "./grids";
import { PARITY_ASPECTS, PARITY_LEVEL_LABEL, PARITY_MATRIX, parityGapsFor, type ParityLevel } from "./parity";

const LEVEL_CLASS: Record<ParityLevel, string> = {
  exact: "text-foreground",
  approximate: "text-warning",
  impossible: "text-destructive",
};

/** Per-grid block shown on each /dev/benchmark/&lt;grid&gt; page — every way this grid could NOT be made equal. */
export function GridParityNotes({ gridId }: { gridId: string }): ReactNode {
  const parity = PARITY_MATRIX[gridId];
  if (!parity) return null;
  const gaps = parityGapsFor(gridId);

  return (
    <div className="shrink-0 rounded-md border border-border p-3 text-xs">
      <p className="font-medium text-foreground">Feature parity vs gridcn</p>
      <p className="mt-1 text-muted-foreground">{parity.headline}</p>
      {gaps.length === 0 ? (
        <p className="mt-2 text-muted-foreground">All benchmarked columns and capabilities match the reference exactly.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {gaps.map((gap) => (
            <li key={gap.aspect}>
              <span className={`font-medium ${LEVEL_CLASS[gap.level]}`}>
                {gap.aspect} — {PARITY_LEVEL_LABEL[gap.level]}:
              </span>{" "}
              <span className="text-muted-foreground">{gap.note}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Full grid × (column, capability) matrix for the runner page. */
export function ParityMatrix(): ReactNode {
  return (
    <div className="shrink-0 space-y-2">
      <div>
        <p className="text-sm font-medium text-foreground">Parity</p>
        <p className="text-xs text-muted-foreground">
          Every metric is only comparable to the extent the grids render the same thing.{" "}
          <span className={LEVEL_CLASS.exact}>exact</span> = same feature,{" "}
          <span className={LEVEL_CLASS.approximate}>approx</span> = closest the library allows (hover for why),{" "}
          <span className={LEVEL_CLASS.impossible}>n/a</span> = cannot be matched at all.
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-200 border-collapse text-xs">
          <thead>
            <tr className="border-b border-border bg-muted text-left text-muted-foreground">
              <th className="p-2 font-medium">aspect</th>
              {BENCHMARK_GRIDS.map((grid) => (
                <th key={grid.id} className="p-2 font-medium">
                  {grid.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PARITY_ASPECTS.map((aspect) => (
              <tr key={aspect.id} className="border-b border-border last:border-0">
                <td className="p-2 font-medium text-foreground">
                  {aspect.label}
                  <span className="ml-1 text-muted-foreground">({aspect.kind})</span>
                </td>
                {BENCHMARK_GRIDS.map((grid) => {
                  const cell = PARITY_MATRIX[grid.id]?.cells[aspect.id];
                  if (!cell) return <td key={grid.id} className="p-2 text-muted-foreground">—</td>;
                  return (
                    <td key={grid.id} className="p-2 align-top" title={cell.note ?? cell.summary}>
                      <span className={`font-medium ${LEVEL_CLASS[cell.level]}`}>{PARITY_LEVEL_LABEL[cell.level]}</span>
                      <span className="block text-muted-foreground">{cell.summary}</span>
                      {cell.note && <span className="mt-0.5 block text-muted-foreground italic">{cell.note}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
