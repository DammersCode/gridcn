import { trackRenders } from "@/registry/default/blocks/data-grid/test/render-counter.test-helper";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { fakeServer, rowsOf, type Row } from "./group-fake-server.test-helper";
import type { ServerRowsRequest } from "./read-answer";
import { useDataGridServerRows, type UseDataGridServerRowsScrollResult } from "./use-data-grid-server-rows";
import "@/app/global.css";

const columns = defineColumns<Row>()([
  { id: "region", header: "Region", accessorKey: "region", type: "text", width: 120 },
  { id: "city", header: "City", accessorKey: "city", type: "text", width: 120 },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", width: 100 },
] as const);

const frames = (count: number) => new Promise<void>((resolve) => {
  const step = (left: number) => (left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
  step(count);
});

describe("the start of a hold", () => {
  it("renders no rendered cell again, no more than a refresh with the rows on screen does", async () => {
    const tracker = trackRenders();
    const server = fakeServer(rowsOf({ A: 6, B: 6 }));
    let parked: (() => void)[] | null = null;
    const fetchRows = (request: ServerRowsRequest<never>) => {
      const answer = server.fetchRows(request);
      if (parked === null) return answer;
      return new Promise((resolve) => parked!.push(() => resolve(answer)));
    };
    let hook!: UseDataGridServerRowsScrollResult<Row>;
    function Grid() {
      hook = useDataGridServerRows<Row>({ mode: "scroll", fetchRows: fetchRows as never, blockSize: 50, loadDelayMs: 0 });
      return (
        <div style={{ height: 360, width: 500 }}>
          <DataGrid {...hook.gridProps} columns={columns} className="h-90 w-125" aria-label="Held" />
        </div>
      );
    }
    const screen = await render(<Grid />);
    await vi.waitFor(() => expect(document.querySelectorAll('[role="row"][data-grid-row-index]').length).toBeGreaterThan(5));
    await frames(3);
    const hold = async (start: () => void) => {
      parked = [];
      tracker.reset();
      start();
      await frames(4);
      const cells = tracker.count("DataGridCellImpl");
      const flagged = hook.providerProps.serverHeld === true;
      const run = parked ?? [];
      parked = null;
      for (const go of run) go();
      await vi.waitFor(() => expect(hook.loading).toBe(false));
      await frames(3);
      return { cells, flagged };
    };
    const refresh = await hold(() => hook.refresh());
    const held = await hold(() => hook.gridProps.onSortChange([{ columnId: "qty", direction: "desc" }]));
    expect([refresh.flagged, held.flagged, hook.providerProps.serverHeld]).toEqual([false, true, undefined]);
    expect(held.cells).toBe(0);
    expect(held.cells).toBeLessThanOrEqual(refresh.cells);
    await screen.unmount();
  });
});
