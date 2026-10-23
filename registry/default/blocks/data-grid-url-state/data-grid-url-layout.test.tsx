import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import {
  DataGridProvider,
  defineColumns,
  useDataGridActions,
  useDataGridAllColumns,
  type ColumnLayout,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridUrlState, type UseDataGridUrlStateOptions, type UseDataGridUrlStateResult } from "./data-grid-url-state";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Row = { id: string; name: string; age: number; city: string };

const rows: Row[] = [{ id: "r0", name: "Alice", age: 30, city: "Berlin" }];

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 80 },
  { id: "city", header: "City", accessorKey: "city", type: "text", width: 90 },
] as const);

const pinnedColumns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100, pin: "left" },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 80 },
] as const);

type Harness = {
  actions: () => ReturnType<typeof useDataGridActions>;
  visibleOrder: () => string[];
  urlState: () => UseDataGridUrlStateResult;
  updates: UrlUpdateEvent[];
  layoutEvents: ColumnLayout[];
  setSearchParams: (searchParams: string) => void;
};

function renderGrid(options: { searchParams?: string; urlOptions?: UseDataGridUrlStateOptions; columns?: typeof columns | typeof pinnedColumns }): Harness {
  let actions: ReturnType<typeof useDataGridActions> | undefined;
  let all: readonly { id: string }[] = [];
  let urlState: UseDataGridUrlStateResult | undefined;
  const updates: UrlUpdateEvent[] = [];
  const layoutEvents: ColumnLayout[] = [];
  function Probe() {
    actions = useDataGridActions();
    all = useDataGridAllColumns();
    urlState = useDataGridUrlState(options.urlOptions);
    return null;
  }
  const tree = (searchParams: string | undefined) => (
    <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={(e) => updates.push(e)} hasMemory>
      <DataGridProvider
        data={rows}
        columns={(options.columns ?? columns) as typeof columns}
        getRowId={(r) => r.id}
        onColumnLayoutChange={(layout) => layoutEvents.push(layout)}
      >
        <Probe />
      </DataGridProvider>
    </NuqsTestingAdapter>
  );
  const { rerender } = render(tree(options.searchParams));
  return { setSearchParams: (searchParams) => rerender(tree(searchParams)), actions: () => actions!, visibleOrder: () => all.map((c) => c.id), urlState: () => urlState!, updates, layoutEvents };
}

const lastParam = (h: Harness, key: string) => h.updates.at(-1)?.searchParams.get(key);
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 80))));

describe("column layout URL sync", () => {
  it("applies cols and hide from the URL in one layout commit", async () => {
    const h = renderGrid({ searchParams: "?cols=city,name,age&hide=age" });
    await flush();
    expect(h.visibleOrder()).toEqual(["city", "name", "age"]);
    expect(h.layoutEvents).toHaveLength(1);
    expect(h.layoutEvents[0]).toMatchObject({ order: ["city", "name", "age"], hidden: ["age"] });
  });

  it("leaves the grid alone when the URL has no layout params", async () => {
    const h = renderGrid({});
    await flush();
    expect(h.layoutEvents).toHaveLength(0);
    expect(h.updates.every((u) => !u.searchParams.has("cols") && !u.searchParams.has("hide"))).toBe(true);
  });

  it("drops unknown ids with one dev warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = renderGrid({ searchParams: "?cols=ghost,city,phantom,name&hide=ghost" });
    await flush();
    expect(h.visibleOrder()).toEqual(["city", "name", "age"]);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("layout"))).toHaveLength(1);
  });

  it("writes a reorder to cols once", async () => {
    const h = renderGrid({});
    await act(async () => h.actions().setColumnOrder("city", "name", "before"));
    await flush();
    expect(lastParam(h, "cols")).toBe("city,name,age");
    expect(h.updates.filter((u) => u.searchParams.has("cols"))).toHaveLength(1);
    expect(h.updates.at(-1)?.options.history).toBe("replace");
  });

  it("writes hidden columns to hide and removes it when the layout returns to the default", async () => {
    const h = renderGrid({});
    await act(async () => h.actions().setColumnHidden("age", true));
    await flush();
    expect(lastParam(h, "hide")).toBe("age");
    await act(async () => h.actions().setColumnHidden("age", false));
    await flush();
    expect(lastParam(h, "hide")).toBeNull();
  });

  it("does not write widths or pins by default", async () => {
    const h = renderGrid({});
    await act(async () => {
      h.actions().commitColumnWidth("name", 222);
      h.actions().setColumnPin("age", "left");
    });
    await flush();
    expect(h.updates.every((u) => !u.searchParams.has("widths") && !u.searchParams.has("pins"))).toBe(true);
  });

  it("writes widths once at release, never per resize frame", async () => {
    const h = renderGrid({ urlOptions: { layout: ["widths"] } });
    await flush();
    const before = h.updates.length;
    await act(async () => {
      for (let width = 101; width <= 140; width++) h.actions().setColumnWidth("name", width);
    });
    await flush();
    expect(h.updates).toHaveLength(before);
    await act(async () => h.actions().commitColumnWidth("name", 140));
    await flush();
    expect(h.updates).toHaveLength(before + 1);
    expect(lastParam(h, "widths")).toBe("name:140");
  });

  it("writes nothing for layout: []", async () => {
    const h = renderGrid({ searchParams: "?cols=city,name,age", urlOptions: { layout: [] } });
    await act(async () => h.actions().setColumnHidden("age", true));
    await flush();
    expect(h.visibleOrder()).toEqual(["name", "age", "city"]);
    expect(h.updates.every((u) => !u.searchParams.has("hide"))).toBe(true);
  });

  it("round trips an unpinned def-pinned column", async () => {
    const first = renderGrid({ columns: pinnedColumns, urlOptions: { layout: ["pins"] } });
    await act(async () => first.actions().setColumnPin("name", null));
    await flush();
    expect(lastParam(first, "pins")).toBe("-");
    cleanup();
    const second = renderGrid({ columns: pinnedColumns, searchParams: "?pins=-", urlOptions: { layout: ["pins"] } });
    await flush();
    expect(second.layoutEvents.at(-1)?.pins).toEqual({});
  });

  it("namespaces the layout keys with the prefix", async () => {
    const h = renderGrid({ urlOptions: { prefix: "orders" } });
    await act(async () => h.actions().setColumnHidden("age", true));
    await flush();
    expect(lastParam(h, "orders_hide")).toBe("age");
    expect(lastParam(h, "hide")).toBeNull();
  });

  it("applyFromUrl resets a part whose param is gone", async () => {
    const h = renderGrid({ searchParams: "?cols=city,name,age&hide=age" });
    await flush();
    expect(h.visibleOrder()).toEqual(["city", "name", "age"]);
    h.setSearchParams("?hide=age");
    await act(async () => h.urlState().applyFromUrl());
    await flush();
    expect(h.visibleOrder()).toEqual(["name", "age", "city"]);
  });
});
