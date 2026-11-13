import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ServerSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridServerRows, type ServerRowsAnswer, type ServerRowsRequest } from "@/registry/default/blocks/data-grid-server/use-data-grid-server-rows";

type Row = { id: string };
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "requestAnimationFrame", "cancelAnimationFrame"] }));
afterEach(() => vi.useRealTimers());

it("scroll mode with a controlled spec (controlled state): a spec change aborts in flight, drops loaded rows, and a revalidation tick sends the controlled spec", async () => {
  const calls: ServerRowsRequest[] = [];
  const held: { start: number; signal: AbortSignal }[] = [];
  const fetchRows = (req: ServerRowsRequest) => {
    calls.push(req);
    if (req.start >= 100 && req.spec.searchText === "a") {
      held.push({ start: req.start, signal: req.signal });
      return new Promise<ServerRowsAnswer<Row>>(() => {});
    }
    return Promise.resolve({ rows: Array.from({ length: req.end - req.start }, (_, i) => ({ id: `r${req.start + i}` })), totalRowCount: 1000 });
  };
  const a: ServerSpec = { sorts: [], filters: [], searchText: "a" };
  const b: ServerSpec = { sorts: [], filters: [], searchText: "b" };
  const view = renderHook(({ spec }) => useDataGridServerRows<Row>({ mode: "scroll", fetchRows, spec, onSpecChange: () => {}, blockSize: 10, overscan: 0, loadDelay: 0, revalidateInterval: 5000 }), { initialProps: { spec: a } });
  await advance(0);
  expect(calls[0]!.spec.searchText).toBe("a");
  act(() => view.result.current.gridProps.onRenderedRowsChange({ start: 100, end: 110 }));
  await advance(0);
  expect(held).toHaveLength(1);
  view.rerender({ spec: b });
  await advance(0);
  expect(held[0]!.signal.aborted).toBe(true);
  const afterChange = calls.slice(2);
  expect(afterChange[0]).toMatchObject({ start: 0, spec: { searchText: "b" } });
  expect(afterChange.every((call) => call.spec.searchText === "b")).toBe(true);
  const before = calls.length;
  await advance(5000);
  expect(calls.length).toBeGreaterThan(before);
  expect(calls.at(-1)!.spec.searchText).toBe("b");
});

it("server pagination revalidates on a timer and sends the current spec", async () => {
  const calls: ServerRowsRequest[] = [];
  const fetchRows = (req: ServerRowsRequest) => {
    calls.push(req);
    return Promise.resolve({ rows: [{ id: `r${req.start}` }], totalRowCount: 50 });
  };
  const spec: ServerSpec = { sorts: [], filters: [], searchText: "a" };
  renderHook(() => useDataGridServerRows<Row>({ fetchRows, spec, onSpecChange: () => {}, defaultPageSize: 10, revalidateInterval: 5000 }));
  await advance(0);
  const before = calls.length;
  await advance(5000);
  expect(calls.length).toBeGreaterThan(before);
  expect(calls.at(-1)).toMatchObject({ start: 0, spec: { searchText: "a" } });
});
