import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns, type ColumnGroupDef } from "./data-grid";

type Row = { id: string; revenue: number; region: string };

function Icon() {
  return <svg aria-hidden="true" />;
}

const columns = defineColumns<Row>()([
  { id: "revenue", header: <Icon />, headerText: "Revenue", accessorKey: "revenue", type: "number" },
  { id: "region", header: <Icon />, accessorKey: "region" },
] as const);


const plainColumns = defineColumns<Row>()([{ id: "region", header: "Region", accessorKey: "region" }] as const);

afterEach(cleanup);

function renderGrid(columnGroups?: ColumnGroupDef[], cols: typeof columns | typeof plainColumns = columns) {
  render(
    <DataGridProvider data={[{ id: "r0", revenue: 1, region: "NL" }]} columns={cols} columnGroups={columnGroups}>
      <DataGridRoot>
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>,
  );
}

it("names a node column header by its headerText, else by its id", () => {
  renderGrid();
  expect(screen.getByRole("columnheader", { name: "Revenue" })).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "region" })).toBeTruthy();
});

it("names a node group header by its headerText, else by its id", () => {
  renderGrid([
    { id: "money", header: <Icon />, headerText: "Money", children: ["revenue"] },
    { id: "where", header: <Icon />, children: ["region"] },
  ]);
  expect(screen.getByRole("columnheader", { name: "Money" })).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "where" })).toBeTruthy();
});

it("leaves a string column header named by its content", () => {
  renderGrid(undefined, plainColumns);
  expect(screen.getByRole("columnheader", { name: "Region" }).hasAttribute("aria-label")).toBe(false);
});
