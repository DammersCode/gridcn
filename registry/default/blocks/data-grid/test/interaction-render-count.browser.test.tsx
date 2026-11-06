import { page, userEvent } from "vitest/browser";
import { StrictMode } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid } from "../data-grid";
import { columns, makeRows } from "./perf-probe.test-helper";
import "@/app/global.css";

const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

describe("rows re-rendered per navigation key", () => {
  it("re-renders only the rows the active cell leaves and enters, also under StrictMode", async () => {
    const rowRenders = new Map<number, number>();
    const getRowClassName = (_row: unknown, viewRowIndex: number): undefined => {
      rowRenders.set(viewRowIndex, (rowRenders.get(viewRowIndex) ?? 0) + 1);
      return undefined;
    };
    await render(
      <StrictMode>
        <div style={{ height: 500, width: 900 }}>
          <DataGrid data={makeRows(200)} columns={columns} getRowId={(r) => r.id} getRowClassName={getRowClassName} className="h-125 w-225" />
        </div>
      </StrictMode>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await page.getByRole("gridcell").nth(10).click();
    await frame();

    const keys = ["{ArrowDown}", "{ArrowRight}", "{ArrowDown}", "{ArrowLeft}", "{ArrowUp}", "{ArrowRight}"];
    const mountedRows = document.querySelectorAll('[role="row"][data-grid-row-index]').length;
    expect(mountedRows).toBeGreaterThan(8);
    // StrictMode renders each row function twice: two rows, four calls
    for (const key of keys) {
      const before = [...rowRenders.values()].reduce((a, b) => a + b, 0);
      await userEvent.keyboard(key);
      await frame();
      const rendered = [...rowRenders.values()].reduce((a, b) => a + b, 0) - before;
      expect(rendered, `${key}: rows rendered`).toBeLessThanOrEqual(4);
    }
  });
});
