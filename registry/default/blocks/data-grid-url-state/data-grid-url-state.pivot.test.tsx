import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import { DataGridProvider, defineColumns, useDataGridActions } from "@/registry/default/blocks/data-grid/data-grid";
import { pivotColumnId, type ServerGroupLayout } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { useDataGridUrlState } from "./data-grid-url-state";

afterEach(cleanup);

type Row = { id: string; region: string; year: number; amount: number };

const columns = defineColumns<Row>()([
  { id: "region", header: "Region", accessorKey: "region", type: "text" },
  { id: "year", header: "Year", accessorKey: "year", type: "number" },
  { id: "amount", header: "Amount", accessorKey: "amount", type: "number", aggregate: "sum" },
] as const);

const SUM = { columnId: "amount", reducer: "sum" } as const;
const generated = pivotColumnId("year", 2025, SUM);
const layout: ServerGroupLayout = {
  rows: [{ viewRow: 0, path: [{ columnId: "region", key: "EU" }], count: 1, childCount: 0, pivotCells: Float64Array.of(5) }],
  leafCount: 1,
  pivot: { columnId: "year", values: [SUM], columns: [{ path: [2025], valueIndex: 0 }], omitted: 0 },
};

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 80))));

describe("the URL writer under pivot", () => {
  it("writes no generated id after a generated column is resized", async () => {
    const updates: UrlUpdateEvent[] = [];
    let actions: ReturnType<typeof useDataGridActions> | undefined;
    function Probe() {
      actions = useDataGridActions();
      useDataGridUrlState({ layout: ["widths", "order", "pins", "hidden"] });
      return null;
    }
    render(
      <NuqsTestingAdapter onUrlUpdate={(e) => updates.push(e)} hasMemory>
        <DataGridProvider data={[{ id: "", region: "", year: 0, amount: 0 }]} columns={columns} getRowId={(_r, i) => `slot-${i}`} groupBy={["region"]} groupLayout={layout}>
          <Probe />
        </DataGridProvider>
      </NuqsTestingAdapter>,
    );
    await flush();
    act(() => {
      actions!.setColumnWidth(generated, 200);
      actions!.setColumnWidth("region", 150);
    });
    await flush();
    expect(updates.at(-1)?.searchParams.get("widths")).toBe("region:150");
    expect(updates.some((update) => update.queryString.includes("__pivot"))).toBe(false);
  });
});
