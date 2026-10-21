import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { useLayoutEffect, useRef } from "react";
import { DataGrid } from "../data-grid";
import { makeRows } from "./perf-probe.test-helper";
import { firstRowHeight, gridElement, mountedRows, settle } from "./scroll-origin.test-helper";
import "@/app/global.css";

type Sample = { viewRowIndex: number; top: number; row: HTMLElement };
const samples: Sample[] = [];

function Probe({ viewRowIndex }: { viewRowIndex: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const row = ref.current?.closest<HTMLElement>('[role="row"]');
    if (row) samples.push({ viewRowIndex, top: row.getBoundingClientRect().top, row });
  }, [viewRowIndex]);
  return <span ref={ref} />;
}

const columns = Array.from({ length: 3 }, (_, i) => ({
  id: `c${i}`,
  header: `Col ${i}`,
  accessorKey: "name" as const,
  type: "text" as const,
  width: 150,
  ...(i === 0 ? { renderCell: ({ viewRowIndex }: { viewRowIndex: number }) => <Probe viewRowIndex={viewRowIndex} /> } : {}),
}));

describe("rows canvas offset", () => {
  it("is already correct when a child layout effect reads a mounted row after a far jump", async () => {
    await render(
      <div style={{ height: 400, width: 800 }}>
        <DataGrid data={makeRows(100_000)} columns={columns} getRowId={(r) => r.id} className="h-100 w-200" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = gridElement();
    const rowHeight = firstRowHeight();
    samples.length = 0;

    grid.scrollTop = Math.round(0.75 * 100_000) * rowHeight;
    await settle();

    const jumped = samples.filter((s) => s.row.isConnected);
    expect(jumped.length).toBeGreaterThan(5);
    expect(mountedRows().length).toBeGreaterThan(0);
    for (const sample of jumped) {
      expect(Math.abs(sample.top - sample.row.getBoundingClientRect().top)).toBeLessThanOrEqual(1);
    }
  });
});
