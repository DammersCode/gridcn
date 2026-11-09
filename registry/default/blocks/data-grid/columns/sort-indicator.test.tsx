import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataGridProvider } from "../store";
import { DataGridSortIndicator } from "./sort-indicator";

const columns = [{ id: "score", header: "Score", accessorKey: "score" as const }];
const data = [{ id: "a", score: 1 }];

describe("DataGridSortIndicator", () => {
  it("reads the sort from the provider", () => {
    const { container } = render(
      <DataGridProvider data={data} columns={columns} sortState={[{ columnId: "score", direction: "desc" }]}>
        <DataGridSortIndicator columnId="score" />
      </DataGridProvider>,
    );
    expect(container.querySelector("[data-grid-sort-indicator='desc']")).not.toBeNull();
  });

  it("prefers an explicit sortState", () => {
    const { container } = render(
      <DataGridProvider data={data} columns={columns} sortState={[{ columnId: "score", direction: "desc" }]}>
        <DataGridSortIndicator columnId="score" sortState={[{ columnId: "score", direction: "asc" }]} />
      </DataGridProvider>,
    );
    expect(container.querySelector("[data-grid-sort-indicator='asc']")).not.toBeNull();
  });

  it("merges a className onto the root", () => {
    const { container } = render(
      <DataGridProvider data={data} columns={columns} sortState={[{ columnId: "score", direction: "desc" }]}>
        <DataGridSortIndicator columnId="score" className="text-primary" />
      </DataGridProvider>,
    );
    expect(container.querySelector("[data-grid-sort-indicator='desc']")?.className).toContain("text-primary");
  });

  it("renders nothing outside a provider", () => {
    const { container } = render(<DataGridSortIndicator columnId="score" />);
    expect(container.innerHTML).toBe("");
  });
});
