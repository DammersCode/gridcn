import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import DataGridDemo from "@/registry/default/examples/data-grid-demo";
import { GRID_ATTR, gridAttrSelector } from "../data-grid";

function cellAt(row: number, col: number): HTMLElement {
  const el = document.querySelector(`[role="row"][${GRID_ATTR.rowIndex}="${row}"] [role="gridcell"][aria-colindex="${col + 2}"]`);
  if (!el) throw new Error(`cell ${row},${col} not found`);
  return el as HTMLElement;
}

describe("overlay paint order", () => {
  // Cells are position:relative since #80, which puts them in the positioned paint phase. An
  // unpositioned overlay paints below their opaque backgrounds — invisible despite correct
  // computed color (found via pixel screenshots, 2026-08-02). Every overlay rect must therefore
  // be positioned itself; DOM order (overlays render after rows) then puts it above plain cells
  // while pinned cells (z-1) and the active ring (z-10) keep their documented layering.
  it("selection overlay is positioned and spans the keyboard-extended range", async () => {
    render(<DataGridDemo />);
    await new Promise((r) => setTimeout(r, 300));

    await userEvent.click(cellAt(1, 0));
    await userEvent.keyboard("{Shift>}{ArrowDown}{ArrowDown}{ArrowRight}{/Shift}");
    await userEvent.unhover(cellAt(1, 0));
    await new Promise((r) => setTimeout(r, 100));

    const overlay = document.querySelector(gridAttrSelector("selectionOverlay")) as HTMLElement | null;
    expect(overlay).not.toBeNull();
    console.log("DIAG className:", overlay!.className, "| computed position:", getComputedStyle(overlay!).position);
    expect(getComputedStyle(overlay!).position).toBe("relative");

    const rect = overlay!.getBoundingClientRect();
    const topCell = cellAt(1, 0).getBoundingClientRect();
    const bottomCell = cellAt(3, 0).getBoundingClientRect();
    expect(Math.abs(rect.top - topCell.top)).toBeLessThan(2);
    expect(Math.abs(rect.bottom - bottomCell.bottom)).toBeLessThan(2);
  });
});
