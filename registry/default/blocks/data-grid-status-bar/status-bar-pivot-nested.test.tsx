import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DataGridProvider, useDataGridActions } from "@/registry/default/blocks/data-grid/data-grid";
import type { ServerGroupLayout } from "@/registry/default/blocks/data-grid/group-types";
import { nestedPivotColumns, threeLevelLayout, twoLevelLayout, viewRowsOf } from "@/registry/default/blocks/data-grid/test/nested-pivot.test-helper";
import { DataGridStatusBar } from "./status-bar";

afterEach(cleanup);

let actions: ReturnType<typeof useDataGridActions> | null = null;
function Probe() {
  actions = useDataGridActions();
  return null;
}

function renderBar(layout: ServerGroupLayout, groupBy: string[], extra: Record<string, unknown> = {}) {
  const props = {
    data: Array.from({ length: viewRowsOf(layout) }, () => undefined),
    columns: nestedPivotColumns,
    getRowId: (_r: unknown, i: number) => `slot-${i}`,
    groupBy,
    groupLayout: layout,
    enableRowSelection: true,
    ...extra,
  } as unknown as Parameters<typeof DataGridProvider>[0];
  render(
    <DataGridProvider {...props}>
      <Probe />
      <DataGridStatusBar />
    </DataGridProvider>,
  );
}

const select = (from: { row: number; col: number }, to: { row: number; col: number }) => {
  act(() => {
    actions!.selectCellAt(from);
    actions!.extendToAt(to);
  });
  return screen.getByRole("status").textContent ?? "";
};

describe("DataGridStatusBar on nested pivot rows", () => {
  it("counts and sums the pivot cells of every depth and never the labels", () => {
    renderBar(threeLevelLayout(), ["region", "country", "city"]);
    const text = select({ row: 0, col: 0 }, { row: 3, col: 3 });
    expect(text).toContain("Count 12");
    expect(text).toContain("Sum 111");
    expect(text).toContain("Min 1");
    expect(text).toContain("Max 30");
  });

  it("skips a lazy hole, a pivot row whose cells did not land, and an empty pivot cell", () => {
    renderBar(twoLevelLayout(), ["region", "country"]);
    expect(select({ row: 2, col: 0 }, { row: 4, col: 3 })).toContain("Count 2");
  });
});
