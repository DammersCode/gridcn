import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "../types";
import { DataGridProvider } from ".";

type Row = { id: string; name: string };
const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const rows: Row[] = [{ id: "a", name: "A" }];

afterEach(() => vi.restoreAllMocks());

describe("guardrail warnings", () => {
  it("warn once per grid, not once per app", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tree = (
      <DataGridProvider columns={columns} getRowId={(row: Row) => row.id} data={rows} defaultData={rows}>
        {null}
      </DataGridProvider>
    );
    const first = render(tree);
    first.rerender(tree);
    const afterFirst = warn.mock.calls.filter(([message]) => String(message).includes("`defaultData` is ignored")).length;
    render(tree);
    const afterSecond = warn.mock.calls.filter(([message]) => String(message).includes("`defaultData` is ignored")).length;
    expect(afterFirst).toBe(1);
    expect(afterSecond).toBe(2);
  });
});
