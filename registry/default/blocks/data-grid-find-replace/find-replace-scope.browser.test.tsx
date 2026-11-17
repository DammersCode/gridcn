import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns, type DeepPartialLabels } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridFindReplace, type UseDataGridFindReplaceOptions } from "./use-data-grid-find-replace";
import "@/app/global.css";

type Row = { id: string; name: string };

const rows: Row[] = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, name: `item ${i}` }));
const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 200 }] as const);

function Harness({ grid = {}, ...options }: UseDataGridFindReplaceOptions & { grid?: { totalRowCount?: number | null; sortMode?: "server"; labels?: DeepPartialLabels } }) {
  const findReplace = useDataGridFindReplace(options);
  return (
    <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} plugins={[findReplace.plugin]} {...grid}>
      <DataGridRoot className="h-[300px]">
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>
  );
}

async function open(): Promise<void> {
  await page.getByRole("gridcell").first().click();
  await userEvent.keyboard("{Control>}f{/Control}");
  await expect.element(page.getByRole("textbox", { name: "Find" })).toHaveFocus();
}

describe("find and replace scope note", () => {
  it("is absent on a local grid", async () => {
    await render(<Harness />);
    await open();
    await expect.element(page.getByText("Searches loaded rows only")).not.toBeInTheDocument();
  });

  it.each([
    ["a totalRowCount (server pagination and scroll rows)", { totalRowCount: 100 }],
    ["an unknown totalRowCount", { totalRowCount: null }],
    ["server sort", { sortMode: "server" as const }],
  ])("shows on a grid with %s and describes the Find field", async (_name, grid) => {
    await render(<Harness grid={grid} />);
    await open();
    const note = page.getByText("Searches loaded rows only");
    await expect.element(note).toBeInTheDocument();
    const find = page.getByRole("textbox", { name: "Find" }).element();
    expect(find.getAttribute("aria-describedby")).toBe(note.element().id);
  });

  it("findScope result on a grid that holds every row keeps the loaded note out and the position line", async () => {
    await render(<Harness findScope="result" />);
    await open();
    await userEvent.keyboard("item");
    await expect.element(page.getByText("Searches every row of the result")).not.toBeInTheDocument();
    await expect.element(page.getByText("1 of 10 cells")).toBeInTheDocument();
  });

  it("findScope result on a server grid shows the result note and keeps Replace all to loaded rows", async () => {
    await render(<Harness findScope="result" grid={{ totalRowCount: 100 }} />);
    await open();
    await expect.element(page.getByText("Searches every row of the result")).toBeInTheDocument();
    await expect.element(page.getByText("Searches loaded rows only")).not.toBeInTheDocument();
  });

  it("an empty labels.findReplace.scopeLoadedRows hides it", async () => {
    await render(<Harness grid={{ totalRowCount: 100, labels: { findReplace: { scopeLoadedRows: "" } } }} />);
    await open();
    await expect.element(page.getByRole("textbox", { name: "Find" })).toBeInTheDocument();
    await expect.element(page.getByText("Searches loaded rows only")).not.toBeInTheDocument();
  });

});
