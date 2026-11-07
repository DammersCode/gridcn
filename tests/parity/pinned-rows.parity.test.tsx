import { describe, expect, it, vi } from "vitest";
import { useDataGridAggregate } from "@/registry/default/blocks/data-grid-pinned-rows/use-data-grid-aggregate";
import { useDataGridServerAggregate, type ServerAggregateResult } from "@/registry/default/blocks/data-grid-pinned-rows/use-data-grid-server-aggregate";
import { ALL_MODES, mountMode } from "./modes";

const gt1 = [{ filterId: "f", columnId: "n", operator: "gt", value: "1" }] as const;
const specs = { n: "sum" } as const;

function withAggregate() {
  let sums: Record<string, unknown> = {};
  let sumsAll: Record<string, unknown> = {};
  function Child() {
    sums = useDataGridAggregate(specs);
    sumsAll = useDataGridAggregate(specs, { scope: "all" });
    return null;
  }
  return { Child, view: () => sums["n"], all: () => sumsAll["n"] };
}

describe.each(ALL_MODES)("aggregate band in mode %s", (mode) => {
  it("the view scope sums what the view shows and the all scope sums the held rows", async () => {
    const aggregate = withAggregate();
    const grid = await mountMode(mode, { Child: aggregate.Child });
    const held = mode === "PS" ? 0 + 1 + 2 + 3 : 15;
    expect(aggregate.all()).toBe(held);
    grid.setFilters([...gt1] as never);
    const filtered = mode === "FS" ? held : mode === "PS" ? 5 : 14;
    expect(aggregate.view()).toBe(filtered);
    expect(aggregate.all()).toBe(held);
  });

  it("a streamed value reaches the band", async () => {
    const aggregate = withAggregate();
    const grid = await mountMode(mode, { Child: aggregate.Child });
    const before = aggregate.view() as number;
    grid.act(() => void grid.state().actions.updateCells([{ rowId: "r1", columnId: "n", value: 101 }]));
    expect(aggregate.view()).toBe(before + 100);
  });
});

describe("aggregate band with client pagination", () => {
  it("the view scope totals every page and the page scope totals the shown page", async () => {
    let page: unknown;
    let view: unknown;
    function Child() {
      view = useDataGridAggregate(specs)["n"];
      page = useDataGridAggregate(specs, { scope: "page" })["n"];
      return null;
    }
    const grid = await mountMode("PC", { Child });
    expect(view).toBe(15);
    expect(page).toBe(0 + 1 + 2 + 3);
    grid.goToPage(2);
    expect(view).toBe(15);
    expect(page).toBe(4 + 5);
  });
});

describe.each(ALL_MODES)("server aggregate band in mode %s", (mode) => {
  it("requests the spec once, asks again on a filter change, and drops the superseded answer", async () => {
    const requests: { filters: unknown; signal: AbortSignal; resolve: (v: Record<string, unknown>) => void }[] = [];
    let latest: ServerAggregateResult | undefined;
    function Child() {
      latest = useDataGridServerAggregate({
        debounceMs: 0,
        fetchAggregates: ({ spec, signal }) => new Promise((resolve) => requests.push({ filters: spec.filters, signal, resolve })),
      });
      return null;
    }
    const grid = await mountMode(mode, { Child });
    expect(requests).toHaveLength(1);
    expect(latest?.status).toBe("loading");
    grid.setFilters([...gt1] as never);
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0]?.signal.aborted).toBe(true);
    await grid.act(() => requests[0]?.resolve({ n: 111 }));
    expect(latest?.row).toEqual({});
    await grid.act(() => requests[1]?.resolve({ n: 9 }));
    expect(latest?.row).toEqual({ n: 9 });
    expect(latest?.status).toBe("ready");
  });
});
