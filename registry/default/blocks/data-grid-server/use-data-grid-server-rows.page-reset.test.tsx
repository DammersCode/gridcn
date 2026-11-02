import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDataGridServerRows, type ServerRowsAnswer, type ServerRowsPageRequest } from "./use-data-grid-server-rows";
import type { ServerSpec } from "@/registry/default/blocks/data-grid/server-spec";

type Row = { id: string };

const fetchRows = async ({ start, end }: ServerRowsPageRequest): Promise<ServerRowsAnswer<Row>> => ({
  rows: Array.from({ length: end - start }, (_, i) => ({ id: `r${start + i}` })),
  totalRowCount: 500,
});
const specOf = (searchText: string): ServerSpec => ({ sorts: [], filters: [], searchText });

describe("page reset on an outside spec change", () => {
  function setup() {
    const onPageChange = vi.fn();
    const hook = renderHook(
      ({ spec, page }: { spec: ServerSpec; page: number }) => useDataGridServerRows<Row>({ getRowId: (r) => r.id, fetchRows, spec, onSpecChange: () => {}, page, onPageChange, defaultPageSize: 10, pageSizeOptions: [10] }),
      { initialProps: { spec: specOf(""), page: 1 } },
    );
    return { hook, onPageChange };
  }

  it("keeps the page the consumer moved in the same render as the spec", async () => {
    const { hook, onPageChange } = setup();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    hook.rerender({ spec: specOf("ann"), page: 3 });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("resets to page 1 when the spec changes alone", async () => {
    const { hook, onPageChange } = setup();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    hook.rerender({ spec: specOf(""), page: 3 });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    onPageChange.mockClear();
    act(() => hook.rerender({ spec: specOf("ann"), page: 3 }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});
