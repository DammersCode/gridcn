import { render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DataGridProvider, useDataGridStore } from ".";
import type { ColumnDef } from "../types";

vi.hoisted(() => {
  const RealCollator = Intl.Collator;
  const SwedishRuntimeCollator = function (locale?: string | string[], options?: Intl.CollatorOptions) {
    const supported = [locale ?? []].flat().find((tag) => RealCollator.supportedLocalesOf(tag).length > 0);
    return new RealCollator(supported ?? "sv", options);
  };
  SwedishRuntimeCollator.supportedLocalesOf = RealCollator.supportedLocalesOf;
  globalThis.Intl = Object.create(Intl, { Collator: { value: SwedishRuntimeCollator } });
});

type Row = { id: string; v: string };
const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "v", header: "V", accessorKey: "v", type: "text" }];

function Order() {
  const order = useDataGridStore((s) => s.viewIndex.map((i) => (s.data[i] as Row).v).join(","));
  return <span>{order}</span>;
}

const grid = (
  <DataGridProvider columns={columns} getRowId={(row: Row) => row.id} defaultData={["z", "ä", "b"].map((v, i) => ({ id: String(i), v }))} sortState={[{ columnId: "v", direction: "asc" }]}>
    <Order />
  </DataGridProvider>
);

describe("sort locale on the server and the client", () => {
  it("orders a text column the same way in the server HTML and in the browser render", () => {
    const serverOrder = />([^<]*)<\/span>/.exec(renderToString(grid))?.[1];
    const clientOrder = render(grid).container.textContent;
    expect(serverOrder).toBe("ä,b,z");
    expect(clientOrder).toBe(serverOrder);
  });
});
