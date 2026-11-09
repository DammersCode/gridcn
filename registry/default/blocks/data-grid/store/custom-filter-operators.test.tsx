import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataGridProvider, type ColumnDef, type CustomFilterOperator, type FilterNode } from "../data-grid";
import { useDataGridSelector } from "../data-grid-sdk";

type Row = { id: string; city: string; rank: string };

const data: Row[] = [
  { id: "1", city: "Berlin", rank: "low" },
  { id: "2", city: "Tokyo", rank: "high" },
  { id: "3", city: "Paris", rank: "mid" },
];
const regions: Record<string, string> = { Berlin: "eu", Paris: "eu", Tokyo: "asia" };
const inRegion: CustomFilterOperator = { id: "inRegion", label: "in region", match: (text, filter) => regions[text] === filter.value };
const ranks = ["low", "mid", "high"];

const columns = (operator: CustomFilterOperator = inRegion): ColumnDef<Row, unknown>[] => [
  { id: "city", header: "City", accessorKey: "city", filter: { operators: ["contains", operator] } },
  { id: "rank", header: "Rank", accessorKey: "rank", filter: { operators: ["gt"], compare: (a, b) => ranks.indexOf(a) - ranks.indexOf(b) } },
];

afterEach(cleanup);

function viewOf(filterState: FilterNode[], props: { filterMode?: "client" | "server"; cols?: ColumnDef<Row, unknown>[] } = {}) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DataGridProvider data={data} columns={props.cols ?? columns()} getRowId={(row: Row) => row.id} filterMode={props.filterMode} filterState={filterState}>
      {children}
    </DataGridProvider>
  );
  return renderHook(() => useDataGridSelector((s) => s.viewIndex), { wrapper }).result.current;
}

describe("custom filter operators in the view", () => {
  it("filters local rows through the column's registered matcher", () => {
    expect(viewOf([{ columnId: "city", operator: "inRegion", value: "eu" }])).toEqual([0, 2]);
  });

  it("orders gt through the column's filter.compare", () => {
    expect(viewOf([{ columnId: "rank", operator: "gt", value: "low" }])).toEqual([1, 2]);
  });

  it("never evaluates the matcher with filterMode=server", () => {
    const match = vi.fn(() => false);
    const view = viewOf([{ columnId: "city", operator: "inRegion", value: "eu" }], { filterMode: "server", cols: columns({ id: "inRegion", label: "in region", match }) });
    expect(view).toEqual([0, 1, 2]);
    expect(match).not.toHaveBeenCalled();
  });

  it("keeps every row for an operator without a matcher", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const view = viewOf([{ columnId: "city", operator: "inRegion", value: "eu" }], { cols: columns({ id: "inRegion", label: "in region" }) });
    expect(view).toEqual([0, 1, 2]);
    vi.restoreAllMocks();
  });
});
