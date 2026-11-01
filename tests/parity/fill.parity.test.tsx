import { describe, expect, it } from "vitest";
import { useDataGridFill } from "@/registry/default/blocks/data-grid-fill/use-data-grid-fill";
import { emptySelection } from "@/registry/default/blocks/data-grid/selection";
import { ALL_MODES, mountMode, type MountOptions } from "./modes";

type Grid = Awaited<ReturnType<typeof mountMode>>;

function withFill(): { options: MountOptions; run: (command: "fillDown" | "fillRight") => void } {
  let plugin: ReturnType<typeof useDataGridFill>["plugin"] | null = null;
  return {
    options: {
      useExtra: () => {
        const fill = useDataGridFill();
        plugin = fill.plugin;
        return { plugins: [fill.plugin] };
      },
    },
    run: (command) => void (plugin!.commands as Record<string, { run: (ctx: never) => void }>)[command]!.run({} as never),
  };
}

const selectColumn = (grid: Grid, rows: number) =>
  grid.act(() =>
    grid.store().setState({
      selection: { ...emptySelection(), current: { cell: { col: 1, row: 0 }, range: { x: 1, y: 0, width: 1, height: rows }, rangeStack: [] } },
    }),
  );

describe.each(ALL_MODES)("fill in mode %s", (mode) => {
  it("fillDown copies the top cell of the range into the rows below, by displayed order", async () => {
    const { options, run } = withFill();
    const grid = await mountMode(mode, options);
    grid.setSorts([{ columnId: "n", direction: "desc" }]);
    const [top, second, third] = grid.viewIds();
    const topValue = grid.cell(top!, "n");
    selectColumn(grid, 3);
    grid.act(() => run("fillDown"));
    expect(grid.cell(second!, "n")).toBe(topValue);
    expect(grid.cell(third!, "n")).toBe(topValue);
  });

  it("a readOnly grid does not fill", async () => {
    const { options, run } = withFill();
    const grid = await mountMode(mode, { ...options, props: { readOnly: true } });
    selectColumn(grid, 3);
    grid.act(() => run("fillDown"));
    expect(grid.changes).toHaveLength(0);
  });
});
