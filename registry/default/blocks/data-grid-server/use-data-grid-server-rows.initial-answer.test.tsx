import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DataGrid } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridServerRows, type ServerRowsAnswer, type ServerRowsPageRequest } from "./use-data-grid-server-rows";

type Row = { id: string; name: string };
const page = (from: number, count: number): Row[] => Array.from({ length: count }, (_, i) => ({ id: `r${from + i}`, name: `Name ${from + i}` }));
const fetchRows = vi.fn(async ({ start, pageSize }: ServerRowsPageRequest<never>): Promise<ServerRowsAnswer<Row, never>> => ({ rows: page(start, pageSize), totalRowCount: 40 }));
const initialAnswer: ServerRowsAnswer<Row, never> = { rows: page(0, 10), totalRowCount: 40 };

describe("useDataGridServerRows initialAnswer (server pagination)", () => {
  it("shows the first answer without a request, then fetches on the next state", async () => {
    fetchRows.mockClear();
    const { result } = renderHook(() => useDataGridServerRows<Row>({ fetchRows, defaultPageSize: 10, initialAnswer }));
    expect(result.current.status).toBe("ready");
    expect(result.current.gridProps.data.map((row) => row.id).slice(0, 2)).toEqual(["r0", "r1"]);
    expect(result.current.totalRowCount).toBe(40);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchRows).not.toHaveBeenCalled();
    act(() => result.current.pager.onPageChange(2));
    await waitFor(() => expect(result.current.gridProps.data[0]?.id).toBe("r10"));
    expect(fetchRows).toHaveBeenCalledTimes(1);
  });

  it("takes the first answer for a controlled spec, with sortMode and filterMode on the server", async () => {
    fetchRows.mockClear();
    const spec = { sorts: [{ columnId: "name", direction: "desc" as const }], filters: [], searchText: "" };
    const { result } = renderHook(() => useDataGridServerRows<Row>({ fetchRows, defaultPageSize: 10, spec, onSpecChange: () => {}, initialAnswer }));
    expect(result.current.status).toBe("ready");
    expect(result.current.gridProps.sortMode).toBe("server");
    expect(result.current.gridProps.filterMode).toBe("server");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchRows).not.toHaveBeenCalled();
  });

  it("sends no request for the first answer under StrictMode", async () => {
    fetchRows.mockClear();
    const { result } = renderHook(() => useDataGridServerRows<Row>({ fetchRows, defaultPageSize: 10, initialAnswer }), { wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchRows).not.toHaveBeenCalled();
    act(() => result.current.refresh());
    await waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(1));
  });

  it("renders the first answer in the server HTML", () => {
    function Grid() {
      const server = useDataGridServerRows<Row>({ fetchRows, defaultPageSize: 10, initialAnswer });
      return <DataGrid {...server.gridProps} columns={[{ id: "name", header: "Name", accessorKey: "name" }]} aria-label="Orders" className="h-96" />;
    }
    const html = renderToString(<Grid />);
    expect(html).not.toContain('aria-busy="true"');
    expect(html).toContain("Name 0");
  });
});
