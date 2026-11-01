import { describe, expect, it } from "vitest";
import { MAX_ROW_COUNT, type ReadAnswer } from "./read-answer";
import { needsNextBlock, skeletonCount, startsSequence, stepSequence } from "./scroll-sequence";

const answer = (extra: Partial<ReadAnswer<unknown, number>> = {}): ReadAnswer<unknown, number> => ({
  rows: [1, 2, 3],
  totalRowCount: undefined,
  hasMore: true,
  hasMoreSent: undefined,
  nextCursor: undefined,
  ...extra,
});

describe("startsSequence", () => {
  it("is random access only for a count without a cursor", () => {
    expect(startsSequence(answer({ totalRowCount: 10 }))).toBe(false);
    expect(startsSequence(answer({ totalRowCount: 10, nextCursor: 3 }))).toBe(true);
    expect(startsSequence(answer({ totalRowCount: 10, nextCursor: null }))).toBe(true);
    expect(startsSequence(answer({ totalRowCount: null }))).toBe(true);
    expect(startsSequence(answer())).toBe(true);
  });
});

describe("stepSequence", () => {
  const step = (read: ReadAnswer<unknown, number>, extra: Partial<Parameters<typeof stepSequence<number>>[0]> = {}) =>
    stepSequence<number>({ read, sentCursor: undefined, loaded: 3, count: null, ...extra });

  it("goes on with the new cursor", () => {
    expect(step(answer({ nextCursor: 3 }))).toEqual({ ended: false, cursor: 3, warning: null });
  });
  it("ends at a null cursor, at hasMore false, and at a short offset block", () => {
    expect(step(answer({ nextCursor: null })).ended).toBe(true);
    expect(step(answer({ nextCursor: 3, hasMoreSent: false, hasMore: false })).ended).toBe(true);
    expect(step(answer({ hasMore: false })).ended).toBe(true);
    expect(step(answer({ hasMore: true })).ended).toBe(false);
  });
  it("ends on an empty block and warns only when a cursor came with it", () => {
    expect(step(answer({ rows: [] })).warning).toBeNull();
    expect(step(answer({ rows: [], nextCursor: 5 })).warning?.kind).toBe("empty");
    expect(step(answer({ rows: [], nextCursor: 5 })).ended).toBe(true);
  });
  it("ends on a repeated cursor with a warning", () => {
    const result = step(answer({ nextCursor: 7 }), { sentCursor: 7 });
    expect(result.ended).toBe(true);
    expect(result.warning?.kind).toBe("cursor");
  });
  it("ends once the loaded rows reach a known count", () => {
    expect(step(answer({ nextCursor: 3 }), { count: 3 }).ended).toBe(true);
    expect(step(answer({ nextCursor: 3 }), { count: 4 }).ended).toBe(false);
  });
  it("stops at MAX_ROW_COUNT with a warning", () => {
    const result = step(answer({ nextCursor: 3 }), { loaded: MAX_ROW_COUNT });
    expect(result.ended).toBe(true);
    expect(result.warning?.kind).toBe("max");
  });
});

describe("skeletonCount", () => {
  it("is one block, cut to the count and to MAX_ROW_COUNT, and zero at the end", () => {
    expect(skeletonCount({ loaded: 10, blockSize: 10, count: null, ended: false })).toBe(10);
    expect(skeletonCount({ loaded: 10, blockSize: 10, count: 14, ended: false })).toBe(4);
    expect(skeletonCount({ loaded: MAX_ROW_COUNT - 3, blockSize: 10, count: null, ended: false })).toBe(3);
    expect(skeletonCount({ loaded: 10, blockSize: 10, count: null, ended: true })).toBe(0);
  });
});

describe("needsNextBlock", () => {
  it("is true when the window comes within overscan of the loaded end", () => {
    expect(needsNextBlock({ start: 0, end: 5 }, 10, 0)).toBe(false);
    expect(needsNextBlock({ start: 0, end: 8 }, 10, 2)).toBe(true);
  });
});
