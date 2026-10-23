import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridFindReplace } from "./use-data-grid-find-replace";
import "@/app/global.css";

type Row = { id: string; name: string };

const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, name: i % 10 === 5 ? `needle ${i}` : `item ${i}` }));
const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 200 }] as const);

function Harness() {
  const findReplace = useDataGridFindReplace();
  return (
    <div style={{ height: 400 }}>
      <button type="button" onClick={() => findReplace.open()}>
        Open find
      </button>
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} plugins={[findReplace.plugin]}>
        <DataGridRoot className="h-[400px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}

describe("find and replace in a browser", () => {
  it("Ctrl+H opens the panel with focus in Find, and Escape returns focus to the grid", async () => {
    await render(<Harness />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Control>}h{/Control}");
    const find = page.getByRole("textbox", { name: "Find" });
    await expect.element(find).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement?.closest('[role="grid"]')).not.toBeNull();
  });

  it("Enter in Find moves the active cell to the next match", async () => {
    await render(<Harness />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Control>}h{/Control}");
    await userEvent.keyboard("needle");
    await expect.element(page.getByRole("dialog").getByRole("status")).toHaveTextContent("1 of 3");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("dialog").getByRole("status")).toHaveTextContent("2 of 3");
  });

  it("Escape leaves focus alone when the panel was not opened from the grid", async () => {
    await render(<Harness />);
    await page.getByRole("button", { name: "Open find" }).click();
    await expect.element(page.getByRole("textbox", { name: "Find" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement?.closest('[role="grid"]')).toBeNull();
  });
});
