import { describe, expect, it, vi } from "vitest";
import { ALL_MODES, mountMode } from "./modes";

describe.each(ALL_MODES)("updateCells streaming in mode %s", (mode) => {
  it("writes by row id and tags the change as a stream", async () => {
    const grid = await mountMode(mode);
    let verdict: { applied: number } | undefined;
    grid.act(() => {
      verdict = grid.state().actions.updateCells([{ rowId: "r2", columnId: "n", value: 222 }]);
    });
    expect(verdict?.applied).toBe(1);
    expect(grid.cell("r2", "n")).toBe(222);
    expect(grid.changes.at(-1)?.source).toBe("stream");
  });

  it("keeps writing to the same row while the view sorts", async () => {
    const grid = await mountMode(mode);
    grid.setSorts([{ columnId: "n", direction: "desc" }]);
    grid.act(() => void grid.state().actions.updateCells([{ rowId: "r1", columnId: "n", value: 111 }]));
    expect(grid.cell("r1", "n")).toBe(111);
  });

  it("skips an unknown row and a no-op value, and a readOnly grid ignores the batch", async () => {
    const grid = await mountMode(mode);
    let verdict: { applied: number; skipped: { reason: string }[] } | undefined;
    grid.act(() => {
      verdict = grid.state().actions.updateCells([
        { rowId: "nope", columnId: "n", value: 1 },
        { rowId: "r0", columnId: "n", value: 0 },
      ]);
    });
    expect(verdict?.applied).toBe(0);
    expect(verdict?.skipped.map((s) => s.reason)).toEqual(["unknown-row", "no-op"]);
    expect(grid.changes).toHaveLength(0);
    const readOnly = await mountMode(mode, { props: { readOnly: true } });
    readOnly.act(() => void readOnly.state().actions.updateCells([{ rowId: "r1", columnId: "n", value: 5 }]));
    expect(readOnly.changes).toHaveLength(0);
  });

  it("does not send a stream change to onSave", async () => {
    const onSave = vi.fn();
    const grid = await mountMode(mode, { props: { onSave } });
    grid.act(() => void grid.state().actions.updateCells([{ rowId: "r2", columnId: "n", value: 222 }]));
    await grid.settle();
    expect(onSave).not.toHaveBeenCalled();
  });
});
