import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataGrid } from "./data-grid";
import type { ColumnDef } from "./types";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const data: Row[] = [{ id: "a", name: "A" }];

describe("DataGrid root props", () => {
  it("names the grid with aria-label", () => {
    const { container } = render(<DataGrid data={data} columns={columns} getRowId={(r: Row) => r.id} aria-label="Tasks" />);
    expect(container.querySelector('[role="grid"]')?.getAttribute("aria-label")).toBe("Tasks");
  });

  it("names the grid with aria-labelledby", () => {
    const { container } = render(<DataGrid data={data} columns={columns} getRowId={(r: Row) => r.id} aria-labelledby="title" />);
    expect(container.querySelector('[role="grid"]')?.getAttribute("aria-labelledby")).toBe("title");
  });
});
