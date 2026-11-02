import { useEffect } from "react";
import { userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { StoreProbe } from "@/registry/default/blocks/data-grid/test/store-probe.test-helper";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { useDataGridServerRows, type ServerRowsAnswer, type ServerRowsRequest, type UseDataGridServerRowsScrollResult } from "./use-data-grid-server-rows";
import "@/app/global.css";

type Row = { id: string; name: string };

const columns = defineColumns<Row>()([
  { id: "id", header: "ID", accessorKey: "id", type: "text", width: 120 },
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 180 },
] as const);

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextFrame();
};

describe("the refresh guard in a real grid", () => {
  it("lands an edit in the row that moved while its editor was open, and keeps focus on it", async () => {
    let shift = 0;
    let hold = false;
    const held: Array<() => void> = [];
    const fetchRows = vi.fn(({ start, end }: ServerRowsRequest): Promise<ServerRowsAnswer<Row>> => {
      const rows = Array.from({ length: Math.min(end, 100) - start }, (_, i) => {
        const index = start + i;
        return index < shift ? { id: `new-${index}`, name: `New ${index}` } : { id: `row-${index - shift}`, name: `Person ${index - shift}` };
      });
      const answer = { rows, totalRowCount: 100 };
      if (!hold) return Promise.resolve(answer);
      return new Promise((resolve) => held.push(() => resolve(answer)));
    });
    let server!: UseDataGridServerRowsScrollResult<Row>;
    let store!: StoreApi<DataGridStoreState>;
    function Harness() {
      const result = useDataGridServerRows<Row>({ mode: "scroll", getRowId: (row) => row.id, fetchRows, blockSize: 20, overscan: 5 });
      useEffect(() => {
        server = result;
      });
      return (
        <div style={{ height: 360, width: 400 }}>
          <DataGridProvider {...result.providerProps} columns={columns}>
            <StoreProbe onReady={(api) => (store = api)} />
            <DataGridRoot className="h-90 w-100" {...result.rootProps}>
              <DataGridHeader />
              <DataGridBody />
            </DataGridRoot>
          </DataGridProvider>
        </div>
      );
    }
    await render(<Harness />);
    await vi.waitFor(() => expect(server?.status).toBe("ready"));
    await settle();

    store.getState().actions.startEditing({ rowId: "row-3", columnId: "name" });
    await vi.waitFor(() => expect(document.querySelector('[role="grid"] input')).not.toBeNull());

    hold = true;
    shift = 1;
    server.refresh();
    await vi.waitFor(() => expect(held.length).toBeGreaterThan(0));
    held.splice(0).forEach((resolve) => resolve());
    await vi.waitFor(() => expect(server.gridProps.data[4]?.id).toBe("row-3"));
    await settle();

    await userEvent.keyboard("{Control>}a{/Control}Edited{Enter}");
    await vi.waitFor(() => expect(store.getState().editing).toBeNull());
    expect(server.gridProps.data.find((row) => row?.id === "row-3")?.name).toBe("Edited");
    expect(server.gridProps.data.filter((row) => row?.id === "row-3")).toHaveLength(1);
    const focused = document.activeElement?.closest('[role="row"]');
    expect(focused?.textContent).toContain("row-4");
  });
});
