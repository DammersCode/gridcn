import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { fakeServer, rowsOf, type Row } from "./group-fake-server.test-helper";
import { useDataGridServerRows, type UseDataGridServerRowsScrollResult } from "./use-data-grid-server-rows";
import "@/app/global.css";

const columns = defineColumns<Row>()([
  { id: "region", header: "Region", accessorKey: "region", type: "text", width: 160 },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", width: 100 },
] as const);

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
const treegrid = () => document.querySelector<HTMLElement>('[role="treegrid"]')!;

function GroupedGrid({ server, onServer }: { server: ReturnType<typeof fakeServer>; onServer: (result: UseDataGridServerRowsScrollResult<Row>) => void }) {
  const result = useDataGridServerRows<Row>({ mode: "scroll", fetchRows: server.fetchRows as never, blockSize: 20, loadDelayMs: 0, defaultSpec: { groupBy: ["region"] } });
  useEffect(() => {
    onServer(result);
  });
  return (
    <div style={{ height: 360, width: 400 }}>
      <DataGridProvider {...result.providerProps} columns={columns}>
        <DataGridRoot className="h-90 w-100" {...result.rootProps}>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}

describe("a grouped server grid in a browser", () => {
  it("keeps the scroll position and shows group rows after the spec changes", async () => {
    const regions = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`R${String(i).padStart(3, "0")}`, 1]));
    const server = fakeServer(rowsOf(regions));
    let latest!: UseDataGridServerRowsScrollResult<Row>;
    await render(<GroupedGrid server={server} onServer={(result) => (latest = result)} />);
    await vi.waitFor(() => expect(treegrid().querySelectorAll("[data-grid-group-row]").length).toBeGreaterThan(3));
    treegrid().scrollTop = 3000;
    treegrid().dispatchEvent(new Event("scroll"));
    await settle();
    expect(treegrid().scrollTop).toBeGreaterThan(2000);
    latest.gridProps.onSortChange?.([{ columnId: "qty", direction: "desc" }]);
    await settle();
    expect(treegrid().scrollTop).toBeGreaterThan(2000);
    expect(treegrid().querySelector("[data-grid-group-row]")).not.toBeNull();
    expect(treegrid().getAttribute("aria-busy")).toBeNull();
  });
});
