import { describe, expect, it } from "vitest";
import { createDataGridStore } from "./create-store";
import type { InternalSyncProps } from "./types";

type Row = { id: string; name: string };

describe("search matches after a row move", () => {
  it("follow the matched record to its new view row", () => {
    const store = createDataGridStore({
      defaultData: [
        { id: "a", name: "needle" },
        { id: "b", name: "hay1" },
        { id: "c", name: "hay2" },
        { id: "d", name: "hay3" },
      ],
      columns: [{ id: "name", header: "Name", accessorKey: "name" }],
      getRowId: (row: Row) => row.id,
      searchText: "needle",
    } as unknown as InternalSyncProps);
    expect(store.getState().searchMatches.map((match) => match.row)).toEqual([0]);
    store.getState().actions.reorderRows(0, 3);
    const rowOf = (viewRow: number) => (store.getState().data[store.getState().viewIndex[viewRow]!] as Row).name;
    expect(store.getState().searchMatches.map((match) => rowOf(match.row))).toEqual(["needle"]);
  });
});
