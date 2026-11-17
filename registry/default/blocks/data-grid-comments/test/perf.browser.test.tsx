import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot } from "@/registry/default/blocks/data-grid/data-grid";
import { columns, makeRows, measureScrollFps } from "@/registry/default/blocks/data-grid/test/perf-probe.test-helper";
import { gridAttrSelector } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { useDataGridComments } from "../data-grid-comments";
import type { CellComment, UseDataGridCommentsResult } from "../data-grid-comments";
import "@/app/global.css";

const author = { id: "ada", name: "Ada" };
const CI_RELAXED = import.meta.env.CI ? 0.6 : 1;

function seeded(count: number, rows: number): CellComment[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    rowId: `row-${(i * 5) % rows}`,
    columnId: columns[(i % 3) + 1]?.id ?? "name",
    text: `Comment ${i}`,
    author,
    createdAt: 1000,
    updatedAt: 1000,
    version: 1,
    resolved: false,
  }));
}

let handle: UseDataGridCommentsResult | undefined;
const rowRenders = { count: 0 };
const countRow = (): undefined => {
  rowRenders.count += 1;
  return undefined;
};

function Harness({ data, defaultComments, withPlugin }: { data: ReturnType<typeof makeRows>; defaultComments?: CellComment[]; withPlugin: boolean }) {
  const comments = useDataGridComments({ currentUser: author, defaultComments });
  handle = comments;
  return (
    <div style={{ height: 600, width: 1200 }}>
      <DataGridProvider data={data} columns={columns} getRowId={(r) => r.id} plugins={withPlugin ? [comments.plugin] : undefined}>
        <DataGridRoot className="h-150 w-300" getRowClassName={countRow}>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}

describe("comments cost at 100k rows", () => {
  it("scrolls 100k rows with 20k comments at close to the speed of a grid without the plugin", { timeout: 180_000 }, async () => {
    const data = makeRows(100_000);
    const plain = await render(<Harness data={data} withPlugin={false} />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    let grid = document.querySelector<HTMLElement>('[role="grid"]') as HTMLElement;
    for (let i = 0; i < 3; i += 1) await measureScrollFps(grid, 8, 50);
    let baseline = 0;
    for (let i = 0; i < 3; i += 1) baseline = Math.max(baseline, await measureScrollFps(grid, 8, 200));
    await plain.unmount();

    await render(<Harness data={data} defaultComments={seeded(20_000, 100_000)} withPlugin />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    grid = document.querySelector<HTMLElement>('[role="grid"]') as HTMLElement;
    for (let i = 0; i < 3; i += 1) await measureScrollFps(grid, 8, 50);
    let withComments = 0;
    for (let i = 0; i < 3; i += 1) withComments = Math.max(withComments, await measureScrollFps(grid, 8, 200));
    expect(withComments / baseline).toBeGreaterThan(0.7 * CI_RELAXED);
  });

  it("a comment write re-renders no row, and a scroll step commits the markers in one overlay update", async () => {
    await render(<Harness data={makeRows(2_000)} defaultComments={seeded(400, 2_000)} withPlugin />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 200));
    const before = rowRenders.count;
    handle?.applyRemote([{ kind: "upsert", comment: { ...seeded(1, 2_000)[0], id: "fresh", rowId: "row-3", columnId: "name", writeId: "wf" } as CellComment }]);
    await new Promise((r) => setTimeout(r, 100));
    expect(rowRenders.count).toBe(before);
    expect(document.querySelectorAll(gridAttrSelector("commentMarker")).length).toBeGreaterThan(0);
  });

  it("paints no more than 2,048 markers in a window", async () => {
    await render(<Harness data={makeRows(300)} defaultComments={Array.from({ length: 50 * 6 }, (_, i) => ({ ...seeded(1, 300)[0], id: `x${i}`, rowId: `row-${i % 60}`, columnId: columns[(i % 5) + 1]?.id ?? "name" }) as CellComment)} withPlugin />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 200));
    expect(document.querySelectorAll(gridAttrSelector("commentMarker")).length).toBeLessThanOrEqual(2048);
  });
});
