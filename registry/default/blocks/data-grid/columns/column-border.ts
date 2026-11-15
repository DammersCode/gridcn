// Right-pinned cells draw their divider on the start side, so it marks the band edge while columns scroll underneath.
export const COLUMN_BORDER =
  "border-e data-[pinned=end]:border-e-0 data-[pinned=end]:border-s border-x-[color:var(--grid-column-border,var(--color-border))]";
