import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ColumnDef } from "../types";
import { DataGrid } from "../data-grid";

type Row = { id: string; a: string; b: string };
const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "a", header: "A", accessorKey: "a" },
  { id: "b", header: "B", accessorKey: "b" },
];

afterEach(cleanup);
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 360 });
});

describe("Tab bound to a move", () => {
  it("moves inside the grid and leaves Tab to the browser at the edge", () => {
    render(<DataGrid data={[{ id: "1", a: "x", b: "y" }]} columns={columns} keymap={{ moveRight: ["Tab"], moveLeft: ["shift+Tab"] }} />);
    const grid = screen.getByRole("grid");
    fireEvent.pointerDown(screen.getAllByRole("gridcell")[0]!, { button: 0 });
    expect(fireEvent.keyDown(grid, { key: "Tab" })).toBe(false);
    expect(fireEvent.keyDown(grid, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(grid, { key: "Tab", shiftKey: true })).toBe(false);
    expect(fireEvent.keyDown(grid, { key: "Tab", shiftKey: true })).toBe(true);
  });
});
