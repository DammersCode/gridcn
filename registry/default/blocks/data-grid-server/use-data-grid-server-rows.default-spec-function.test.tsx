import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DataGrid } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridServerRows, type ServerRowsAnswer, type ServerRowsPageRequest, type ServerRowsRequest } from "./use-data-grid-server-rows";

type Row = { id: string; name: string };
const rowsOf = (from: number, count: number): Row[] => Array.from({ length: count }, (_, i) => ({ id: `r${from + i}`, name: `Name ${from + i}` }));
const saved = { sorts: [{ columnId: "name", direction: "desc" as const }], filters: [], searchText: "ann" };
const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;

function pagesFetch() {
  return vi.fn(async ({ start, pageSize }: ServerRowsPageRequest<never>): Promise<ServerRowsAnswer<Row, never>> => ({ rows: rowsOf(start, pageSize), totalRowCount: 40 }));
}

describe("defaultSpec as a function, pages mode", () => {
  it("runs once on the client after mount, and the first request carries its spec", async () => {
    const fetchRows = pagesFetch();
    const seed = vi.fn(() => saved);
    const { result } = renderHook(() => useDataGridServerRows<Row>({ fetchRows, defaultPageSize: 10, defaultSpec: seed }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(seed).toHaveBeenCalledTimes(1);
    expect(fetchRows).toHaveBeenCalledTimes(1);
    expect(fetchRows.mock.calls[0]![0].spec).toEqual(saved);
    expect(result.current.spec).toEqual(saved);
  });

  it("starts at the empty spec when the function returns nothing, and fires no onSpecChange for the seed", async () => {
    const fetchRows = pagesFetch();
    const onSpecChange = vi.fn();
    const { result } = renderHook(() => useDataGridServerRows<Row>({ fetchRows, defaultPageSize: 10, defaultSpec: () => undefined, onSpecChange }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fetchRows).toHaveBeenCalledTimes(1);
    expect(fetchRows.mock.calls[0]![0].spec).toEqual({ sorts: [], filters: [], searchText: "" });
    expect(onSpecChange).not.toHaveBeenCalled();
  });

  it("sends one request under StrictMode", async () => {
    const fetchRows = pagesFetch();
    const { result } = renderHook(() => useDataGridServerRows<Row>({ fetchRows, defaultPageSize: 10, defaultSpec: () => saved }), { wrapper: strict });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchRows.mock.calls.filter(([request]) => request.spec.searchText === "ann")).toHaveLength(1);
    expect(fetchRows.mock.calls.every(([request]) => request.spec.searchText === "ann")).toBe(true);
  });

  it("does not run in the server render and does not fetch there", () => {
    const fetchRows = pagesFetch();
    const seed = vi.fn(() => saved);
    function Grid() {
      const server = useDataGridServerRows<Row>({ fetchRows, defaultPageSize: 10, defaultSpec: seed });
      return <DataGrid {...server.gridProps} columns={[{ id: "name", header: "Name", accessorKey: "name" }]} aria-label="Orders" className="h-96" />;
    }
    renderToString(<Grid />);
    expect(seed).not.toHaveBeenCalled();
    expect(fetchRows).not.toHaveBeenCalled();
  });

  it("keeps the initialAnswer when the function returns nothing, and fetches when it returns a spec", async () => {
    const answer: ServerRowsAnswer<Row, never> = { rows: rowsOf(0, 10), totalRowCount: 40 };
    const same = pagesFetch();
    const first = renderHook(() => useDataGridServerRows<Row>({ fetchRows: same, defaultPageSize: 10, initialAnswer: answer, defaultSpec: () => undefined }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(first.result.current.status).toBe("ready");
    expect(same).not.toHaveBeenCalled();
    const other = pagesFetch();
    const second = renderHook(() => useDataGridServerRows<Row>({ fetchRows: other, defaultPageSize: 10, initialAnswer: answer, defaultSpec: () => saved }));
    await waitFor(() => expect(other).toHaveBeenCalledTimes(1));
    expect(other.mock.calls[0]![0].spec).toEqual(saved);
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
  });

  it("is ignored while spec is controlled", async () => {
    const fetchRows = pagesFetch();
    const seed = vi.fn(() => saved);
    const spec = { sorts: [], filters: [], searchText: "" };
    const { result } = renderHook(() => useDataGridServerRows<Row>({ fetchRows, defaultPageSize: 10, spec, onSpecChange: () => {}, defaultSpec: seed }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(seed).not.toHaveBeenCalled();
    expect(fetchRows.mock.calls[0]![0].spec).toEqual(spec);
  });

  it("keeps defaultPage for the first request", async () => {
    const fetchRows = pagesFetch();
    const { result } = renderHook(() => useDataGridServerRows<Row>({ fetchRows, defaultPageSize: 10, defaultPage: 3, defaultSpec: () => saved }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fetchRows.mock.calls[0]![0].page).toBe(3);
  });
});

describe("defaultSpec as a function, scroll mode", () => {
  it("sends the first block with the returned spec and runs the function once", async () => {
    const fetchRows = vi.fn(async ({ start, end }: ServerRowsRequest): Promise<ServerRowsAnswer<Row>> => ({ rows: rowsOf(start, Math.min(end, 40) - start), totalRowCount: 40 }));
    const seed = vi.fn(() => saved);
    const { result } = renderHook(() => useDataGridServerRows<Row>({ mode: "scroll", fetchRows, defaultSpec: seed, blockSize: 10, overscan: 0, loadDelayMs: 0 }), { wrapper: strict });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => {});
    expect(fetchRows.mock.calls.every(([request]) => request.spec.searchText === "ann")).toBe(true);
    expect(fetchRows).toHaveBeenCalled();
    expect(result.current.spec).toEqual(saved);
  });
});
