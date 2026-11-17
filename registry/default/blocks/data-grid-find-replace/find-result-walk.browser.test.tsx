import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridServerRows, type ServerRowsAnswer, type ServerRowsRequest } from "@/registry/default/blocks/data-grid-server/use-data-grid-server-rows";
import { useDataGridFindReplace } from "./use-data-grid-find-replace";
import "@/app/global.css";

type Row = { id: string; name: string };

const stored: Row[] = Array.from({ length: 95 }, (_, i) => ({ id: `r${i}`, name: `Name ${i}` }));
const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 200 }] as const);

function fetchRows({ spec, start, end }: ServerRowsRequest): Promise<ServerRowsAnswer<Row>> {
  const matching = stored.filter((row) => row.name.includes(spec.searchText));
  return Promise.resolve({ rows: matching.slice(start, end), totalRowCount: matching.length });
}

function Server() {
  const server = useDataGridServerRows<Row>({ mode: "scroll", getRowId: (row) => row.id, fetchRows, blockSize: 10, overscan: 0 });
  const findReplace = useDataGridFindReplace({ findScope: "result" });
  const { plugins, ...providerProps } = server.providerProps;
  return (
    <DataGridProvider columns={columns} {...providerProps} plugins={[...(plugins ?? []), findReplace.plugin]}>
      <DataGridRoot className="h-[200px]" {...server.rootProps}>
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>
  );
}

function Sibling() {
  return (
    <DataGridProvider data={stored.slice(0, 5)} columns={columns} getRowId={(row) => row.id}>
      <DataGridRoot className="h-[120px]" aria-label="Sibling grid">
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>
  );
}

describe("find over the server result", () => {
  it("keeps focus in Find when Next crosses a block boundary, and a sibling grid stays untouched", async () => {
    await render(
      <>
        <Server />
        <Sibling />
      </>,
    );
    await expect.element(page.getByRole("gridcell").first()).toBeInTheDocument();
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Control>}f{/Control}");
    const find = page.getByRole("textbox", { name: "Find" });
    await expect.element(find).toHaveFocus();

    await userEvent.keyboard("Name 7");
    for (let step = 0; step < 6; step += 1) {
      await userEvent.keyboard("{Enter}");
      await expect.element(find).toHaveFocus();
    }

    const sibling = document.querySelector<HTMLElement>('[aria-label="Sibling grid"]')!;
    expect(sibling.querySelector('[role="gridcell"][data-active]')).toBeNull();
  });
});
