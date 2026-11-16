import "./date";
import { expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { DataGrid } from "../data-grid";

it("a deep import of the date cell type first still resolves the date column", () => {
  const columns = [{ id: "d", header: "D", accessorKey: "d", type: "date", options: { locale: "de-DE", displayFormat: { month: "long" } } }];
  const html = renderToString(<DataGrid data={[{ id: "1", d: "2024-03-05" }]} columns={columns as never} getRowId={(row: { id: string; d?: string }) => row.id} />);
  expect(html).toContain("März");
});
