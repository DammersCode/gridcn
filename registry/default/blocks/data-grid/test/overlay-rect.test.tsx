import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DataGrid, type ColumnDef, type DataGridPlugin, type OverlayPluginCtx } from "../data-grid";
import { OverlayRect } from "../data-grid-sdk";

type Row = { id: string; a: string; b: string };
const rows: Row[] = [
  { id: "1", a: "x", b: "y" },
  { id: "2", a: "x", b: "y" },
];

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 360 });
});
afterEach(cleanup);

function tint(y: number): DataGridPlugin {
  return { name: "tint", Overlay: (ctx: OverlayPluginCtx) => <OverlayRect ctx={ctx} rect={{ x: 0, y, width: ctx.colCount, height: 1 }} className="tint bg-primary/10" /> };
}

const parts = () => [...document.querySelectorAll<HTMLElement>(".tint")];

describe("OverlayRect", () => {
  it("places one hidden, click-through part on the grid lines of the row", () => {
    const columns: ColumnDef<Row, unknown>[] = [{ id: "a", header: "A", accessorKey: "a" }, { id: "b", header: "B", accessorKey: "b" }];
    render(<DataGrid data={rows} columns={columns} getRowId={(r) => r.id} plugins={[tint(1)]} />);
    const [part] = parts();
    expect(parts()).toHaveLength(1);
    expect(part!.getAttribute("aria-hidden")).toBe("true");
    expect(part!.className).toContain("pointer-events-none");
    expect(part!.style.gridColumnEnd).toBe("3");
    expect(part!.style.gridRowStart).not.toBe("");
  });

  it("splits at a pinned column and lifts the pinned part above pinned cells", () => {
    const columns: ColumnDef<Row, unknown>[] = [{ id: "a", header: "A", accessorKey: "a", pin: "start" }, { id: "b", header: "B", accessorKey: "b" }];
    render(<DataGrid data={rows} columns={columns} getRowId={(r) => r.id} plugins={[tint(0)]} />);
    expect(parts()).toHaveLength(2);
    expect(parts().filter((p) => p.hasAttribute("data-pinned"))).toHaveLength(1);
  });

  it("renders nothing for a row outside the rendered rows", () => {
    const columns: ColumnDef<Row, unknown>[] = [{ id: "a", header: "A", accessorKey: "a" }];
    render(<DataGrid data={rows} columns={columns} getRowId={(r) => r.id} plugins={[tint(50)]} />);
    expect(parts()).toHaveLength(0);
  });
});
