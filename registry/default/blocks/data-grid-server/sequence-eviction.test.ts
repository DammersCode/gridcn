import { describe, expect, it } from "vitest";
import { evictedBlocksIn, evictSequenceRows, sequenceLoaded, shiftBlocks, type SeqBlock } from "./sequence-eviction";
import { createCore } from "./scroll-core";

const blocksOf = (count: number, size = 50): SeqBlock[] => Array.from({ length: count }, (_, i) => ({ local: i * size, length: size, server: i * size, serverEnd: (i + 1) * size, cursor: i, evicted: false }));

describe("sequenceLoaded", () => {
  it("subtracts the evicted blocks from the chain", () => {
    const blocks = blocksOf(4, 10);
    blocks[1]!.evicted = true;
    expect(sequenceLoaded(40, blocks)).toEqual([{ start: 0, end: 10 }, { start: 20, end: 40 }]);
  });
});

describe("shiftBlocks", () => {
  it("moves the blocks after an insert and grows the block that holds it", () => {
    const shifted = shiftBlocks(blocksOf(3, 10), 15, 1);
    expect(shifted.map((block) => [block.local, block.length])).toEqual([[0, 10], [10, 11], [21, 10]]);
  });

  it("moves the blocks after a delete and drops an emptied block", () => {
    expect(shiftBlocks(blocksOf(3, 10), 5, -1).map((block) => [block.local, block.length])).toEqual([[0, 9], [9, 10], [19, 10]]);
    expect(shiftBlocks([{ ...blocksOf(1, 1)[0]!, local: 4 }], 4, -1)).toEqual([]);
  });
});

describe("evictSequenceRows", () => {
  it("unloads the blocks furthest from the keep range and skips a protected block", () => {
    const core = createCore<{ id: string }>();
    core.seq.blocks = blocksOf(6, 10);
    core.seq.length = 60;
    core.loaded = sequenceLoaded(60, core.seq.blocks);
    const rows = Array.from({ length: 60 }, (_, i) => ({ id: `r${i}` }));
    evictSequenceRows(core, rows, { wasEvicted: [], loadedTotal: 60, keep: { start: 40, end: 60 }, cap: 30, protectedIds: new Set(["r3"]), idOf: (row) => row.id });
    expect(core.seq.blocks.map((block) => block.evicted)).toEqual([false, true, true, true, false, false]);
    expect(rows[3]).toBeDefined();
    expect(rows[15]).toBeUndefined();
  });
});

describe("100k rows", () => {
  it("looks up the evicted blocks of a window in constant time per scroll report", () => {
    const blocks = blocksOf(2000);
    for (let index = 0; index < 1900; index++) blocks[index]!.evicted = true;
    const started = performance.now();
    for (let scroll = 0; scroll < 20_000; scroll++) evictedBlocksIn(blocks, { start: (scroll * 5) % 99_000, end: ((scroll * 5) % 99_000) + 80 });
    expect(performance.now() - started).toBeLessThan(250);
  });
});
