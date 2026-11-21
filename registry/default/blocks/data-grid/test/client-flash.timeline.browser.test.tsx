import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, defineColumns, type DataGridApi } from "../data-grid";
import { flashesIn, recordAcross, sampleGrid } from "./frame-timeline.test-helper";
import "@/app/global.css";

type Row = { id: string; name: string; city: string; qty: number };

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 120 },
  { id: "city", header: "City", accessorKey: "city", type: "text", width: 120 },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", width: 100 },
] as const);

const data: Row[] = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, name: `Name ${i}`, city: i % 2 ? "Oslo" : "Rome", qty: i }));

type Handles = { api: ReturnType<typeof createRef<DataGridApi<Row>>>; setDir: { current: (dir: "ltr" | "rtl") => void } };

function Harness({ handles }: { handles: Handles }) {
  const [dir, setDir] = useState<"ltr" | "rtl">("ltr");
  handles.setDir.current = setDir;
  return (
    <div dir={dir} style={{ height: 400, width: 600 }}>
      <DataGrid ref={handles.api} columns={columns} data={data} getRowId={(row) => row.id} defaultPageSize={5} className="h-100 w-150" aria-label="Client" />
    </div>
  );
}

const ACTIONS: { name: string; run: (api: DataGridApi<Row>, handles: Handles) => void }[] = [
  { name: "page change", run: (api) => api.actions.setPage(2) },
  { name: "sort", run: (api) => api.actions.setSorts([{ columnId: "qty", direction: "desc" }]) },
  { name: "filter", run: (api) => api.actions.setFilters([{ columnId: "city", operator: "equals", value: "Oslo" }]) },
  { name: "search", run: (api) => api.actions.setSearch("Name 1") },
  { name: "column pin", run: (api) => api.actions.setColumnPin("city", "left") },
  { name: "column reorder", run: (api) => void api.actions.setColumnOrder("qty", "name", "before") },
  { name: "column hide", run: (api) => api.actions.setColumnHidden("city", true) },
  { name: "direction switch", run: (_, handles) => handles.setDir.current("rtl") },
];

describe("a client grid paints no frame that differs from both the old and the new state", () => {
  for (const action of ACTIONS) {
    it(`across a ${action.name}`, async () => {
      const handles: Handles = { api: createRef<DataGridApi<Row>>(), setDir: { current: () => {} } };
      const screen = await render(<Harness handles={handles} />);
      await vi.waitFor(() => expect(sampleGrid().rows).not.toBe(""));
      const before = sampleGrid();
      let frames = 0;
      const samples = await recordAcross(() => action.run(handles.api.current!, handles), () => ++frames > 3);
      expect(flashesIn(samples, before, sampleGrid()).slice(0, 3)).toEqual([]);
      await screen.unmount();
    });
  }
});
