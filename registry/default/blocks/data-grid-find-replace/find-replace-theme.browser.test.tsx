import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridFindReplace } from "./use-data-grid-find-replace";
import "@/app/global.css";

type Row = { id: string; name: string };

const rows: Row[] = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, name: `item ${i}` }));
const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 200 }] as const);

function Harness() {
  const findReplace = useDataGridFindReplace();
  return (
    <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} plugins={[findReplace.plugin]}>
      <DataGridRoot className="h-[300px]">
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>
  );
}

describe("find and replace panel surface", () => {
  afterEach(() => document.documentElement.style.removeProperty("--radius"));

  it("matches the Popover surface: --radius corners, a ring instead of a border", async () => {
    document.documentElement.style.setProperty("--radius", "1rem");
    await render(<Harness />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Control>}h{/Control}");
    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const style = getComputedStyle(panel);
    expect(parseFloat(style.borderTopLeftRadius)).toBe(16);
    expect(style.borderTopWidth).toBe("0px");
    expect(style.boxShadow).not.toBe("none");
  });
});
