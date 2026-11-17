import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid } from "../data-grid";
import "@/app/global.css";

type Row = { id: string };

const columns = [{ id: "id", header: "ID", accessorKey: "id" as const, type: "text" as const, width: 120 }];
const data: Row[] = Array.from({ length: 5000 }, (_, i) => ({ id: `row-${i}` }));

describe("grid without a bounded height", () => {
  it("takes the fallback height and keeps every row reachable", async () => {
    const view = await render(<DataGrid data={data} columns={columns} getRowId={(r) => r.id} aria-label="Rows" />);
    const grid = view.container.querySelector<HTMLElement>('[role="grid"]')!;
    await expect.poll(() => grid.hasAttribute("data-grid-unbounded")).toBe(true);
    expect(grid.clientHeight).toBeLessThanOrEqual(window.innerHeight);
    grid.scrollTop = grid.scrollHeight;
    await expect.poll(() => grid.querySelector('[role="row"][aria-rowindex="5001"], [role="row"][aria-rowindex="5002"]') !== null).toBe(true);
  });
});
