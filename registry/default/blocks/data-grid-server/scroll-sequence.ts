import type { RowRange } from "@/registry/default/blocks/data-grid/data-grid";
import { MAX_ROW_COUNT, type ReadAnswer } from "./read-answer";

/** Whether the first answer makes the source sequential: it carries a cursor, or it carries no count to size random access. */
export function startsSequence(read: Pick<ReadAnswer<unknown, unknown>, "nextCursor" | "totalRowCount">): boolean {
  return read.nextCursor !== undefined || typeof read.totalRowCount !== "number";
}

export type SequenceStep<TCursor> = {
  ended: boolean;
  /** The cursor the next block sends. */
  cursor: TCursor | undefined;
  warning: { kind: string; message: string } | null;
};

type StepInput<TCursor> = {
  read: ReadAnswer<unknown, TCursor>;
  /** The cursor this block was requested with. */
  sentCursor: TCursor | undefined;
  /** Rows loaded once this block is written. */
  loaded: number;
  /** The count the server sent, if any. */
  count: number | null;
};

/** Decides what a landed block means for the chain: does it go on, and with which cursor. */
export function stepSequence<TCursor>({ read, sentCursor, loaded, count }: StepInput<TCursor>): SequenceStep<TCursor> {
  const cursor = read.nextCursor ?? undefined;
  const end = (warning: SequenceStep<TCursor>["warning"] = null): SequenceStep<TCursor> => ({ ended: true, cursor, warning });
  if (read.rows.length === 0) {
    const emptyWithCursor = read.nextCursor !== undefined && read.nextCursor !== null;
    return end(emptyWithCursor ? { kind: "empty", message: "fetchRows returned an empty block with a next cursor; an empty block ends the source, so return rows or a null cursor" } : null);
  }
  if (read.nextCursor === null || read.hasMoreSent === false) return end();
  if (read.nextCursor === undefined && !read.hasMore) return end();
  if (read.nextCursor !== undefined && Object.is(read.nextCursor, sentCursor)) {
    return end({ kind: "cursor", message: "fetchRows answered the cursor it was sent; the source ends here, so return a new cursor or null" });
  }
  if (count !== null && loaded >= count) return end();
  if (loaded >= MAX_ROW_COUNT) return end({ kind: "max", message: `the source loaded ${MAX_ROW_COUNT} rows; it ends here` });
  return { ended: false, cursor, warning: null };
}

/** Skeleton rows below the loaded rows: one block, cut to the rows the server still owes. */
export function skeletonCount({ loaded, blockSize, count, ended }: { loaded: number; blockSize: number; count: number | null; ended: boolean }): number {
  if (ended) return 0;
  const owed = count === null ? blockSize : Math.max(0, count - loaded);
  return Math.min(blockSize, owed, Math.max(0, MAX_ROW_COUNT - loaded));
}

/** The next block starts when the rendered rows come within `overscan` of the loaded end. */
export function needsNextBlock(window: RowRange, loaded: number, overscan: number): boolean {
  return window.end + overscan >= loaded;
}
