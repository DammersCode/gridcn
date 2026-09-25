// Right-pinned cells draw their divider on the start side, so it marks the band edge while columns scroll underneath.
export const COLUMN_BORDER =
  "border-e data-[pinned=right]:border-e-0 data-[pinned=right]:border-s border-x-[color:var(--grid-column-border,var(--color-border))]";
