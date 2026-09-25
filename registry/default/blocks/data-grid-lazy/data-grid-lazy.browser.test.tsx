import { useEffect } from "react";
import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridLazyRows, type UseDataGridLazyRowsResult } from "./use-data-grid-lazy-rows";
// real stylesheet — layout/scroll must be real for skeleton/scroll assertions to mean anything
import "@/app/global.css";

const ROW_HEIGHT = 36;

type Row = { id: string; name: string };

function makeRows(start: number, end: number): Row[] {
  const rows: Row[] = [];
  for (let i = start; i < end; i++) rows.push({ id: `row-${i}`, name: `Person ${i}` });
  return rows;
}

const columns = defineColumns<Row>()([
  { id: "id", header: "ID", accessorKey: "id", type: "text", width: 120 },
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 180 },
] as const);

function LazyGrid(props: {
  fetchRows: (start: number, end: number, signal: AbortSignal) => Promise<Row[]>;
  onLazy?: (lazy: UseDataGridLazyRowsResult<Row>) => void;
}) {
  const lazy = useDataGridLazyRows<Row>({
    total: 10_000,
    fetchRows: props.fetchRows,
    getRowId: (row) => row.id,
    overscan: 5,
    batchSize: 20,
  });
  useEffect(() => {
    props.onLazy?.(lazy);
  });
  return (
    <div style={{ height: 360, width: 400 }}>
      <DataGridProvider data={lazy.gridProps.data} columns={columns} getRowId={lazy.gridProps.getRowId} onDataChange={lazy.onDataChange}>
        <DataGridRoot className="h-90 w-100" onRowWindowChange={lazy.gridProps.onRowWindowChange}>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}

describe("data-grid-lazy: evict() reverts a loaded range to skeletons and the next scroll refetches", () => {
  it("evicted rows render as skeletons until the refetch resolves", async () => {
    const pending: Array<{ start: number; end: number; resolve: (rows: Row[]) => void }> = [];
    const fetchRows = vi.fn((start: number, end: number) => {
      return new Promise<Row[]>((resolve) => {
        pending.push({ start, end, resolve: (rows: Row[]) => resolve(rows) });
      });
    });

    let lazy: UseDataGridLazyRowsResult<Row> | undefined;
    await render(<LazyGrid fetchRows={fetchRows} onLazy={(l) => (lazy = l)} />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    pending[0]?.resolve(makeRows(pending[0].start, pending[0].end));
    await new Promise((r) => setTimeout(r, 0));

    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    grid.scrollTop = 500 * ROW_HEIGHT;
    grid.dispatchEvent(new Event("scroll"));
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 0));
    pending.at(-1)!.resolve(makeRows(pending.at(-1)!.start, pending.at(-1)!.end));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => requestAnimationFrame(r));
    await expect.element(page.getByText(/Person 5\d\d/).first()).toBeInTheDocument();

    // evict a wide band covering the loaded range; the rows must become skeletons again.
    lazy?.evict({ start: 450, end: 560 });
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 0));

    grid.scrollTop = 0;
    grid.dispatchEvent(new Event("scroll"));
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 0));

    grid.scrollTop = 500 * ROW_HEIGHT;
    grid.dispatchEvent(new Event("scroll"));
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 0));

    // the refetch is in flight but unresolved -> skeletons hold the space again.
    expect(document.querySelectorAll('[role="gridcell"][data-skeleton]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[role="row"][aria-busy="true"]').length).toBeGreaterThan(0);
    expect(fetchRows.mock.calls.length).toBeGreaterThan(2);

    pending.at(-1)!.resolve(makeRows(pending.at(-1)!.start, pending.at(-1)!.end));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => requestAnimationFrame(r));
    await expect.element(page.getByText(/Person 5\d\d/).first()).toBeInTheDocument();
    expect(document.querySelectorAll('[role="gridcell"][data-skeleton]').length).toBe(0);
  });
});

describe("data-grid-lazy: reset() refetches the visible window without a scroll", () => {
  it("loaded rows return after reset() alone (the core does not re-report an unmoved window)", async () => {
    const pending: Array<{ start: number; end: number; resolve: (rows: Row[]) => void }> = [];
    const fetchRows = vi.fn((start: number, end: number) => {
      return new Promise<Row[]>((resolve) => {
        pending.push({ start, end, resolve: (rows: Row[]) => resolve(rows) });
      });
    });

    let lazy: UseDataGridLazyRowsResult<Row> | undefined;
    await render(<LazyGrid fetchRows={fetchRows} onLazy={(l) => (lazy = l)} />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    pending[0]?.resolve(makeRows(pending[0].start, pending[0].end));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => requestAnimationFrame(r));
    await expect.element(page.getByText("Person 0")).toBeInTheDocument();

    const callsBefore = fetchRows.mock.calls.length;
    lazy?.reset();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => requestAnimationFrame(r));

    // no scroll happened — the refetch must come from the hook itself.
    expect(fetchRows.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(document.querySelectorAll('[role="gridcell"][data-skeleton]').length).toBeGreaterThan(0);

    pending.at(-1)!.resolve(makeRows(pending.at(-1)!.start, pending.at(-1)!.end));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => requestAnimationFrame(r));
    await expect.element(page.getByText("Person 0")).toBeInTheDocument();
    expect(document.querySelectorAll('[role="gridcell"][data-skeleton]').length).toBe(0);
  });
});

describe("data-grid-lazy: scroll into a hole -> skeletons -> data fills in", () => {
  it("renders skeleton rows for a far scroll target, then fills in real content once the fetch resolves", async () => {
    let resolveFetch: (() => void) | undefined;
    const fetchRows = vi.fn(
      (start: number, end: number) =>
        new Promise<Row[]>((resolve) => {
          resolveFetch = () => resolve(makeRows(start, end));
        }),
    );

    await render(<LazyGrid fetchRows={fetchRows} />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    // let the mount-time fetch for the initial window resolve so it doesn't interfere below.
    resolveFetch?.();
    await new Promise((r) => setTimeout(r, 0));

    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    grid.scrollTop = 500 * ROW_HEIGHT;
    grid.dispatchEvent(new Event("scroll"));
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 0));

    // fetch for the scrolled-to range is in flight but unresolved -> skeleton rows visible now.
    const skeletonCells = document.querySelectorAll('[role="gridcell"][data-skeleton]');
    expect(skeletonCells.length).toBeGreaterThan(0);
    const busyRows = document.querySelectorAll('[role="row"][aria-busy="true"]');
    expect(busyRows.length).toBeGreaterThan(0);

    resolveFetch?.();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => requestAnimationFrame(r));

    // once resolved, the rows in view have real content and no shimmer.
    await expect.element(page.getByText(/Person 5\d\d/).first()).toBeInTheDocument();
    expect(document.querySelectorAll('[role="gridcell"][data-skeleton]').length).toBe(0);
  });

  it("a failed fetch reverts the range to unloaded and refetches it the next time onRowWindowChange covers it", async () => {
    let callCount = 0;
    const resolvers: Array<() => void> = [];
    const fetchRows = vi.fn(
      (start: number, end: number) =>
        new Promise<Row[]>((resolve, reject) => {
          callCount++;
          const shouldFail = callCount === 1;
          resolvers.push(() => (shouldFail ? reject(new Error("simulated failure")) : resolve(makeRows(start, end))));
        }),
    );

    await render(<LazyGrid fetchRows={fetchRows} />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    // resolve the mount-time fetch successfully so only the deliberate failure below is under test.
    resolvers[0]?.();
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchRows).toHaveBeenCalledTimes(1);

    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    // still unresolved/failed range -> re-scrolling to the same spot must eventually refetch it.
    grid.scrollTop = 200 * ROW_HEIGHT;
    grid.dispatchEvent(new Event("scroll"));
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 0));

    const callsAfterFirstScroll = fetchRows.mock.calls.length;
    // reject this range's fetch (simulated failure).
    resolvers[resolvers.length - 1]?.();
    await new Promise((r) => setTimeout(r, 0));

    // scroll away, then back — a failed range must be re-requested since it never became "loaded".
    grid.scrollTop = 0;
    grid.dispatchEvent(new Event("scroll"));
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 0));

    grid.scrollTop = 200 * ROW_HEIGHT;
    grid.dispatchEvent(new Event("scroll"));
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchRows.mock.calls.length).toBeGreaterThan(callsAfterFirstScroll);

    // resolve every outstanding fetch so the row eventually shows real content, proving the retry worked.
    for (const resolve of resolvers) resolve();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => requestAnimationFrame(r));

    await expect.element(page.getByText(/Person 2\d\d/).first()).toBeInTheDocument();
  });
});

const callbackColumns = defineColumns<Row>()([
  { id: "id", header: "ID", accessorKey: "id", type: "text", width: 120, readOnly: (row) => row.name.length > 0 },
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 180 },
] as const);

// the callbacks read a row field on purpose: an invocation with an undefined (hole) row crashes loudly
const callbackRowClassName = (row: Row) => `row-${row.id}`;

function CallbacksLazyGrid(props: {
  fetchRows: (start: number, end: number, signal: AbortSignal) => Promise<Row[]>;
}) {
  const lazy = useDataGridLazyRows<Row>({
    total: 10_000,
    fetchRows: props.fetchRows,
    getRowId: (row) => row.id,
    overscan: 5,
    batchSize: 20,
  });
  return (
    <div style={{ height: 360, width: 400 }}>
      <DataGridProvider
        data={lazy.gridProps.data}
        columns={callbackColumns}
        getRowId={lazy.gridProps.getRowId}
        onDataChange={lazy.onDataChange}
      >
        <DataGridRoot
          className="h-90 w-100"
          onRowWindowChange={lazy.gridProps.onRowWindowChange}
          getRowClassName={callbackRowClassName}
        >
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}

describe("data-grid-lazy: function-form callbacks on skeleton rows", () => {
  it("scrolling into an unloaded window renders skeletons without throwing, and loaded rows keep the callback classes", async () => {
    let resolveFetch: (() => void) | undefined;
    const fetchRows = vi.fn(
      (start: number, end: number) =>
        new Promise<Row[]>((resolve) => {
          resolveFetch = () => resolve(makeRows(start, end));
        }),
    );

    await render(<CallbacksLazyGrid fetchRows={fetchRows} />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    // resolve the mount-time fetch so the initial window holds real rows
    resolveFetch?.();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => requestAnimationFrame(r));
    await expect.element(page.getByText("Person 0")).toBeInTheDocument();

    // loaded rows receive the getRowClassName-derived class
    const loadedRow = document.querySelector<HTMLElement>('[data-grid-row-index="0"]');
    expect(loadedRow?.className).toContain("row-row-0");

    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    grid.scrollTop = 200 * ROW_HEIGHT;
    grid.dispatchEvent(new Event("scroll"));
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 0));

    // the unloaded window renders skeletons; the row-field-reading callbacks must not have
    // thrown on the hole rows for this point to be reachable
    expect(document.querySelectorAll('[role="gridcell"][data-skeleton]').length).toBeGreaterThan(0);
    const skeletonRows = document.querySelectorAll<HTMLElement>('[role="row"][aria-busy="true"]');
    expect(skeletonRows.length).toBeGreaterThan(0);
    for (const skeletonRow of skeletonRows) {
      expect(skeletonRow.className).not.toContain("row-");
    }
  });
});
