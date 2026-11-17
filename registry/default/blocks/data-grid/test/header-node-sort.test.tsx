import { render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "../types";
import { DataGrid } from "../data-grid";

type Row = { id: string; score: number };
const data: Row[] = [{ id: "a", score: 1 }];
const sort = [{ columnId: "score", direction: "asc" as const }];

function renderGrid(column: Partial<ColumnDef<Row, unknown>>, extra: Record<string, unknown> = {}) {
  const columns: ColumnDef<Row, unknown>[] = [{ id: "score", header: "Score", accessorKey: "score", ...column }];
  return render(<DataGrid data={data} columns={columns} getRowId={(r) => r.id} sortState={sort} className="h-40" {...extra} />);
}

afterEach(() => vi.restoreAllMocks());

describe("node header sort arrow", () => {
  it("draws the arrow for a node header", () => {
    const { container } = renderGrid({ header: <span>Score</span> });
    expect(container.querySelectorAll("[data-grid-sort-indicator]")).toHaveLength(1);
  });

  it("omits the arrow when sortIndicator is false", () => {
    const { container } = renderGrid({ header: <span>Score</span>, sortIndicator: false });
    expect(container.querySelector("[data-grid-sort-indicator]")).toBeNull();
  });

  it("warns once when a node header has no plain text and no headerText", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const Icon = () => <svg />;
    const { rerender } = renderGrid({ header: <Icon /> });
    rerender(<DataGrid data={data} columns={[{ id: "score", header: <Icon />, accessorKey: "score" }]} getRowId={(r) => r.id} sortState={sort} className="h-40" />);
    expect(warn.mock.calls.filter(([m]) => String(m).includes('"score"'))).toHaveLength(1);
  });

  it("does not warn when headerText is set", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderGrid({ header: <svg />, headerText: "Score" });
    expect(warn.mock.calls.filter(([m]) => String(m).includes("node header"))).toHaveLength(0);
  });
});

describe("header filter slot", () => {
  it("keeps hooks working when a component is passed as renderHeaderFilter", () => {
    const Filter = () => {
      const [n] = useState(7);
      return <button type="button" data-testid="hf">{n}</button>;
    };
    const { getByTestId } = renderGrid({ type: "text" }, { renderHeaderFilter: Filter });
    expect(getByTestId("hf").textContent).toBe("7");
  });
});
