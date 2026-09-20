import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ColumnDef } from "../types";
import * as sortFilterModule from "../sort-filter";
import {
  DataGridProvider,
  useDataGridActions,
  useDataGridSearchCapped,
  useDataGridSearchMatches,
  useDataGridViewIndex,
} from "../store";

/**
 * Search-performance acceptance tests: `setSearch` computes `findSearchMatches` exactly once,
 * stepping through matches never calls it again, `viewIndex` identity is untouched by search,
 * and the 1000-match cap is honored with an early exit.
 */

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];

function manyRows(count: number, matchEvery = 1): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i),
    name: i % matchEvery === 0 ? "needle" : "hay",
  }));
}

function makeWrapper(data: Row[]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={data} columns={columns} getRowId={(r) => r.id}>
        {children}
      </DataGridProvider>
    );
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("search performance", () => {
  it("setSearch calls findSearchMatches exactly once", () => {
    const spy = vi.spyOn(sortFilterModule, "findSearchMatches");
    const wrapper = makeWrapper(manyRows(50));
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.setSearch("needle"));

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("stepping through matches (pure arithmetic) never calls findSearchMatches again", () => {
    const wrapper = makeWrapper(manyRows(50));
    const { result } = renderHook(
      () => ({ actions: useDataGridActions(), matches: useDataGridSearchMatches() }),
      { wrapper },
    );

    act(() => result.current.actions.setSearch("needle"));
    const spy = vi.spyOn(sortFilterModule, "findSearchMatches");

    // "stepping" here is the store-level equivalent: reading the precomputed matches slice and
    // moving the active cell — the toolbar's goToMatch does the same pure index arithmetic.
    act(() => result.current.actions.setActiveCell({ col: 0, row: result.current.matches[1]?.row ?? 0 }));
    act(() => result.current.actions.setActiveCell({ col: 0, row: result.current.matches[2]?.row ?? 0 }));

    expect(spy).not.toHaveBeenCalled();
  });

  it("setSearch never changes viewIndex identity (search no longer filters rows)", () => {
    const wrapper = makeWrapper(manyRows(50));
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridActions(), viewIndex: useDataGridViewIndex() }),
      { wrapper },
    );
    const before = result.current.viewIndex;

    act(() => result.current.actions.setSearch("needle"));
    rerender();

    expect(result.current.viewIndex).toBe(before);
  });

  it("caps matches at 1000 with early exit and reports searchMatchesCapped", () => {
    const spy = vi.spyOn(sortFilterModule, "findSearchMatches");
    // every row matches ("needle" for all 5000) so an uncapped scan would collect 5000 hits.
    const wrapper = makeWrapper(manyRows(5000, 1));
    const { result } = renderHook(
      () => ({ actions: useDataGridActions(), matches: useDataGridSearchMatches(), capped: useDataGridSearchCapped() }),
      { wrapper },
    );

    act(() => result.current.actions.setSearch("needle"));

    expect(result.current.matches.length).toBe(1000);
    expect(result.current.capped).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0]!;
    expect(call[4]).toBe(1000);
  });

  it("does not report capped when matches are below the cap", () => {
    const wrapper = makeWrapper(manyRows(50, 5));
    const { result } = renderHook(
      () => ({ actions: useDataGridActions(), matches: useDataGridSearchMatches(), capped: useDataGridSearchCapped() }),
      { wrapper },
    );

    act(() => result.current.actions.setSearch("needle"));

    expect(result.current.matches.length).toBe(10);
    expect(result.current.capped).toBe(false);
  });
});
