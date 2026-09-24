/** Public entry point — the only module consumers/docs should import from. */
export { useDataGridFill, type UseDataGridFillOptions, type UseDataGridFillResult, type FillArgs } from "./use-data-grid-fill";
export { computeFillTarget, type AllowedFillDirections, type ComputeFillTargetOptions } from "./fill";
export { detectSeries, type SeriesDescriptor } from "./fill";
export { generateFill, type FillDirection, type GenerateFillOptions } from "./fill";
export { fillDirection, rectRelativeTo } from "./fill";
