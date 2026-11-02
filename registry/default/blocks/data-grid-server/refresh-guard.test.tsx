import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, DataGridRoot, defineColumns, type DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { MAX_LOGGED_SAVES, useRefreshGuard } from "./refresh-guard";

type Row = { id: string; name: string };
const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text" }] as const);
const data: Row[] = Array.from({ length: MAX_LOGGED_SAVES + 200 }, (_, i) => ({ id: `r${i}`, name: `Person ${i}` }));

function mount() {
  let guard!: ReturnType<typeof useRefreshGuard>;
  let store!: StoreApi<DataGridStoreState>;
  function Probe() {
    store = useDataGridStoreApi() as unknown as StoreApi<DataGridStoreState>;
    return null;
  }
  function Harness() {
    guard = useRefreshGuard();
    return (
      <DataGridProvider data={data} getRowId={(row: Row) => row.id} columns={columns} plugins={guard.plugins} onSave={(_change: DataChange<Row>) => new Promise<void>(() => {})}>
        <DataGridRoot>
          <Probe />
        </DataGridRoot>
      </DataGridProvider>
    );
  }
  render(<Harness />);
  const save = (start: number, end: number) => {
    for (let i = start; i < end; i++) act(() => store.getState().actions.commitCellValue({ rowId: `r${i}`, columnId: "name" }, `Saved ${i}`));
  };
  return { guard: () => guard, save };
}

describe("the save log", () => {
  it("records no save while no request is open", () => {
    const t = mount();
    t.save(0, 50);
    expect(t.guard().savedSince(0)).toBeNull();
  });

  it("records the saves that start after a request opened, and drops them when the last request ends", () => {
    const t = mount();
    const mark = t.guard().saveMark();
    t.save(0, 5);
    expect(t.guard().savedSince(mark)?.size).toBe(5);
    t.guard().pruneSaves(null);
    expect(t.guard().savedSince(mark)).toBeNull();
    t.save(5, 10);
    expect(t.guard().savedSince(mark)).toBeNull();
  });

  it("keeps the newest saves up to the cap while a request never settles", () => {
    const t = mount();
    const mark = t.guard().saveMark();
    t.save(0, MAX_LOGGED_SAVES + 150);
    const since = t.guard().savedSince(mark)!;
    expect(since.size).toBe(MAX_LOGGED_SAVES);
    expect(since.has("r0")).toBe(false);
    expect(since.has(`r${MAX_LOGGED_SAVES + 149}`)).toBe(true);
  }, 60_000);
});
