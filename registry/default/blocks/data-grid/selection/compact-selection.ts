/** Half-open integer slice [start, end). */
type Slice = readonly [start: number, end: number];

let sharedEmpty: CompactSelection | undefined;

/**
 * Immutable run-length-encoded integer set: sorted, merged, half-open `[start, end)` slices.
 * Used for whole-row/whole-column selection channels; every mutation returns a new instance.
 */
export class CompactSelection {
  private readonly slices: readonly Slice[];

  private constructor(slices: readonly Slice[]) {
    this.slices = slices;
  }

  /** Shared empty singleton. */
  static empty(): CompactSelection {
    if (!sharedEmpty) sharedEmpty = new CompactSelection([]);
    return sharedEmpty;
  }

  /** A selection containing a single index or a single [start, end) range. */
  static fromSingleSelection(input: number | [number, number]): CompactSelection {
    return CompactSelection.empty().add(input);
  }

  /** A selection built from an arbitrary (unsorted, duplicate-tolerant) list of indices. */
  static fromArray(indices: readonly number[]): CompactSelection {
    if (indices.length === 0) return CompactSelection.empty();
    const sorted = [...indices].sort((a, b) => a - b);
    const slices: Slice[] = [];
    // sorted.length > 0 per the guard above, so index 0 is always present
    let start = sorted[0]!;
    let end = start + 1;
    for (let i = 1; i < sorted.length; i++) {
      const v = sorted[i]!; // i < sorted.length, in-bounds by loop condition
      if (v <= end) {
        if (v + 1 > end) end = v + 1;
      } else {
        slices.push([start, end]);
        start = v;
        end = v + 1;
      }
    }
    slices.push([start, end]);
    return new CompactSelection(slices);
  }

  /** Merges a normalized (sorted, non-overlapping) slice into the sorted slice list. */
  private static mergeSlice(slices: readonly Slice[], toAdd: Slice): Slice[] {
    const [addStart, addEnd] = toAdd;
    if (addStart >= addEnd) return [...slices];
    const result: Slice[] = [];
    let start = addStart;
    let end = addEnd;
    let inserted = false;
    for (const [s, e] of slices) {
      if (e < start) {
        result.push([s, e]);
      } else if (s > end) {
        if (!inserted) {
          result.push([start, end]);
          inserted = true;
        }
        result.push([s, e]);
      } else {
        start = Math.min(start, s);
        end = Math.max(end, e);
      }
    }
    if (!inserted) result.push([start, end]);
    return result;
  }

  /** Returns a new selection with the given index or [start, end) range added. */
  add(input: number | [number, number]): CompactSelection {
    const toAdd: Slice = typeof input === "number" ? [input, input + 1] : [input[0], input[1]];
    if (toAdd[0] >= toAdd[1]) return this;
    const merged = CompactSelection.mergeSlice(this.slices, toAdd);
    return new CompactSelection(merged);
  }

  /** Returns a new selection with the given index or [start, end) range removed, splitting slices as needed. */
  remove(input: number | [number, number]): CompactSelection {
    const [remStart, remEnd] = typeof input === "number" ? [input, input + 1] : input;
    if (remStart >= remEnd) return this;
    const result: Slice[] = [];
    for (const [s, e] of this.slices) {
      if (e <= remStart || s >= remEnd) {
        result.push([s, e]);
        continue;
      }
      if (s < remStart) result.push([s, remStart]);
      if (e > remEnd) result.push([remEnd, e]);
    }
    return new CompactSelection(result);
  }

  /** Whether a single index is a member. */
  hasIndex(index: number): boolean {
    for (const [s, e] of this.slices) {
      if (index >= s && index < e) return true;
      if (index < s) break;
    }
    return false;
  }

  /** Whether every index in [start, end) is a member. */
  hasAll(range: [number, number]): boolean {
    const [start, end] = range;
    if (start >= end) return true;
    for (const [s, e] of this.slices) {
      if (start >= s && end <= e) return true;
    }
    return false;
  }

  /** Lowest member index, or undefined when empty. */
  first(): number | undefined {
    return this.slices[0]?.[0];
  }

  /** Highest member index, or undefined when empty. */
  last(): number | undefined {
    const lastSlice = this.slices[this.slices.length - 1];
    return lastSlice ? lastSlice[1] - 1 : undefined;
  }

  /** Total member count (not slice count). */
  get length(): number {
    let total = 0;
    for (const [s, e] of this.slices) total += e - s;
    return total;
  }

  /** Shifts every member by `delta` (used to keep row/col selection in sync with insert/delete). Negative results are dropped. */
  offset(delta: number): CompactSelection {
    if (delta === 0) return this;
    const shifted: Slice[] = [];
    for (const [s, e] of this.slices) {
      const ns = s + delta;
      const ne = e + delta;
      if (ne <= 0) continue;
      shifted.push([Math.max(0, ns), ne]);
    }
    return new CompactSelection(shifted);
  }

  /** All member indices in ascending order. */
  toArray(): number[] {
    const out: number[] = [];
    for (const [s, e] of this.slices) {
      for (let i = s; i < e; i++) out.push(i);
    }
    return out;
  }

  /** Iterates all member indices in ascending order. */
  [Symbol.iterator](): Iterator<number> {
    const slices = this.slices;
    let sliceIndex = 0;
    let current = slices[0]?.[0] ?? 0;
    return {
      next(): IteratorResult<number> {
        let slice = slices[sliceIndex];
        while (slice !== undefined && current >= slice[1]) {
          sliceIndex++;
          slice = slices[sliceIndex];
          current = slice ? slice[0] : current;
        }
        if (slice === undefined) return { done: true, value: undefined };
        return { done: false, value: current++ };
      },
    };
  }

  /** Structural equality (same merged slices). */
  equals(other: CompactSelection): boolean {
    if (this === other) return true;
    if (this.slices.length !== other.slices.length) return false;
    for (let i = 0; i < this.slices.length; i++) {
      const a = this.slices[i]!; // i < length by loop condition, both arrays same length (checked above)
      const b = other.slices[i]!;
      if (a[0] !== b[0] || a[1] !== b[1]) {
        return false;
      }
    }
    return true;
  }
}
