import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataGrid } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridServerRows, type ServerRowsAnswer, type ServerRowsRequest } from "./use-data-grid-server-rows";

type Row = { id: string; name: string };
const rowsOf = (from: number, count: number): Row[] => Array.from({ length: count }, (_, i) => ({ id: `r${from + i}`, name: `Name ${from + i}` }));
const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const span = (start: number, end: number) => ({ start, end });

function counted(total = 200) {
  return vi.fn(async ({ start, end }: ServerRowsRequest<never>): Promise<ServerRowsAnswer<Row, never>> => ({ rows: rowsOf(start, Math.min(end, total) - start), totalRowCount: total }));
}
const answer: ServerRowsAnswer<Row, never> = { rows: rowsOf(0, 20), totalRowCount: 200 };

afterEach(() => vi.restoreAllMocks());

describe("useDataGridServerRows initialAnswer (server scroll)", () => {
  it("holds block 0 on the first render and sends no request for it", async () => {
    const fetchRows = counted();
    const onLoaded = vi.fn();
    const { result } = renderHook(() => useDataGridServerRows<Row>({ mode: "scroll", fetchRows, blockSize: 20, loadDelayMs: 0, initialAnswer: answer, onLoaded }));
    expect(result.current.status).toBe("ready");
    expect(result.current.totalRowCount).toBe(200);
    expect(result.current.gridProps.data[0]?.id).toBe("r0");
    expect(result.current.gridProps.data).toHaveLength(200);
    await settle();
    expect(fetchRows).not.toHaveBeenCalled();
    expect(onLoaded).not.toHaveBeenCalled();
    expect(result.current.getLoadedRanges()).toEqual([span(0, 20)]);
  });

  it("fetches block 1 once the rendered rows reach it", async () => {
    const fetchRows = counted();
    const { result } = renderHook(() => useDataGridServerRows<Row>({ mode: "scroll", fetchRows, blockSize: 20, overscan: 0, loadDelayMs: 0, initialAnswer: answer }));
    act(() => result.current.gridProps.onRenderedRowsChange(span(15, 30)));
    await waitFor(() => expect(result.current.gridProps.data[25]?.id).toBe("r25"));
    expect(fetchRows.mock.calls.map(([request]) => request.start)).toEqual([20]);
  });

  it("refreshes through the server as usual", async () => {
    const fetchRows = counted();
    const { result } = renderHook(() => useDataGridServerRows<Row>({ mode: "scroll", fetchRows, blockSize: 20, loadDelayMs: 0, initialAnswer: answer }));
    act(() => result.current.refresh());
    await waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(1));
    expect(fetchRows.mock.calls[0]![0].start).toBe(0);
  });

  it("continues a cursor answer with that cursor", async () => {
    const fetchRows = vi.fn(async ({ cursor }: ServerRowsRequest<string>): Promise<ServerRowsAnswer<Row, string>> => ({ rows: rowsOf(20, 20), nextCursor: cursor === "c1" ? null : "c2" }));
    const { result } = renderHook(() => useDataGridServerRows<Row, string>({ mode: "scroll", fetchRows, blockSize: 20, overscan: 0, loadDelayMs: 0, initialAnswer: { rows: rowsOf(0, 20), nextCursor: "c1" } }));
    expect(result.current.unloadedCount).toBe(20);
    expect(result.current.totalRowCount).toBeNull();
    act(() => result.current.gridProps.onRenderedRowsChange(span(10, 20)));
    await waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(1));
    expect(fetchRows.mock.calls[0]![0].cursor).toBe("c1");
    await waitFor(() => expect(result.current.gridProps.data[39]?.id).toBe("r39"));
  });

  it("ends a sequential source when the answer says there is no more", async () => {
    const fetchRows = counted();
    const { result } = renderHook(() => useDataGridServerRows<Row>({ mode: "scroll", fetchRows, blockSize: 20, loadDelayMs: 0, initialAnswer: { rows: rowsOf(0, 5), hasMore: false } }));
    expect(result.current.totalRowCount).toBe(5);
    expect(result.current.unloadedCount).toBe(0);
    await settle();
    expect(fetchRows).not.toHaveBeenCalled();
  });

  it("cuts an oversized answer to one block with one development warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchRows = counted();
    const { result } = renderHook(() => useDataGridServerRows<Row>({ mode: "scroll", fetchRows, blockSize: 10, loadDelayMs: 0, initialAnswer: { rows: rowsOf(0, 30), totalRowCount: 200 } }), { wrapper: strict });
    await settle();
    expect(result.current.getLoadedRanges()).toEqual([span(0, 10)]);
    expect(result.current.gridProps.data[10]).toBeUndefined();
    expect(warn.mock.calls.filter(([message]) => String(message).includes("only the first block"))).toHaveLength(1);
  });

  it("drops a malformed answer and fetches block 0", async () => {
    const fetchRows = counted();
    const { result } = renderHook(() => useDataGridServerRows<Row>({ mode: "scroll", fetchRows, blockSize: 20, loadDelayMs: 0, initialAnswer: {} as ServerRowsAnswer<Row, never> }));
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fetchRows).toHaveBeenCalledTimes(1);
  });

  it("drops the answer when a function defaultSpec returns another first spec", async () => {
    const fetchRows = counted();
    const saved = { sorts: [{ columnId: "name", direction: "desc" as const }], filters: [], searchText: "" };
    const { result } = renderHook(() => useDataGridServerRows<Row>({ mode: "scroll", fetchRows, blockSize: 20, loadDelayMs: 0, defaultSpec: () => saved, initialAnswer: answer }));
    await waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(1));
    expect(fetchRows.mock.calls[0]![0].spec).toEqual(saved);
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  it("keeps the answer when a function defaultSpec returns nothing", async () => {
    const fetchRows = counted();
    renderHook(() => useDataGridServerRows<Row>({ mode: "scroll", fetchRows, blockSize: 20, loadDelayMs: 0, defaultSpec: () => undefined, initialAnswer: answer }));
    await settle();
    expect(fetchRows).not.toHaveBeenCalled();
  });

  it("fetches after a spec change", async () => {
    const fetchRows = counted();
    const { result } = renderHook(() => useDataGridServerRows<Row>({ mode: "scroll", fetchRows, blockSize: 20, loadDelayMs: 0, initialAnswer: answer }));
    act(() => result.current.gridProps.onSearchTextChange("ann"));
    await waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(1));
    expect(fetchRows.mock.calls[0]![0].spec.searchText).toBe("ann");
  });

  it("sends no request for block 0 under StrictMode", async () => {
    const fetchRows = counted();
    const { result } = renderHook(() => useDataGridServerRows<Row>({ mode: "scroll", fetchRows, blockSize: 20, loadDelayMs: 0, initialAnswer: answer }), { wrapper: strict });
    await settle();
    expect(fetchRows).not.toHaveBeenCalled();
    expect(result.current.getLoadedRanges()).toEqual([span(0, 20)]);
  });

  it("renders block 0 in the server HTML", () => {
    function Grid() {
      const server = useDataGridServerRows<Row>({ mode: "scroll", fetchRows: counted(), blockSize: 20, initialAnswer: answer });
      return <DataGrid {...server.gridProps} columns={[{ id: "name", header: "Name", accessorKey: "name" }]} aria-label="Orders" className="h-96" />;
    }
    const html = renderToString(<Grid />);
    expect(html.slice(0, html.indexOf(">"))).not.toContain("aria-busy");
    expect(html).toContain("Name 0");
  });
});
