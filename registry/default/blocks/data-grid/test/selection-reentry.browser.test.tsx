import { page } from "vitest/browser";
import { StrictMode, useState } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "../data-grid";
import { gridAttrSelector } from "../data-grid-sdk";
import "@/app/global.css";

type Row = { id: string; name: string };

const initialRows: readonly Row[] = Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1), name: `User ${i + 1}` }));
const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 160 }] as const);

describe("onSelectionChange with a plain setState", () => {
  it("renders a bounded number of times after a checkbox click", async () => {
    let renders = 0;
    function App() {
      const [data, setData] = useState(initialRows);
      const [selectedIds, setSelectedIds] = useState<string[]>([]);
      renders++;
      return (
        <DataGridProvider
          data={data}
          onDataChange={(next) => setData(next)}
          columns={columns}
          getRowId={(row) => row.id}
          rowMarkers="checkbox"
          headerClickBehavior="sort"
          onSelectionChange={(_selection, { getRowIds }) => setSelectedIds(getRowIds())}
        >
          <div data-testid="count">{selectedIds.length}</div>
          <DataGridRoot className="h-[300px]">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      );
    }
    await render(<StrictMode><App /></StrictMode>);
    const checkbox = document.querySelector<HTMLElement>(`${gridAttrSelector("markerCell")} [role="checkbox"], ${gridAttrSelector("markerCell")} input`);
    expect(checkbox).not.toBeNull();
    checkbox!.click();
    await expect.element(page.getByTestId("count")).toHaveTextContent("1");
    expect(renders).toBeLessThan(20);
  });
});
