/** Registry of benchmarked grids — single source of truth for the runner's grid list and per-grid links. */
export type GridEntry = {
  id: string;
  label: string;
  path: string;
  caveat: string;
};

export const BENCHMARK_GRIDS: readonly GridEntry[] = [
  {
    id: "gridcn",
    label: "gridcn",
    path: "/dev/benchmark/gridcn",
    caveat: "Baseline — zero-render CSS-var scroll, DOM row pooling, editing + range selection + clipboard native.",
  },
  {
    id: "mui-x",
    label: "MUI X DataGrid (MIT)",
    path: "/dev/benchmark/mui-x",
    caveat: "DOM renderer, MIT tier — single-cell edit + row selection only; range selection/clipboard are Pro/Premium-tier.",
  },
  {
    id: "react-data-grid",
    label: "react-data-grid",
    path: "/dev/benchmark/react-data-grid",
    caveat: "Real MIT DOM grid — row-check selection + cell editing + opt-in clipboard callbacks; select/date/number editors are hand-rolled here.",
  },
  {
    id: "tanstack",
    label: "TanStack assembled baseline",
    path: "/dev/benchmark/tanstack",
    caveat: "react-table + react-virtual + a thin hand-rolled single-range selection; READ-ONLY (no editing layer at all), not a finished grid product.",
  },
];
