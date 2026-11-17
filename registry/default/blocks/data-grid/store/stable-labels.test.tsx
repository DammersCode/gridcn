import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ColumnDef } from "../types";
import { DataGridProvider, useDataGridLabels } from ".";

type Row = { id: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "id", header: "Id", accessorKey: "id" }];

describe("function labels", () => {
  it("keeps the labels object across renders and calls the newest function", () => {
    const seen: ReturnType<typeof useDataGridLabels>[] = [];
    function Probe() {
      seen.push(useDataGridLabels());
      return null;
    }
    const tree = (tag: string) => (
      <DataGridProvider columns={columns} getRowId={(row: Row) => row.id} defaultData={[{ id: "a" }]} labels={{ io: { maxFileSize: () => tag } }}>
        <Probe />
      </DataGridProvider>
    );
    const view = render(tree("one"));
    view.rerender(tree("two"));
    expect(seen.at(-1)?.io.maxFileSize(1)).toBe("two");
    expect(new Set(seen).size).toBe(1);
  });
});
