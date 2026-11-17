import type { LookupOptions, LookupResolveRequest, LookupValue } from "./lookup-model";

// Relative on purpose: the shadcn CLI rewrites import paths, never augmentation module names.
declare module "../data-grid/types" {
  interface GridCellTypes {
    // `any` lets a column pass `LookupOptions<Row>`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lookup: { value: LookupValue; options: LookupOptions<any> };
  }
}

/** Public entry point — the only module consumers/docs should import from. */
export { lookupCellType } from "./lookup-cell-type";
export type { LookupFetchRequest, LookupLabels, LookupOption, LookupOptions, LookupResolveRequest, LookupValue } from "./lookup-model";
