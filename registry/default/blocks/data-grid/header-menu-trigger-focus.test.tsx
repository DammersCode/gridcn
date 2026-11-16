import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns } from "./data-grid";

type Row = { id: string; name: string };

const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 140 }] as const);

afterEach(cleanup);

it("header menu trigger shows a focus ring when focused by keyboard", () => {
  const { container } = render(
    <DataGridProvider data={[{ id: "r0", name: "A" }]} columns={columns} getRowId={(row) => row.id}>
      <DataGridRoot renderHeaderMenu={({ trigger }) => trigger}>
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>,
  );
  const trigger = container.querySelector("[data-grid-header-menu-trigger]");
  expect(trigger).not.toBeNull();
  expect(trigger!.className).toContain("focus-visible:ring-2");
  expect(trigger!.className).not.toContain("outline-none");
});

it("in a zero-row grid without a header filter the trigger is the tab stop and shows the focus ring", () => {
  const { container } = render(
    <DataGridProvider data={[] as Row[]} columns={columns} getRowId={(row) => row.id}>
      <DataGridRoot renderHeaderMenu={({ trigger }) => trigger}>
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>,
  );
  const trigger = container.querySelector("[data-grid-header-menu-trigger]");
  expect(trigger).not.toBeNull();
  expect(trigger!.getAttribute("tabindex")).toBe("0");
  expect(trigger!.className).toContain("focus-visible:ring-2");
});
