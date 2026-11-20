import { trackRenders } from "@/registry/default/blocks/data-grid/test/render-counter.test-helper";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns, type ServerSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { fakeServer, rowsOf, type Row } from "./group-fake-server.test-helper";
import { useDataGridServerRows, type UseDataGridServerRowsScrollResult } from "./use-data-grid-server-rows";
import "@/app/global.css";

const columns = defineColumns<Row>()([
  { id: "region", header: "Region", accessorKey: "region", type: "text", width: 160 },
  { id: "city", header: "City", accessorKey: "city", type: "text", width: 120 },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", width: 100, aggregate: "sum" },
] as const);

const SUM = { columnId: "qty", reducer: "sum" } as const;
const treegrid = () => document.querySelector<HTMLElement>('[role="treegrid"]')!;

function Grid({ server, spec, onServer }: { server: ReturnType<typeof fakeServer<Row>>; spec: Partial<ServerSpec>; onServer: (result: UseDataGridServerRowsScrollResult<Row>) => void }) {
  const result = useDataGridServerRows<Row>({ mode: "scroll", fetchRows: server.fetchRows as never, blockSize: 20, loadDelayMs: 0, defaultSpec: spec });
  useEffect(() => {
    onServer(result);
  });
  return (
    <div style={{ height: 360, width: 600 }}>
      <DataGridProvider {...result.providerProps} columns={columns}>
        <DataGridRoot className="h-90 w-150" {...result.rootProps}>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}

async function rendersOverFiveLandings(spec: Partial<ServerSpec>) {
  const tracker = trackRenders();
  const server = fakeServer(rowsOf({ A: 4, B: 3, C: 2 }));
  let latest!: UseDataGridServerRowsScrollResult<Row>;
  await render(<Grid server={server} spec={spec} onServer={(result) => (latest = result)} />);
  await vi.waitFor(() => expect(treegrid().querySelectorAll("[data-grid-group-row]")).toHaveLength(3));
  await new Promise((resolve) => setTimeout(resolve, 100));
  const mount = { header: tracker.count("DataGridHeader"), body: tracker.count("DataGridBody") };
  for (let landing = 2; landing <= 5; landing++) {
    latest.refresh();
    await vi.waitFor(() => expect(server.calls).toHaveLength(landing));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { mount, landed: { header: tracker.count("DataGridHeader"), body: tracker.count("DataGridBody") }, server };
}

describe("a grouped server grid's render counts", () => {
  it("keeps the counts of a grid without pivot", async () => {
    const { mount, landed } = await rendersOverFiveLandings({ groupBy: ["region"], aggregates: [SUM] });
    // The counts measured before pivot existed.
    expect({ mount, landed }).toEqual({ mount: { header: 3, body: 5 }, landed: { header: 7, body: 13 } });
  });

  it("renders the header no more often under pivot once the held set stands", async () => {
    const { mount, landed, server } = await rendersOverFiveLandings({ groupBy: ["region"], aggregates: [SUM], pivot: { columnIds: ["city"] } });
    expect(treegrid().querySelector('[role="columnheader"][aria-label^="A-c0"]')).not.toBeNull();
    expect(server.calls.every((call) => call.childKind === "groups")).toBe(true);
    expect({ header: landed.header - mount.header, body: landed.body - mount.body }).toEqual({ header: 4, body: 8 });
  });
});
