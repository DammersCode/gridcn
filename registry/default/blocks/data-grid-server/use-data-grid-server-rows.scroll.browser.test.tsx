import { useEffect, useRef } from "react";
import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns, type FilterNode } from "@/registry/default/blocks/data-grid/data-grid";
import { StoreProbe } from "@/registry/default/blocks/data-grid/test/store-probe.test-helper";
import { readSelectedRows } from "@/registry/default/blocks/data-grid/store/selected-rows";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { firstRowHeight, gridElement, mountedRows, originRebased, scrollByTicks } from "@/registry/default/blocks/data-grid/test/scroll-origin.test-helper";
import { useDataGridServerRows, type ServerRowsAnswer, type ServerRowsRequest, type UseDataGridServerRowsScrollResult } from "./use-data-grid-server-rows";
// real stylesheet — layout/scroll must be real for skeleton/scroll assertions to mean anything
import "@/app/global.css";

const ROW_HEIGHT = 36;

type Row = { id: string; name: string };
type Fetch = (request: ServerRowsRequest) => Promise<ServerRowsAnswer<Row>>;

function makeRows(start: number, end: number): Row[] {
  const rows: Row[] = [];
  for (let i = start; i < end; i++) rows.push({ id: `row-${i}`, name: `Person ${i}` });
  return rows;
}

const columns = defineColumns<Row>()([
  { id: "id", header: "ID", accessorKey: "id", type: "text", width: 120 },
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 180 },
] as const);

const nextTask = () => new Promise((r) => setTimeout(r, 0));
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
const settle = async () => {
  await nextTask();
  await nextFrame();
};

type Pending = { start: number; end: number; resolve: () => void; reject: () => void };

/** A server whose answers wait for the test; `count` is the result size. */
function deferredServer(count = 10_000) {
  const pending: Pending[] = [];
  const fetchRows = vi.fn<Fetch>(
    ({ start, end }) =>
      new Promise((resolve, reject) => {
        pending.push({
          start,
          end,
          resolve: () => resolve({ rows: makeRows(start, Math.min(end, count)), totalRowCount: count }),
          reject: () => reject(new Error("simulated failure")),
        });
      }),
  );
  const resolveAll = async () => {
    pending.splice(0).forEach((entry) => entry.resolve());
    await settle();
  };
  return { fetchRows, pending, resolveAll };
}

function ServerGrid(props: { fetchRows: Fetch; count?: number; onServer?: (server: UseDataGridServerRowsScrollResult<Row>) => void; onReady?: (api: StoreApi<DataGridStoreState>) => void; defaultFilters?: FilterNode[]; rowClassName?: (row: Row) => string }) {
  const server = useDataGridServerRows<Row>({ mode: "scroll", getRowId: (row) => row.id, fetchRows: props.fetchRows, blockSize: 20, overscan: 5, defaultSpec: props.defaultFilters ? { filters: props.defaultFilters } : undefined });
  useEffect(() => {
    props.onServer?.(server);
  });
  return (
    <div style={{ height: 360, width: 400 }}>
      <DataGridProvider {...server.providerProps} columns={columns}>
        {props.onReady && <StoreProbe onReady={props.onReady} />}
        <DataGridRoot className="h-90 w-100" {...server.rootProps} getRowClassName={props.rowClassName}>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}

const skeletonCells = () => document.querySelectorAll('[role="gridcell"][data-skeleton]').length;
const scrollGridTo = async (row: number) => {
  const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
  grid.scrollTop = row * ROW_HEIGHT;
  grid.dispatchEvent(new Event("scroll"));
  await settle();
};

describe("scroll mode: first block, skeletons, and fill-in", () => {
  it("loads block 0 first and renders its rows", async () => {
    const server = deferredServer();
    await render(<ServerGrid fetchRows={server.fetchRows} />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await vi.waitFor(() => expect(server.pending).toHaveLength(1));
    expect(server.pending[0]).toMatchObject({ start: 0, end: 20 });
    await server.resolveAll();
    await expect.element(page.getByText("Person 0")).toBeInTheDocument();
  });

  it("renders skeleton rows for a far scroll target, then fills in real content", async () => {
    const server = deferredServer();
    await render(<ServerGrid fetchRows={server.fetchRows} />);
    await vi.waitFor(() => expect(server.pending).toHaveLength(1));
    await server.resolveAll();

    await scrollGridTo(500);
    await vi.waitFor(() => expect(server.pending.length).toBeGreaterThan(0));
    expect(skeletonCells()).toBeGreaterThan(0);
    expect(document.querySelectorAll('[role="row"][aria-busy="true"]').length).toBeGreaterThan(0);

    await server.resolveAll();
    await expect.element(page.getByText(/Person 5\d\d/).first()).toBeInTheDocument();
    expect(skeletonCells()).toBe(0);
  });

  it("evicted rows render as skeletons until the refetch resolves", async () => {
    const server = deferredServer();
    let current!: UseDataGridServerRowsScrollResult<Row>;
    await render(<ServerGrid fetchRows={server.fetchRows} onServer={(s) => (current = s)} />);
    await vi.waitFor(() => expect(server.pending).toHaveLength(1));
    await server.resolveAll();

    await scrollGridTo(500);
    await vi.waitFor(() => expect(server.pending.length).toBeGreaterThan(0));
    await server.resolveAll();
    await expect.element(page.getByText(/Person 5\d\d/).first()).toBeInTheDocument();

    current.evict({ start: 450, end: 560 });
    await settle();
    await scrollGridTo(0);
    await scrollGridTo(500);

    expect(skeletonCells()).toBeGreaterThan(0);
    expect(document.querySelectorAll('[role="row"][aria-busy="true"]').length).toBeGreaterThan(0);
    await server.resolveAll();
    await expect.element(page.getByText(/Person 5\d\d/).first()).toBeInTheDocument();
    expect(skeletonCells()).toBe(0);
  });

  it("refresh keeps the rows on screen while it refetches and swaps them when the answers land", async () => {
    const server = deferredServer();
    let current!: UseDataGridServerRowsScrollResult<Row>;
    await render(<ServerGrid fetchRows={server.fetchRows} onServer={(s) => (current = s)} />);
    await vi.waitFor(() => expect(server.pending).toHaveLength(1));
    await server.resolveAll();
    await expect.element(page.getByText("Person 0")).toBeInTheDocument();

    const callsBefore = server.fetchRows.mock.calls.length;
    current.refresh();
    await settle();

    expect(server.fetchRows.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(skeletonCells()).toBe(0);
    await expect.element(page.getByText("Person 0")).toBeInTheDocument();
    await server.resolveAll();
    await expect.element(page.getByText("Person 0")).toBeInTheDocument();
    expect(skeletonCells()).toBe(0);
  });

  it("a failed block is refetched the next time the window covers it", async () => {
    const server = deferredServer();
    await render(<ServerGrid fetchRows={server.fetchRows} />);
    await vi.waitFor(() => expect(server.pending).toHaveLength(1));
    await server.resolveAll();

    await scrollGridTo(200);
    await vi.waitFor(() => expect(server.pending.length).toBeGreaterThan(0));
    server.pending.splice(0).forEach((entry) => entry.reject());
    await settle();
    const callsAfterFailure = server.fetchRows.mock.calls.length;

    await scrollGridTo(0);
    await scrollGridTo(200);
    expect(server.fetchRows.mock.calls.length).toBeGreaterThan(callsAfterFailure);
    await server.resolveAll();
    await expect.element(page.getByText(/Person 2\d\d/).first()).toBeInTheDocument();
  });
});

describe("scroll mode: error bar and Retry", () => {
  it("shows the alert for a failed block and Retry repeats it", async () => {
    let failFrom: number | null = null;
    const fetchRows = vi.fn<Fetch>(async ({ start, end }) => {
      if (failFrom !== null && start >= failFrom) throw new Error("down");
      return { rows: makeRows(start, end), totalRowCount: 10_000 };
    });
    await render(<ServerGrid fetchRows={fetchRows} />);
    await expect.element(page.getByText("Person 0")).toBeInTheDocument();
    expect(document.querySelector('[role="alert"]')).toBeNull();

    failFrom = 100;
    await scrollGridTo(200);
    await expect.element(page.getByRole("alert")).toBeInTheDocument();
    await expect.element(page.getByText("Could not load rows.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("down");

    failFrom = null;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect.element(page.getByText(/Person 2\d\d/).first()).toBeInTheDocument();
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).toBeNull());
  });

  it("shows the alert and Retry when the first block fails", async () => {
    let fail = true;
    const fetchRows = vi.fn<Fetch>(async ({ start, end }) => {
      if (fail) throw new Error("down");
      return { rows: makeRows(start, end), totalRowCount: 10_000 };
    });
    await render(<ServerGrid fetchRows={fetchRows} />);
    await expect.element(page.getByRole("alert")).toBeInTheDocument();
    fail = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect.element(page.getByText("Person 0")).toBeInTheDocument();
  });
});

describe("scroll mode: function-form callbacks on skeleton rows", () => {
  it("scrolling into an unloaded window renders skeletons without throwing, and loaded rows keep the callback classes", async () => {
    const server = deferredServer();
    // the callback reads a row field on purpose: an invocation with an undefined (hole) row crashes loudly
    await render(<ServerGrid fetchRows={server.fetchRows} rowClassName={(row) => `row-${row.id}`} />);
    await vi.waitFor(() => expect(server.pending).toHaveLength(1));
    await server.resolveAll();
    await expect.element(page.getByText("Person 0")).toBeInTheDocument();
    expect(document.querySelector<HTMLElement>('[data-grid-row-index="0"]')?.className).toContain("row-row-0");

    await scrollGridTo(200);
    expect(skeletonCells()).toBeGreaterThan(0);
    for (const row of document.querySelectorAll<HTMLElement>('[role="row"][aria-busy="true"]')) expect(row.className).not.toContain("row-");
  });
});

describe("scroll mode: server filter", () => {
  const spec: FilterNode[] = [{ columnId: "name", operator: "contains", value: "zzz" }];
  const instantServer = () => vi.fn<Fetch>(async ({ start, end }) => ({ rows: makeRows(start, end), totalRowCount: 10_000 }));

  it("keeps the identity view for a spec present at mount, so the first block loads from row 0", async () => {
    const fetchRows = instantServer();
    let api!: StoreApi<DataGridStoreState>;
    await render(<ServerGrid fetchRows={fetchRows} defaultFilters={spec} onReady={(a) => (api = a)} />);
    await vi.waitFor(() => expect(fetchRows).toHaveBeenCalled());
    expect(fetchRows.mock.calls[0]![0]).toMatchObject({ start: 0, spec: { filters: spec } });
    await vi.waitFor(() => expect(api.getState().viewIndex).toHaveLength(10_000));
    await vi.waitFor(() => expect(document.body.textContent).toContain("Person 0"));
  });

  it("maps the rendered range to data indices after a filter is applied and the view is scrolled", async () => {
    const fetchRows = instantServer();
    let api!: StoreApi<DataGridStoreState>;
    await render(<ServerGrid fetchRows={fetchRows} onReady={(a) => (api = a)} />);
    await vi.waitFor(() => expect(document.body.textContent).toContain("Person 0"));
    api.getState().actions.setFilters(spec);
    await vi.waitFor(() => expect(fetchRows.mock.calls.at(-1)![0].spec.filters).toHaveLength(1));
    await vi.waitFor(() => expect(api.getState().viewIndex).toHaveLength(10_000));
    document.querySelector<HTMLElement>('[role="grid"]')!.scrollTop = 500 * ROW_HEIGHT;
    await vi.waitFor(() => expect(fetchRows.mock.calls.some(([{ start, end }]) => start <= 500 && end > 500)).toBe(true));
    await vi.waitFor(() => expect(document.body.textContent).toContain("Person 500"));
  });

  it("a client filter over partial data empties the view", async () => {
    const sparse = new Array<Row | undefined>(1000);
    sparse[0] = { id: "row-0", name: "Person 0" };
    let api!: StoreApi<DataGridStoreState>;
    await render(
      <DataGridProvider data={sparse as Row[]} columns={columns} getRowId={(row: Row | undefined, index: number) => row?.id ?? `hole-${index}`} defaultFilterState={spec}>
        <StoreProbe onReady={(a) => (api = a)} />
      </DataGridProvider>,
    );
    await vi.waitFor(() => expect(api).toBeTruthy());
    expect(api.getState().viewIndex).toHaveLength(0);
  });
});

describe("scroll mode: checked rows across windows", () => {
  it("keeps the checked rows while other blocks load and across a server sort", async () => {
    const fetchRows = vi.fn<Fetch>(async ({ start, end, spec }) => {
      const reversed = spec.sorts.length > 0;
      const rows = makeRows(start, end);
      return { rows: reversed ? rows.map((row) => ({ ...row, id: `sorted-${row.id}` })) : rows, totalRowCount: 10_000 };
    });
    let api!: StoreApi<DataGridStoreState>;
    await render(<ServerGrid fetchRows={fetchRows} onReady={(a) => (api = a)} />);
    await vi.waitFor(() => expect(document.body.textContent).toContain("Person 0"));

    api.getState().actions.setRowSelected(1, true);
    api.getState().actions.setRowSelected(2, true);
    expect(readSelectedRows(api.getState())).toMatchObject({ mode: "ids", ids: ["row-1", "row-2"] });

    await scrollGridTo(500);
    await vi.waitFor(() => expect(document.body.textContent).toContain("Person 500"));
    expect(readSelectedRows(api.getState())).toMatchObject({ mode: "ids", ids: ["row-1", "row-2"] });

    api.getState().actions.setSorts([{ columnId: "name", direction: "asc" }]);
    await vi.waitFor(() => expect(fetchRows.mock.calls.at(-1)![0].spec.sorts).toHaveLength(1));
    await vi.waitFor(() => expect((api.getState().data as (Row | undefined)[]).some((row) => row?.id.startsWith("sorted-"))).toBe(true));
    const after = readSelectedRows(api.getState());
    expect(after.mode).toBe("ids");
    expect(after.ids).toEqual(expect.arrayContaining(["row-1", "row-2"]));
  });
});

describe("scroll mode: 100k rows", () => {
  it("a thumb drag commits the rows at most once per frame and loads the rows it lands on", async () => {
    const total = 100_000;
    // Each answer lands in its own macrotask, so one commit per answer would show up as several commits per frame.
    let answered = 0;
    const fetchRows = vi.fn<Fetch>(
      ({ start, end }) => new Promise((resolve) => setTimeout(() => resolve({ rows: makeRows(start, Math.min(end, total)), totalRowCount: total }), (answered++ % 4) * 3)),
    );
    // Effects lag the hook's commit under load, so a commit is bucketed by the frame counter at its effect.
    let frame = 0;
    let looping = true;
    const tick = () => {
      frame++;
      if (looping) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const commitFrames: number[] = [];

    function Probe(props: { data: unknown }) {
      const first = useRef(true);
      useEffect(() => {
        if (first.current) {
          first.current = false;
          return;
        }
        commitFrames.push(frame);
      }, [props.data]);
      return null;
    }
    function Grid() {
      const server = useDataGridServerRows<Row>({ mode: "scroll", getRowId: (row) => row.id, fetchRows, blockSize: 50, overscan: 30 });
      return (
        <div style={{ height: 360, width: 400 }}>
          <DataGridProvider {...server.providerProps} columns={columns}>
            <Probe data={server.providerProps.data} />
            <DataGridRoot className="h-90 w-100" {...server.rootProps}>
              <DataGridHeader />
              <DataGridBody />
            </DataGridRoot>
          </DataGridProvider>
        </div>
      );
    }
    await render(<Grid />);
    await expect.element(page.getByText("Person 0")).toBeInTheDocument();
    commitFrames.length = 0;

    const started = performance.now();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    let position = 0;
    for (let i = 0; i < 90; i++) {
      position = (position + 20_000 + Math.floor(Math.random() * 400_000)) % ((total - 20) * ROW_HEIGHT);
      grid.scrollTop = position;
      grid.dispatchEvent(new Event("scroll"));
      await nextFrame();
    }
    await vi.waitFor(() => expect(document.querySelectorAll('[role="gridcell"][data-skeleton]').length).toBe(0), { timeout: 5000 });
    await nextFrame();
    const elapsed = performance.now() - started;

    looping = false;
    // One commit per frame plus one for catch-up after a late effect: any 4 frames hold at most 5 commits.
    const worstWindow = Math.max(0, ...commitFrames.map((f) => commitFrames.filter((g) => g >= f && g < f + 4).length));
    expect(worstWindow).toBeLessThanOrEqual(5);
    expect(commitFrames.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(8000);
  });
});

describe("scroll mode: after a scroll beyond the origin rebase", () => {
  const offsetsFromScroll = () => {
    const gridTop = gridElement().getBoundingClientRect().top;
    return mountedRows().map((row) => {
      const rect = row.getBoundingClientRect();
      return rect.top - gridTop + gridElement().scrollTop - Number(row.dataset["gridRowIndex"]) * ROW_HEIGHT;
    });
  };
  const expectAllRowsAt = (offset: number) => {
    const offsets = offsetsFromScroll();
    expect(offsets.length).toBeGreaterThan(5);
    for (const value of offsets) expect(Math.abs(value - offset)).toBeLessThanOrEqual(1);
  };

  it("keeps skeleton rows and the rows that replace them at their scroll offset, and restores them at the top", async () => {
    const server = deferredServer();
    await render(<ServerGrid fetchRows={server.fetchRows} />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await vi.waitFor(() => expect(server.pending).toHaveLength(1));
    await server.resolveAll();
    const headerOffset = offsetsFromScroll()[0]!;
    expect(firstRowHeight()).toBe(ROW_HEIGHT);

    await scrollByTicks(600, ROW_HEIGHT);
    expect(originRebased()).toBe(true);
    expect(document.querySelectorAll('[role="row"][aria-busy="true"]').length).toBeGreaterThan(0);
    expectAllRowsAt(headerOffset);

    await server.resolveAll();
    await new Promise((r) => setTimeout(r, 100));
    await expect.element(page.getByText(/Person 6\d\d/).first()).toBeInTheDocument();
    expect(skeletonCells()).toBe(0);
    expectAllRowsAt(headerOffset);

    await scrollByTicks(0, ROW_HEIGHT);
    await server.resolveAll();
    await new Promise((r) => setTimeout(r, 100));
    expectAllRowsAt(headerOffset);
  });
});
