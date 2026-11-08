import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataGrid, useDataGridActions, type ColumnDef, type DataGridActions } from "@/registry/default/blocks/data-grid/data-grid";
import {
  DataGridServerAggregateReporter,
  useDataGridServerAggregate,
  type FetchAggregatesRequest,
  type ServerAggregateResult,
  type UseDataGridServerAggregateOptions,
} from "../use-data-grid-server-aggregate";

type Row = { id: string; qty: number };
const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "id", header: "Id", accessorKey: "id", width: 80 },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", width: 80 },
];
const data: Row[] = [{ id: "a", qty: 1 }];

afterEach(cleanup);

type Deferred = { req: FetchAggregatesRequest; resolve: (v: unknown) => void; reject: (e: unknown) => void };

function setup(extra: Partial<UseDataGridServerAggregateOptions> = {}, onSave?: () => Promise<undefined>) {
  const calls: Deferred[] = [];
  const fetchAggregates = (req: FetchAggregatesRequest) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      calls.push({ req, resolve: resolve as (v: unknown) => void, reject });
    });
  let result!: ServerAggregateResult;
  let actions!: DataGridActions;
  function Inner() {
    result = useDataGridServerAggregate({ fetchAggregates, debounceMs: 0, ...extra });
    actions = useDataGridActions();
    return null;
  }
  const view = render(
    <DataGrid data={data} columns={columns} getRowId={(r) => r.id} onSave={onSave}>
      <Inner />
    </DataGrid>,
  );
  const call = (i: number): Deferred => {
    const c = calls[i];
    if (!c) throw new Error(`no call ${i}`);
    return c;
  };
  return { calls, call, view, get result() { return result; }, get actions() { return actions; } };
}


describe("useDataGridServerAggregate", () => {
  it("requests again once the pending saves settle", async () => {
    let finishSave!: () => void;
    const s = setup({}, () => new Promise<undefined>((resolve) => (finishSave = () => resolve(undefined))));
    await act(async () => s.call(0).resolve({ qty: 1 }));
    await act(async () => s.actions.commitCellValue({ rowId: "a", columnId: "qty" }, 5));
    expect(s.calls).toHaveLength(1);
    await act(async () => finishSave());
    await vi.waitFor(() => expect(s.calls).toHaveLength(2));
  });

  it("does not request again after a save with refreshAfterSave false", async () => {
    let finishSave!: () => void;
    const s = setup({ refreshAfterSave: false }, () => new Promise<undefined>((resolve) => (finishSave = () => resolve(undefined))));
    await act(async () => s.call(0).resolve({ qty: 1 }));
    await act(async () => s.actions.commitCellValue({ rowId: "a", columnId: "qty" }, 5));
    await act(async () => finishSave());
    await new Promise((r) => setTimeout(r, 20));
    expect(s.calls).toHaveLength(1);
  });

  it("starts loading with an empty row and requests the spec once", async () => {
    const s = setup();
    expect(s.result.status).toBe("loading");
    expect(s.result.row).toEqual({});
    expect(s.calls).toHaveLength(1);
    expect(s.call(0).req.spec).toEqual({ sorts: [], filters: [], searchText: "" });
    await act(async () => s.call(0).resolve({ qty: 42 }));
    expect(s.result.status).toBe("ready");
    expect(s.result.row).toEqual({ qty: 42 });
  });

  it("keeps old values as stale while a newer filter spec loads, and aborts the old request", async () => {
    const s = setup();
    await act(async () => s.call(0).resolve({ qty: 1 }));
    act(() => s.actions.setFilters([{ columnId: "qty", operator: "equals", value: "1" }]));
    await vi.waitFor(() => expect(s.calls).toHaveLength(2));
    expect(s.result.status).toBe("stale");
    expect(s.result.row).toEqual({ qty: 1 });
    expect(s.call(0).req.signal.aborted).toBe(true);
    await act(async () => s.call(1).resolve({ qty: 9 }));
    expect(s.result.row).toEqual({ qty: 9 });
    expect(s.result.status).toBe("ready");
  });

  it("ignores a late answer of a superseded request", async () => {
    const s = setup();
    act(() => s.actions.setFilters([{ columnId: "qty", operator: "equals", value: "1" }]));
    await vi.waitFor(() => expect(s.calls).toHaveLength(2));
    await act(async () => s.call(0).resolve({ qty: 111 }));
    expect(s.result.row).toEqual({});
    await act(async () => s.call(1).resolve({ qty: 2 }));
    expect(s.result.row).toEqual({ qty: 2 });
  });

  it("asks again when the quick-search text changes", async () => {
    const s = setup();
    await act(async () => s.call(0).resolve({ qty: 1 }));
    act(() => s.actions.setSearch("a"));
    await vi.waitFor(() => expect(s.calls).toHaveLength(2));
    expect(s.call(1).req.spec.searchText).toBe("a");
  });

  it("does not refetch on a sort change", async () => {
    const s = setup();
    await act(async () => s.call(0).resolve({ qty: 1 }));
    act(() => s.actions.setSorts([{ columnId: "qty", direction: "asc" }]));
    expect(s.calls).toHaveLength(1);
  });

  it("reports a failure as error, keeps old values, and retry refetches", async () => {
    const onError = vi.fn();
    const s = setup({ onError });
    await act(async () => s.call(0).resolve({ qty: 5 }));
    act(() => s.result.refresh());
    await vi.waitFor(() => expect(s.calls).toHaveLength(2));
    await act(async () => s.call(1).reject(new Error("boom")));
    expect(s.result.status).toBe("error");
    expect(s.result.row).toEqual({ qty: 5 });
    expect(onError).toHaveBeenCalledTimes(1);
    act(() => s.result.retry());
    await vi.waitFor(() => expect(s.calls).toHaveLength(3));
    await act(async () => s.call(2).resolve({ qty: 6 }));
    expect(s.result.status).toBe("ready");
  });

  it("retry is a no-op without an error", async () => {
    const s = setup();
    await act(async () => s.call(0).resolve({ qty: 1 }));
    act(() => s.result.retry());
    expect(s.calls).toHaveLength(1);
  });

  it("bounds and filters hostile values", async () => {
    const s = setup();
    const hostile = Object.create(null) as Record<string, unknown>;
    hostile['qty'] = "x".repeat(100_000);
    hostile['unknown'] = 1;
    hostile['__proto__'] = { polluted: true };
    await act(async () => s.call(0).resolve(hostile));
    expect((s.result.row['qty'] as string).length).toBeLessThanOrEqual(1000);
    expect(Object.keys(s.result.row)).toEqual(["qty"]);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it("drops non-primitive and non-finite values", async () => {
    const s = setup({ columnIds: ["id", "qty"] });
    await act(async () => s.call(0).resolve({ id: { a: 1 }, qty: Number.NaN }));
    expect(s.result.row).toEqual({});
    expect(s.result.status).toBe("ready");
  });

  it("treats a non-object answer as an error", async () => {
    const s = setup();
    await act(async () => s.call(0).resolve(null));
    expect(s.result.status).toBe("error");
  });

  it("aborts the request on unmount", () => {
    const s = setup();
    s.view.unmount();
    expect(s.call(0).req.signal.aborted).toBe(true);
  });

  it("debounces a burst of filter changes into one request", async () => {
    vi.useFakeTimers();
    try {
      const s = setup({ debounceMs: 100 });
      act(() => s.actions.setFilters([{ columnId: "qty", operator: "equals", value: "1" }]));
      act(() => s.actions.setFilters([{ columnId: "qty", operator: "equals", value: "12" }]));
      expect(s.calls).toHaveLength(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120);
      });
      expect(s.calls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("DataGridServerAggregateReporter", () => {
  it("keeps reporting after a consumer onChange throws", async () => {
    const seen: string[] = [];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const calls: ((v: Record<string, unknown>) => void)[] = [];
      render(
        <DataGrid data={data} columns={columns} getRowId={(r) => r.id}>
          <DataGridServerAggregateReporter
            debounceMs={0}
            fetchAggregates={() => new Promise((resolve) => calls.push(resolve))}
            onChange={(result) => {
              seen.push(result.status);
              if (seen.length === 1) throw new Error("consumer bug");
            }}
          />
        </DataGrid>,
      );
      await act(async () => calls[0]?.({ qty: 1 }));
      expect(seen).toEqual(["loading", "ready"]);
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });
});
