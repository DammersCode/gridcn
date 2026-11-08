import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DataGridProvider, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridColumnsMenu } from "./columns-menu";

type Row = { id: string; name: string; note: string };

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", hideable: false },
  { id: "note", header: "Note", accessorKey: "note" },
] as const);

afterEach(cleanup);

describe("DataGridColumnsMenu", () => {
  it("shows a column with hideable false checked and disabled", async () => {
    render(
      <DataGridProvider defaultData={[]} columns={columns} getRowId={(r: Row) => r.id}>
        <DataGridColumnsMenu />
      </DataGridProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /columns/i }));
    const name = await screen.findByRole("menuitemcheckbox", { name: "Name" });
    expect(name.getAttribute("aria-checked")).toBe("true");
    expect(name.hasAttribute("data-disabled")).toBe(true);
    expect(screen.getByRole("menuitemcheckbox", { name: "Note" }).hasAttribute("data-disabled")).toBe(false);
  });
});
