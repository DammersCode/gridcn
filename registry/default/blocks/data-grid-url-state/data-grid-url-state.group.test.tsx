import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi, type DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { DataGridUrlState, useDataGridUrlState, type UseDataGridUrlStateResult } from "./data-grid-url-state";

afterEach(cleanup);

type Row = { id: string; team: string; role: string; age: number };

const rows: Row[] = [
  { id: "r0", team: "a", role: "x", age: 30 },
  { id: "r1", team: "b", role: "y", age: 40 },
];

const columns = defineColumns<Row>()([
  { id: "team", header: "Team", accessorKey: "team", type: "text" },
  { id: "role", header: "Role", accessorKey: "role", type: "text" },
  { id: "age", header: "Age", accessorKey: "age", type: "number", groupable: false },
  { id: "note", header: "Note", accessorKey: "role", type: "text" },
] as const);

let api: StoreApi<DataGridStoreState>;
function Capture() {
  api = useDataGridStoreApi();
  return null;
}
let applied: UseDataGridUrlStateResult;
function Hook() {
  applied = useDataGridUrlState({ spec: ["sort", "group"] });
  return null;
}

type Mode = "client" | "server";

function mount(searchParams: string, options: { mode?: Mode; grouping?: boolean; onUrlUpdate?: (e: UrlUpdateEvent) => void; hidden?: string[] } = {}) {
  const { mode = "client", grouping = true, onUrlUpdate, hidden } = options;
  const modeProps = mode === "server" ? { sortMode: "server" as const, filterMode: "server" as const } : {};
  return render(
    <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
      <DataGridProvider columns={columns} defaultData={rows} getRowId={(r: Row) => r.id} defaultColumnLayout={{ hidden }} {...(grouping ? { defaultGroupBy: [] } : {})} {...modeProps}>
        <Capture />
        <DataGridUrlState />
      </DataGridProvider>
    </NuqsTestingAdapter>,
  );
}

describe.each<Mode>(["client", "server"])("URL group param, %s data", (mode) => {
  it("a deep link seeds groupBy", () => {
    mount("?group=team%2Crole", { mode });
    expect(api.getState().groupBy).toEqual(["team", "role"]);
  });

  it("drops removed, ungroupable, repeated, and hidden columns and keeps the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount("?group=gone%2Cage%2Crole%2Cteam", { mode, hidden: ["role"] });
    expect(api.getState().groupBy).toEqual(["team"]);
    warn.mockRestore();
  });

  it("reads at most four raw segments", () => {
    mount("?group=team%2Crole%2Cnote%2Cx%2Cy%2Cz", { mode });
    expect(api.getState().groupBy).toEqual(["team", "role", "note"]);
  });

  it("writes group when the user groups and removes it when the user ungroups", async () => {
    const onUrlUpdate = vi.fn();
    mount("", { mode, onUrlUpdate });
    onUrlUpdate.mockClear();
    act(() => api.getState().actions.setGroupBy(["role", "team"]));
    await vi.waitFor(() => expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get("group")).toBe("role,team"));
    act(() => api.getState().actions.setGroupBy([]));
    await vi.waitFor(() => expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has("group")).toBe(false));
  });

  it("never writes the expanded groups", async () => {
    const onUrlUpdate = vi.fn();
    mount("?group=team", { mode, onUrlUpdate });
    act(() => api.getState().actions.expandAll());
    await act(async () => {});
    expect(onUrlUpdate.mock.calls.every(([e]) => [...e.searchParams.keys()].every((k) => k === "group"))).toBe(true);
  });

  it("ignores the param on a grid that does not group", () => {
    mount("?group=team", { mode, grouping: false });
    expect(api.getState().groupBy).toEqual([]);
  });
});

describe("URL group param, apply and spec", () => {
  it("applyFromUrl clears groupBy when the param is gone", async () => {
    const tree = (searchParams: string) => (
      <NuqsTestingAdapter searchParams={searchParams} hasMemory>
        <DataGridProvider columns={columns} defaultData={rows} getRowId={(r: Row) => r.id} defaultGroupBy={[]}>
          <Capture />
          <Hook />
        </DataGridProvider>
      </NuqsTestingAdapter>
    );
    const view = render(tree("?group=team"));
    expect(api.getState().groupBy).toEqual(["team"]);
    await act(async () => {
      view.rerender(tree(""));
      await new Promise((r) => setTimeout(r, 700));
    });
    await act(async () => applied.applyFromUrl());
    expect(api.getState().groupBy).toEqual([]);
  });

  it("leaves group out of the URL when spec omits it", async () => {
    const onUrlUpdate = vi.fn();
    render(
      <NuqsTestingAdapter onUrlUpdate={onUrlUpdate}>
        <DataGridProvider columns={columns} defaultData={rows} getRowId={(r: Row) => r.id} defaultGroupBy={["team"]}>
          <Capture />
          <DataGridUrlState spec={["sort"]} />
        </DataGridProvider>
      </NuqsTestingAdapter>,
    );
    act(() => api.getState().actions.setGroupBy(["role"]));
    await act(async () => {});
    expect(onUrlUpdate.mock.calls.some(([e]) => e.searchParams.has("group"))).toBe(false);
  });
});
