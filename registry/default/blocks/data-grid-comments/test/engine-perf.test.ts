// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createCommentEngine } from "../comment-engine";
import type { CellComment } from "../types";

const user = { id: "ada", name: "Ada" };
const CI_FACTOR = process.env["CI"] === "true" ? 3 : 1;
/** The first 100k sync the budgets hold for (about 180 ms idle); a slower same-run first sync scales them, so load and coverage cannot fail them. */
const IDLE_FIRST_SYNC_MS = 300;

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
  it("re-indexes 10k changed comments, then compares an unchanged 100k prop, inside the budget", async ({ annotate }) => {
    const measure = () => {
      const base = records(100_000);
      const engine = createCommentEngine({ getOptions: () => ({ currentUser: user, maxComments: 200_000 }), controlled: true });
      const first = time(() => engine.syncProp(base));
      const unchanged = time(() => engine.syncProp(base.slice()));
      const rebuilt = records(100_000);
      const rebuiltCompare = time(() => engine.syncProp(rebuilt));
      const changed = base.map((c, i) => (i < 10_000 ? { ...c, text: `${c.text} edited`, version: 2, writeId: `w${i}` } : c));
      const tenK = time(() => engine.syncProp(changed));
      return { engine, first: first.ms, unchanged: unchanged.ms, rebuiltCompare: rebuiltCompare.ms, tenK: tenK.ms };
    };
    const runs = Array.from({ length: 5 }, measure);
    const best = (key: "first" | "unchanged" | "rebuiltCompare" | "tenK") => Math.min(...runs.map((r) => r[key]));
    const engine = runs[0]!.engine;
    const load = CI_FACTOR * Math.max(1, best("first") / IDLE_FIRST_SYNC_MS);
    await annotate(`comment sync: unchanged ${best("unchanged").toFixed(1)} ms, rebuilt ${best("rebuiltCompare").toFixed(1)} ms, 10k ${best("tenK").toFixed(1)} ms; first sync ${best("first").toFixed(1)} ms, load ${load.toFixed(2)}`);
    expect(best("unchanged")).toBeLessThan(200 * load);
    expect(best("rebuiltCompare")).toBeLessThan(100 * load);
    expect(best("tenK")).toBeLessThan(150 * load);
    expect(engine.store.core.confirmed.size).toBe(100_000);
    for (const run of runs) run.engine.dispose();
  }, 30_000);
});
