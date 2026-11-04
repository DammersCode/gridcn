import { useMemo, useState } from "react";
import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, type ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridServerAggregateReporter, PENDING_SERVER_AGGREGATE } from "../use-data-grid-server-aggregate";
import { useDataGridPinnedRows } from "../use-data-grid-pinned-rows";
import "@/app/global.css";

type Row = { id: string; qty: number };
const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "id", header: "Id", accessorKey: "id", width: 80 },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", width: 120 },
];
const data: Row[] = [{ id: "a", qty: 1 }];

function Harness(props: { fetchAggregates: () => Promise<Record<string, unknown>> }) {
  const [aggregate, setAggregate] = useState(PENDING_SERVER_AGGREGATE);
  const bottomRows = useMemo(() => [{ id: "__total__", ...aggregate.row }], [aggregate.row]);
  const { plugin } = useDataGridPinnedRows({ bottomRows, status: aggregate.status });
  return (
    <div style={{ width: 400, height: 240 }}>
      <DataGrid data={data} columns={columns} getRowId={(r) => r.id} plugins={[plugin]}>
        <DataGridServerAggregateReporter debounceMs={0} onChange={setAggregate} fetchAggregates={props.fetchAggregates} />
      </DataGrid>
    </div>
  );
}

const band = () => document.querySelector<HTMLElement>("[data-grid-pinned-row-band]");

describe("server aggregate band", () => {
  it("marks the band busy while loading and shows the server value once it lands", async () => {
    let resolve!: (v: Record<string, unknown>) => void;
    await render(<Harness fetchAggregates={() => new Promise((r) => (resolve = r))} />);
    await vi.waitFor(() => expect(band()?.dataset["status"]).toBe("loading"));
    expect(band()?.getAttribute("aria-busy")).toBe("true");
    resolve({ qty: 4242 });
    await vi.waitFor(() => expect(band()?.dataset["status"]).toBe("ready"));
    expect(band()?.hasAttribute("aria-busy")).toBe(false);
    await expect.element(page.getByText("4242")).toBeVisible();
  });

  it("shows a hostile text value as text", async () => {
    await render(<Harness fetchAggregates={async () => ({ id: "<img src=x onerror=alert(1)>" })} />);
    await vi.waitFor(() => expect(band()?.dataset["status"]).toBe("ready"));
    expect(band()?.querySelector("img")).toBeNull();
    expect(band()?.textContent).toContain("<img");
  });

  it("marks the band as error and keeps it dimmed", async () => {
    await render(<Harness fetchAggregates={() => Promise.reject(new Error("down"))} />);
    await vi.waitFor(() => expect(band()?.dataset["status"]).toBe("error"));
    expect(band()?.className).toContain("opacity-60");
  });
});
