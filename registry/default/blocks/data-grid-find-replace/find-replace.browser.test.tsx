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
import { DataGridSearch } from "@/registry/default/blocks/data-grid-toolbar/search";
import { useDataGridFindReplace } from "./use-data-grid-find-replace";
import "@/app/global.css";

type Row = { id: string; name: string };

const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, name: i % 10 === 5 ? `needle ${i}` : `item ${i}` }));
const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 200 }] as const);

function Harness({ readOnly = false, withToolbar = false, scope }: { readOnly?: boolean; withToolbar?: boolean; scope?: "view" | "selection" } = {}) {
  const findReplace = useDataGridFindReplace({ scope });
  return (
    <div style={{ height: 400 }}>
      <button type="button" onClick={() => findReplace.open()}>
        Open find
      </button>
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} plugins={[findReplace.plugin]} readOnly={readOnly}>
        {withToolbar && <DataGridSearch />}
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

  it("Ctrl+F with the grid focused opens Find only, without a Replace field", async () => {
    await render(<Harness />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Control>}f{/Control}");
    await expect.element(page.getByRole("textbox", { name: "Find" })).toHaveFocus();
    await expect.element(page.getByRole("textbox", { name: "Replace with" })).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Toggle replace" })).toHaveAttribute("aria-expanded", "false");
  });

  it("the chevron toggles the Replace row", async () => {
    await render(<Harness />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Control>}f{/Control}");
    const toggle = page.getByRole("button", { name: "Toggle replace" });
    await toggle.click();
    await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
    await expect.element(page.getByRole("textbox", { name: "Replace with" })).toBeInTheDocument();
    await toggle.click();
    await expect.element(page.getByRole("textbox", { name: "Replace with" })).not.toBeInTheDocument();
  });

  it("Ctrl+H opens expanded", async () => {
    await render(<Harness />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Control>}h{/Control}");
    await expect.element(page.getByRole("textbox", { name: "Replace with" })).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Toggle replace" })).toHaveAttribute("aria-expanded", "true");
  });

  it("Ctrl+F outside the grid does not open the panel", async () => {
    await render(<Harness />);
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    const event = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
    outside.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    outside.remove();
  });

  it("a read-only grid has no toggle and no Replace field", async () => {
    await render(<Harness readOnly />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Control>}f{/Control}");
    await expect.element(page.getByRole("textbox", { name: "Find" })).toHaveFocus();
    await expect.element(page.getByRole("button", { name: "Toggle replace" })).not.toBeInTheDocument();
    await expect.element(page.getByRole("textbox", { name: "Replace with" })).not.toBeInTheDocument();
  });

  it("Find text shows in the toolbar search and focus stays in the panel", async () => {
    await render(<Harness withToolbar />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Control>}f{/Control}");
    await expect.element(page.getByRole("textbox", { name: "Find" })).toHaveFocus();
    await userEvent.keyboard("needle");
    await expect.element(page.getByLabelText("Search grid")).toHaveValue("needle");
    await expect.element(page.getByRole("textbox", { name: "Find" })).toHaveFocus();
  });

  it("Ctrl+F seeds Find from the toolbar search and both fields follow each other", async () => {
    await render(<Harness withToolbar />);
    const toolbar = page.getByLabelText("Search grid");
    await toolbar.fill("needle");
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Control>}f{/Control}");
    const find = page.getByRole("textbox", { name: "Find" });
    await expect.element(find).toHaveValue("needle");
    await expect.element(find).toHaveFocus();
    await expect.element(page.getByRole("dialog").getByRole("status")).toHaveTextContent("1 of 3");
    await toolbar.fill("item 1");
    await expect.element(find).toHaveValue("item 1");
    await find.fill("item 2");
    await expect.element(toolbar).toHaveValue("item 2");
  });

  it("clicking Replace all keeps the cell range, so scope selection replaces only inside it", async () => {
    await render(<Harness scope="selection" />);
    const cells = page.getByRole("gridcell");
    await cells.nth(1).click();
    await userEvent.keyboard("{Shift>}{ArrowDown}{ArrowDown}{/Shift}");
    await userEvent.keyboard("{Control>}h{/Control}");
    await userEvent.keyboard("item");
    await userEvent.keyboard("{Tab}{Tab}");
    await userEvent.keyboard("x");
    await page.getByRole("button", { name: "Replace all" }).click();
    const texts = Array.from(document.querySelectorAll('[role="gridcell"]')).map((c) => c.textContent);
    expect(texts.slice(0, 5)).toEqual(["item 0", "x 1", "x 2", "x 3", "item 4"]);
  });
});
