// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createCommentEngine } from "../comment-engine";
import type { CellComment } from "../types";

const user = { id: "ada", name: "Ada" };
const CI_FACTOR = process.env["CI"] === "true" ? 3 : 1;

function records(count: number, offset = 0): CellComment[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `c${i + offset}`,
    rowId: `r${(i + offset) % 100_000}`,
    columnId: `col${(i + offset) % 3}`,
    text: `Comment ${i}`,
    author: user,
    createdAt: 1000,
    updatedAt: 1000,
    version: 1,
    resolved: false,
  }));
}

function time<T>(fn: () => T): { ms: number; value: T } {
  const start = performance.now();
  const value = fn();
  return { ms: performance.now() - start, value };
}

describe("controlled comments cost", () => {
  it("re-indexes 10k changed comments, then compares an unchanged 100k prop, inside the budget", () => {
    const measure = () => {
      const base = records(100_000);
      const engine = createCommentEngine({ getOptions: () => ({ currentUser: user, maxComments: 200_000 }), controlled: true });
      time(() => engine.syncProp(base));
      const unchanged = time(() => engine.syncProp(base.slice()));
      const rebuilt = records(100_000);
      const rebuiltCompare = time(() => engine.syncProp(rebuilt));
      const changed = base.map((c, i) => (i < 10_000 ? { ...c, text: `${c.text} edited`, version: 2, writeId: `w${i}` } : c));
      const tenK = time(() => engine.syncProp(changed));
      return { engine, unchanged: unchanged.ms, rebuiltCompare: rebuiltCompare.ms, tenK: tenK.ms };
    };
    const runs = Array.from({ length: 5 }, measure);
    const best = (key: "unchanged" | "rebuiltCompare" | "tenK") => Math.min(...runs.map((r) => r[key]));
    const engine = runs[0]!.engine;
    expect(best("unchanged")).toBeLessThan(50 * CI_FACTOR);
    expect(best("rebuiltCompare")).toBeLessThan(100 * CI_FACTOR);
    expect(best("tenK")).toBeLessThan(150 * CI_FACTOR);
    expect(engine.store.core.confirmed.size).toBe(100_000);
    for (const run of runs) run.engine.dispose();
  });
});
