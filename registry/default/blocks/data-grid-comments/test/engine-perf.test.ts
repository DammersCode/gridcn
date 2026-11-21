// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createCommentEngine } from "../comment-engine";
import type { CellComment } from "../types";

const user = { id: "ada", name: "Ada" };
const CI_FACTOR = process.env["CI"] === "true" ? 3 : 1;
/** The plain reference on a dev machine; a slower same-run reference raises each budget from its floor toward its cap, so load cannot fail it. */
const IDLE_REFERENCE_MS = 25;

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

/** The engine's Map and array mix without its code, so an engine slowdown cannot raise the budgets. */
function plainIndexCompare(next: readonly CellComment[]): number {
  const byId = new Map<string, CellComment>();
  for (const c of next) byId.set(c.id, c);
  const byCell = new Map<string, CellComment[]>();
  let same = 0;
  for (const c of next) {
    const key = `${c.rowId}\u0000${c.columnId}`;
    const list = byCell.get(key);
    if (list) list.push(c);
    else byCell.set(key, [c]);
    const known = byId.get(c.id);
    if (known && known.text === c.text && known.version === c.version) same++;
  }
  return same + byCell.size;
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
      engine.syncProp(base);
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
    const sample = records(100_000);
    const referenceMs = Math.min(...Array.from({ length: 5 }, () => time(() => plainIndexCompare(sample)).ms));
    const budget = (floor: number, cap: number) => Math.min(CI_FACTOR * cap, Math.max(CI_FACTOR * floor, (floor * referenceMs) / IDLE_REFERENCE_MS));
    await annotate(`comment sync: unchanged ${best("unchanged").toFixed(1)} ms, rebuilt ${best("rebuiltCompare").toFixed(1)} ms, 10k ${best("tenK").toFixed(1)} ms; reference ${referenceMs.toFixed(1)} ms`);
    expect(best("unchanged")).toBeLessThan(budget(50, 90));
    expect(best("rebuiltCompare")).toBeLessThan(budget(100, 210));
    expect(best("tenK")).toBeLessThan(budget(150, 300));
    expect(engine.store.core.confirmed.size).toBe(100_000);
    for (const run of runs) run.engine.dispose();
  }, 30_000);
});
