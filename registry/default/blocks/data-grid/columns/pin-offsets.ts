import type { AnyColumnDef } from "../store";

/** Cumulative inset-inline-start offsets (px) for pinned-left columns, keyed by column index. */
export function pinLeftOffsets(widths: number[], pins: (AnyColumnDef["pin"] | undefined)[]): number[] {
  const offsets: number[] = [];
  let acc = 0;
  for (let i = 0; i < widths.length; i++) {
    offsets.push(acc);
    if (pins[i] === "left") acc += widths[i]!; // i < widths.length by loop condition
  }
  return offsets;
}

/** Cumulative inset-inline-end offsets (px) for pinned-right columns, keyed by column index. */
export function pinRightOffsets(widths: number[], pins: (AnyColumnDef["pin"] | undefined)[]): number[] {
  const offsets = new Array<number>(widths.length).fill(0);
  let acc = 0;
  for (let i = widths.length - 1; i >= 0; i--) {
    offsets[i] = acc;
    if (pins[i] === "right") acc += widths[i]!; // 0 <= i < widths.length by loop condition
  }
  return offsets;
}
