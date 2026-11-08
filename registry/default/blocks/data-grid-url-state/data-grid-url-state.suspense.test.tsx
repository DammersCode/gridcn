import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataGridProvider, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridUrlState } from "./data-grid-url-state";

vi.mock("nuqs", () => ({
  useQueryState: () => {
    throw new Promise(() => {});
  },
}));

afterEach(cleanup);

const columns = defineColumns<{ id: string }>()([{ id: "id", header: "Id", accessorKey: "id", type: "text", width: 100 }] as const);

describe("DataGridUrlState", () => {
  it("keeps the rest of the tree rendered while the URL read suspends", () => {
    render(
      <DataGridProvider data={[{ id: "r1" }]} columns={columns} getRowId={(r) => r.id}>
        <DataGridUrlState />
        <p>sibling</p>
      </DataGridProvider>,
    );
    expect(screen.getByText("sibling")).toBeInTheDocument();
  });
});
