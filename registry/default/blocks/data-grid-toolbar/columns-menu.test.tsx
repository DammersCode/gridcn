import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("shows a hidden hideable false column unchecked and lets the click show it", async () => {
    const hiddenKey = defineColumns<Row>()([
      { id: "name", header: "Name", accessorKey: "name", hideable: false, hidden: true },
      { id: "note", header: "Note", accessorKey: "note" },
    ] as const);
    render(
      <DataGridProvider defaultData={[]} columns={hiddenKey} getRowId={(r: Row) => r.id}>
        <DataGridColumnsMenu />
      </DataGridProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /columns/i }));
    const name = await screen.findByRole("menuitemcheckbox", { name: "Name" });
    expect(name.getAttribute("aria-checked")).toBe("false");
    expect(name.hasAttribute("data-disabled")).toBe(false);
    fireEvent.click(name);
    await vi.waitFor(() => expect(screen.getByRole("menuitemcheckbox", { name: "Name" }).getAttribute("aria-checked")).toBe("true"));
    expect(screen.getByRole("menuitemcheckbox", { name: "Name" }).hasAttribute("data-disabled")).toBe(true);
  });

  it("marks a hidden column that still has a filter or sort, and no other", async () => {
    const cols = defineColumns<Row>()([
      { id: "name", header: "Name", accessorKey: "name", hidden: true },
      { id: "note", header: "Note", accessorKey: "note", hidden: true },
    ] as const);
    render(
      <DataGridProvider defaultData={[]} columns={cols} getRowId={(r: Row) => r.id} defaultSortState={[{ columnId: "name", direction: "asc" }]}>
        <DataGridColumnsMenu />
      </DataGridProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /columns/i }));
    const name = await screen.findByRole("menuitemcheckbox", { name: /Name/ });
    expect(name.textContent).toContain("Filtered or sorted");
    expect(screen.getByRole("menuitemcheckbox", { name: /Note/ }).textContent).not.toContain("Filtered or sorted");
  });
});
