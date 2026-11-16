import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnDef, FilterSpec } from "../types";
import { createDataGridStore } from "./create-store";
import type { InternalSyncProps } from "./types";

type Row = { id: string; name: string };
const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const data: Row[] = [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }];
const ghostFilter = { columnId: "ghost", operator: "contains", value: "x" } as FilterSpec;
const nameFilter = { columnId: "name", operator: "contains", value: "A" } as FilterSpec;
const create = (extra: object = {}) => createDataGridStore({ data, columns, getRowId: (row: Row) => row.id, ...extra } as unknown as InternalSyncProps);
const warnings = (warn: ReturnType<typeof vi.spyOn>) => warn.mock.calls.filter(([m]) => String(m).includes("unknown column"));

afterEach(() => vi.restoreAllMocks());

describe("a sort or filter on an unknown column", () => {
  it("drops a seeded filter on an unknown column and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = create({ defaultFilterState: [ghostFilter, nameFilter] });
    expect(store.getState().filterState.map((f) => (f as FilterSpec).columnId)).toEqual(["name"]);
    expect(store.getState().viewIndex).toEqual([0]);
    expect(warnings(warn)).toHaveLength(1);
  });

  it("drops a seeded sort on an unknown column", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = create({ defaultSortState: [{ columnId: "ghost", direction: "asc" }] });
    expect(store.getState().sortState).toEqual([]);
  });

  it("drops an unknown column from a filter group", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = create({ defaultFilterState: [{ join: "or", filters: [ghostFilter, nameFilter] }] });
    const group = store.getState().filterState[0] as { filters: FilterSpec[] };
    expect(group.filters.map((f) => f.columnId)).toEqual(["name"]);
  });

  it("setFilters and setSorts drop unknown columns and warn once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onFilterChange = vi.fn();
    const store = create({ onFilterChange });
    store.getState().actions.setFilters([ghostFilter]);
    store.getState().actions.setSorts([{ columnId: "ghost", direction: "desc" }]);
    expect(store.getState().viewIndex).toEqual([0, 1]);
    expect(onFilterChange).not.toHaveBeenCalled();
    expect(warnings(warn)).toHaveLength(1);
  });

  it("drops the spec in server mode too, so the server never receives it", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onSortChange = vi.fn();
    const store = create({ sortMode: "server", filterMode: "server", onSortChange });
    store.getState().actions.setSorts([{ columnId: "ghost", direction: "asc" }, { columnId: "name", direction: "asc" }]);
    expect(onSortChange).toHaveBeenCalledWith([{ columnId: "name", direction: "asc" }]);
  });
});
