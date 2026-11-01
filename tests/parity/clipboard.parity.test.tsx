import { describe, expect, it } from "vitest";
import { pasteText } from "@/registry/default/blocks/data-grid/clipboard/use-grid-clipboard";
import { ALL_MODES, mountMode } from "./modes";

describe.each(ALL_MODES)("paste in mode %s", (mode) => {
  const paste = (grid: Awaited<ReturnType<typeof mountMode>>, text: string, viewRow = 0) => {
    grid.act(() => grid.state().actions.selectCellAt({ col: 1, row: viewRow }));
    grid.act(() => void pasteText(grid.state(), grid.state().actions, text));
  };

  it("writes the pasted cells down from the target, addressed by row id", async () => {
    const grid = await mountMode(mode);
    const [first, second] = grid.viewIds();
    paste(grid, "70\n80");
    expect(grid.cell(first!, "n")).toBe(70);
    expect(grid.cell(second!, "n")).toBe(80);
  });

  it("follows the displayed order when the grid sorts, and the server order under sortMode server", async () => {
    const grid = await mountMode(mode);
    grid.setSorts([{ columnId: "n", direction: "desc" }]);
    const top = grid.viewIds()[0]!;
    paste(grid, "500");
    expect(grid.cell(top, "n")).toBe(500);
    expect(top).toBe({ SS: "r0", PC: "r3", PS: "r3" }[mode as "SS"] ?? "r5");
  });

  it("processPaste can veto the whole paste", async () => {
    const grid = await mountMode(mode, { props: { processPaste: () => false } });
    paste(grid, "9");
    expect(grid.cell(grid.viewIds()[0]!, "n")).not.toBe(9);
    expect(grid.changes).toHaveLength(0);
  });

  it("processCellFromClipboard replaces the parsed value", async () => {
    const grid = await mountMode(mode, { props: { processCellFromClipboard: () => 42 } });
    paste(grid, "9");
    expect(grid.cell(grid.viewIds()[0]!, "n")).toBe(42);
  });

  it("a readOnly grid ignores a paste", async () => {
    const grid = await mountMode(mode, { props: { readOnly: true } });
    paste(grid, "9");
    expect(grid.changes).toHaveLength(0);
  });
});
