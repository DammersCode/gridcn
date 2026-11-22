import { createRef, useState, type CSSProperties, type RefObject } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, defineColumns, type DataGridApi, type ServerSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { groupIdOf, type PivotSpec } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { flashesIn, recordAcross, sampleGrid, type FrameSample } from "@/registry/default/blocks/data-grid/test/frame-timeline.test-helper";
import { fakeServer } from "./group-fake-server.test-helper";
import type { ServerRowsRequest } from "./read-answer";
import { useDataGridServerRows, type UseDataGridServerRowsResult } from "./use-data-grid-server-rows";
import type { UseDataGridServerRowsScrollResult } from "./scroll-types";
import "@/app/global.css";

type Row = { id: string; region: string; city: string; tier: string; qty: number };

const ROWS: Row[] = ["A", "B", "C"].flatMap((region, r) => Array.from({ length: 3 }, (_, i) => ({ id: `${region}${i}`, region, city: `${region}-c${i % 2}`, tier: i % 2 ? "hi" : "lo", qty: r * 3 + i + 1 })));

const MANY: Row[] = Array.from({ length: 400 }, (_, i) => ({ id: `m${i}`, region: ["A", "B", "C"][i % 3]!, city: `c${i % 7}`, tier: i % 2 ? "hi" : "lo", qty: i + 1 }));

const columns = defineColumns<Row>()([
  { id: "region", header: "Region", accessorKey: "region", type: "text", width: 120 },
  { id: "city", header: "City", accessorKey: "city", type: "text", width: 120 },
  { id: "tier", header: "Tier", accessorKey: "tier", type: "text", width: 100 },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", width: 100, aggregate: "sum" },
] as const);

const SUM = { columnId: "qty", reducer: "sum" } as const;

/** Sorts, searches, and pages `ROWS` like a real server; `hold()` parks every answer until `release()`. */
function gatedServer(cursor: boolean, source: readonly Row[] = ROWS) {
  const work: Row[] = [];
  const fake = fakeServer(work);
  let open = true;
  let parked: ((fail: boolean) => void)[] = [];
  const shape = (spec: ServerSpec) => {
    const text = spec.searchText.toLowerCase();
    const hits = source.filter((row) => text === "" || `${row.region} ${row.city}`.toLowerCase().includes(text));
    const sort = spec.sorts[0];
    if (!sort) return hits;
    const sign = sort.direction === "desc" ? -1 : 1;
    return [...hits].sort((a, b) => sign * String(a[sort.columnId as keyof Row]).localeCompare(String(b[sort.columnId as keyof Row]), "en", { numeric: true }));
  };
  const answer = (request: ServerRowsRequest<never>) => {
    work.splice(0, work.length, ...shape(request.spec));
    if (!cursor || request.childKind) return fake.fetchRows(request);
    const rows = work.slice(request.start, request.end);
    return Promise.resolve({ rows, nextCursor: request.end < work.length ? String(request.end) : null });
  };
  return {
    fetchRows: (request: ServerRowsRequest<never>) => {
      const result = answer(request);
      if (open) return result;
      return new Promise((resolve, reject) => parked.push((fail) => (fail ? reject(new Error("down")) : void result.then(resolve, reject))));
    },
    hold: () => void (open = false),
    release: (fail = false) => {
      open = true;
      const run = parked;
      parked = [];
      for (const go of run) go(fail);
    },
    idle: () => open && parked.length === 0,
  };
}

type Setup = { name: string; mode: "scroll" | "pages"; spec: Partial<ServerSpec>; cursor?: boolean; open?: boolean; rows?: readonly Row[]; scrollTop?: number; pivot?: PivotSpec; enableHold?: false; barDelay?: string; onRendered?: (range: { start: number; end: number }) => void };
type Server = UseDataGridServerRowsResult<Row> | UseDataGridServerRowsScrollResult<Row>;
type Handles = { api: RefObject<DataGridApi<Row> | null>; server: { current: Server | null }; setSpec: { current: (next: ServerSpec) => void }; setLabels: { current: (next: object) => void } };

function Harness({ setup, fetchRows, handles }: { setup: Setup; fetchRows: (request: ServerRowsRequest<never>) => Promise<unknown>; handles: Handles }) {
  const [spec, setSpec] = useState<ServerSpec>({ sorts: [], filters: [], searchText: "", groupBy: [], ...setup.spec });
  const [labels, setLabels] = useState<object>({});
  const [pivot, setPivot] = useState(setup.pivot);
  handles.setSpec.current = setSpec;
  handles.setLabels.current = setLabels;
  const options = { mode: setup.mode, fetchRows: fetchRows as never, spec, onSpecChange: setSpec, blockSize: 50, overscan: 0, loadDelayMs: 0, pageSizeOptions: setup.spec.groupBy ? [2, 4] : [4, 8], defaultPageSize: setup.spec.groupBy ? 2 : 4, ...(setup.open ? { defaultExpanded: { mode: "collapsed", ids: [groupIdOf([{ columnId: "region", key: "A" }])] } } : null), ...(pivot ? { pivot, onPivotChange: setPivot } : null), ...(setup.enableHold === false ? { enableHold: false } : null), ...(setup.onRendered ? { onRenderedRowsChange: setup.onRendered } : null) };
  const server = useDataGridServerRows<Row>(options as never) as Server;
  handles.server.current = server;
  return (
    <div style={{ height: 400, width: 700, ...(setup.barDelay ? { "--grid-loading-bar-delay": setup.barDelay } : null) } as CSSProperties}>
      <DataGrid ref={handles.api} {...server.gridProps} columns={columns} labels={labels} className="h-100 w-175" aria-label="Flash" />
    </div>
  );
}

const GRIDS: Setup[] = [
  { name: "flat scroll", mode: "scroll", spec: {} },
  { name: "sequential scroll", mode: "scroll", spec: {}, cursor: true },
  { name: "flat scroll scrolled past block 0", mode: "scroll", spec: {}, rows: MANY, scrollTop: 6000 },
  { name: "grouped scroll", mode: "scroll", spec: { groupBy: ["region"], aggregates: [SUM] } },
  { name: "pivot scroll", mode: "scroll", spec: { groupBy: ["region"], aggregates: [SUM], pivot: { columnIds: ["tier"] } } },
  { name: "pivot scroll with a controlled pivot", mode: "scroll", spec: { groupBy: ["region"], aggregates: [SUM] }, pivot: { columnIds: ["tier"] } },
  { name: "grouped scroll with an open group", mode: "scroll", spec: { groupBy: ["region"], aggregates: [SUM] }, open: true },
  { name: "grouped pages", mode: "pages", spec: { groupBy: ["region"], aggregates: [SUM] } },
  { name: "flat pages", mode: "pages", spec: {} },
  { name: "cursor pages", mode: "pages", spec: {}, cursor: true },
];

type Ctx = { api: DataGridApi<Row>; server: Server; spec: ServerSpec; setSpec: (next: ServerSpec) => void; setLabels: (next: object) => void; grouped: boolean };
type Action = { name: string; run: (ctx: Ctx) => void; applies?: (setup: Setup) => boolean; fetches?: boolean | ((setup: Setup) => boolean); lands?: (before: FrameSample, after: FrameSample, setup: Setup) => boolean | null };

const rowsChange = (before: FrameSample, after: FrameSample) => after.rows !== before.rows;
const headerChanges = (before: FrameSample, after: FrameSample) => after.header !== before.header;
const pivoted = (setup: Setup) => setup.spec.pivot !== undefined || setup.pivot !== undefined;

const ACTIONS: Action[] = [
  { name: "sort", lands: (before, after, setup) => (setup.spec.groupBy ? null : rowsChange(before, after)), fetches: true, run: ({ api, grouped }) => api.actions.setSorts([{ columnId: grouped ? "region" : "qty", direction: "desc" }]) },
  { name: "filter", fetches: true, run: ({ spec, setSpec }) => setSpec({ ...spec, filters: [{ columnId: "qty", operator: "gt", value: "0" }] }) },
  { name: "search", lands: rowsChange, fetches: true, run: ({ api }) => api.actions.setSearch("a") },
  { name: "search with no hit", lands: (_, after) => after.empty, fetches: true, run: ({ api }) => api.actions.setSearch("zzz") },
  { name: "groupBy", lands: (before, after, setup) => (setup.mode === "pages" && !setup.spec.groupBy ? null : rowsChange(before, after)), fetches: (setup) => setup.mode === "scroll" || setup.spec.groupBy !== undefined, run: ({ api, grouped }) => api.actions.setGroupBy(grouped ? ["city"] : ["region"]) },
  { name: "ungroup", lands: rowsChange, fetches: true, run: ({ api }) => api.actions.setGroupBy([]), applies: (setup) => setup.spec.groupBy !== undefined },
  { name: "pivot column", lands: headerChanges, fetches: true, run: ({ spec, setSpec }) => setSpec({ ...spec, pivot: { columnIds: ["city"] } }), applies: (setup) => setup.spec.pivot !== undefined },
  { name: "setPivot", lands: headerChanges, fetches: true, run: ({ api }) => api.actions.setPivot({ columnIds: api.store.getState().pivotColumnIds.length ? [] : ["tier"] }), applies: (setup) => setup.spec.groupBy !== undefined },
  { name: "refresh", fetches: true, run: ({ server }) => server.refresh() },
  { name: "page", lands: rowsChange, fetches: true, run: ({ server }) => (server as UseDataGridServerRowsResult<Row>).pager.onPageChange(2), applies: (setup) => setup.mode === "pages" },
  { name: "column reorder", lands: (before, after, setup) => (pivoted(setup) ? null : headerChanges(before, after)), run: ({ api }) => void api.actions.setColumnOrder("qty", "city", "before") },
  { name: "column resize", run: ({ api }) => api.actions.setColumnWidth("city", 200) },
  { name: "column hide", lands: (before, after, setup) => (pivoted(setup) ? null : headerChanges(before, after)), run: ({ api }) => api.actions.setColumnHidden("city", true) },
  { name: "labels", run: ({ setLabels }) => setLabels({ grid: { noResults: "Nothing found" } }) },
];

const frames = (count: number) => new Promise<void>((resolve) => {
  const step = (left: number) => (left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
  step(count);
});

async function flashOf(setup: Setup, action: Action, releaseAfterMs?: number) {
  const gate = gatedServer(setup.cursor === true, setup.rows);
  const handles: Handles = { api: createRef<DataGridApi<Row>>(), server: { current: null }, setSpec: { current: () => {} }, setLabels: { current: () => {} } };
  const screen = await render(<Harness setup={setup} fetchRows={gate.fetchRows} handles={handles} />);
  await vi.waitFor(() => expect(sampleGrid().busy || sampleGrid().rows === "").toBe(false));
  if (setup.scrollTop) {
    const grid = document.querySelector<HTMLElement>('[role="grid"], [role="treegrid"]')!;
    grid.scrollTop = setup.scrollTop;
    grid.dispatchEvent(new Event("scroll"));
    await vi.waitFor(() => expect(sampleGrid().busy || sampleGrid().placeholders > 0).toBe(false));
  }
  await frames(3);
  const before = sampleGrid();
  gate.hold();
  let released = !(typeof action.fetches === "function" ? action.fetches(setup) : action.fetches === true);
  let heldSeen = false;
  const unsubscribe = handles.api.current!.store.subscribe((state) => void (heldSeen ||= state.serverHeld));
  const samples = await recordAcross(
    () => {
      action.run({ api: handles.api.current!, server: handles.server.current!, spec: handles.server.current!.spec, setSpec: handles.setSpec.current, setLabels: handles.setLabels.current, grouped: (setup.spec.groupBy?.length ?? 0) > 0 });
      void (releaseAfterMs === undefined ? frames(4) : new Promise((resolve) => setTimeout(resolve, releaseAfterMs))).then(() => {
        released = true;
        gate.release();
      });
    },
    () => released && gate.idle() && !sampleGrid().busy,
    { released: () => released },
  );
  unsubscribe();
  const after = sampleGrid();
  await screen.unmount();
  return { heldSeen, flashes: flashesIn(samples, before, after), busy: samples.some((sample) => sample.busy), heldBusy: samples.filter((sample) => !sample.released).every((sample) => sample.busy), samples, before, after };
}

describe("a server grid whose answer to a new spec fails", () => {
  for (const setup of GRIDS.filter((grid) => grid.name === "flat scroll" || grid.name === "grouped scroll")) {
    it(`keeps the old rows next to the error bar, then shows the answer of a retry (${setup.name})`, async () => {
      const gate = gatedServer(false);
      const handles: Handles = { api: createRef<DataGridApi<Row>>(), server: { current: null }, setSpec: { current: () => {} }, setLabels: { current: () => {} } };
      const screen = await render(<Harness setup={setup} fetchRows={gate.fetchRows} handles={handles} />);
      await vi.waitFor(() => expect(sampleGrid().busy || sampleGrid().rows === "").toBe(false));
      const before = sampleGrid();
      gate.hold();
      handles.api.current!.actions.setSearch("a");
      await frames(4);
      gate.release(true);
      await vi.waitFor(() => expect(handles.server.current!.status).toBe("error"));
      await frames(2);
      expect(sampleGrid().rows).toBe(before.rows);
      expect(sampleGrid().empty).toBe(false);
      expect(document.querySelector("[data-grid-error-state]")).not.toBeNull();
      handles.server.current!.retry();
      await vi.waitFor(() => expect(handles.server.current!.status).toBe("ready"));
      await vi.waitFor(() => expect(sampleGrid().rows).not.toBe(before.rows));
      await screen.unmount();
    });
  }
});

describe("a server grid paints no frame that differs from both the old and the new state", () => {
  for (const setup of GRIDS) {
    describe(setup.name, () => {
      for (const action of ACTIONS) {
        if (action.applies && !action.applies(setup)) continue;
        it(`across a ${action.name} change`, async () => {
          const { flashes, busy, heldBusy, before, after } = await flashOf(setup, action);
          const landed = action.lands?.(before, after, setup) ?? null;
          if (landed !== null) expect(landed, "the change landed").toBe(true);
          expect(flashes.slice(0, 3)).toEqual([]);
          if (typeof action.fetches === "function" ? action.fetches(setup) : action.fetches) {
            expect(busy).toBe(true);
            // A refresh revalidates in place and starts no hold.
            if (action.name !== "refresh") expect(heldBusy, "aria-busy holds until the release").toBe(true);
          }
        });
      }
    });
  }
});

describe("a held server grid shows the loading bar only for a slow answer", () => {
  const filter = ACTIONS.find((action) => action.name === "filter")!;
  for (const setup of GRIDS.filter((grid) => grid.name === "flat scroll" || grid.name === "grouped scroll" || grid.name === "flat pages")) {
    it(`shows no bar for a fast answer (${setup.name})`, async () => {
      // A show delay far above the answer time keeps the test independent of the runner load.
      const { flashes, heldBusy, samples } = await flashOf({ ...setup, barDelay: "60s" }, filter, 20);
      expect(flashes.slice(0, 3)).toEqual([]);
      expect(heldBusy).toBe(true);
      expect(samples.filter((sample) => sample.loadingBar)).toEqual([]);
    });

    it(`shows the bar after the show delay for a slow answer (${setup.name})`, async () => {
      const { flashes, heldBusy, samples } = await flashOf(setup, filter, 600);
      expect(flashes.slice(0, 3)).toEqual([]);
      expect(heldBusy).toBe(true);
      const shown = samples.filter((sample) => sample.loadingBar && !sample.released);
      expect(shown.length, "the bar shows while the rows are held").toBeGreaterThan(0);
      expect(samples.find((sample) => !sample.released)?.loadingBar, "the first held sample is inside the show delay").toBe(false);
    });
  }
});

/** What a change shows before its answer with `enableHold: false`, as in 2.0. */
function OFF_SHAPE(setup: Setup, action: Action) {
  const groupedAfter = setup.spec.groupBy !== undefined ? action.name !== "ungroup" : action.name === "groupBy";
  // A new group request shows the empty state, busy only once its request leaves; a group page shows its unloaded rows.
  if (groupedAfter) return { busy: true, allBusy: false, empty: action.name !== "page", kept: false };
  // A flat page keeps its rows until the next page lands; the switch from groups starts with no flat rows.
  if (setup.mode === "pages") return { busy: true, allBusy: true, empty: false, kept: action.name !== "ungroup" };
  return { busy: true, allBusy: true, empty: false, kept: false };
}

describe("a server grid with enableHold: false clears the rows as before and never holds", () => {
  const fetching = (action: Action, setup: Setup) => action.name !== "refresh" && (typeof action.fetches === "function" ? action.fetches(setup) : action.fetches === true);
  for (const grid of GRIDS) {
    const setup: Setup = { ...grid, enableHold: false };
    describe(setup.name, () => {
      for (const action of ACTIONS) {
        if ((action.applies && !action.applies(setup)) || !fetching(action, setup)) continue;
        // A flat page keeps its rows until the next page lands, as it did before the hold.
        const clears = setup.mode === "scroll" || setup.spec.groupBy !== undefined || action.name === "groupBy";
        it(`across a ${action.name} change`, async () => {
          const { heldSeen, samples, before, after } = await flashOf(setup, action);
          const landed = action.lands?.(before, after, setup) ?? null;
          if (landed !== null) expect(landed, "the change landed").toBe(true);
          expect(heldSeen, "serverHeld stays false").toBe(false);
          if (clears) expect(samples.some((sample) => !sample.released && sample.rows !== before.rows), "the old rows leave before the answer").toBe(true);
          const held = samples.filter((sample) => !sample.released);
          const shape = { busy: held.some((sample) => sample.busy), allBusy: held.every((sample) => sample.busy), empty: held.some((sample) => sample.empty), kept: held.every((sample) => sample.rows === before.rows) };
          expect(shape).toEqual(OFF_SHAPE(setup, action));
          if (pivoted(setup)) expect(held.some((sample) => sample.header !== before.header), "the held pivot columns clear with the rows").toBe(true);
        });
      }
    });
  }
});

describe("a scrolled server grid whose row count grows back after a shrink", () => {
  it("renders the rows of the grown count at once and reports their range, with no scroll in between", async () => {
    const ranges: { start: number; end: number }[] = [];
    const setup: Setup = { name: "flat scroll scrolled", mode: "scroll", spec: {}, rows: MANY, onRendered: (range) => ranges.push(range) };
    const gate = gatedServer(false, MANY);
    const handles: Handles = { api: createRef<DataGridApi<Row>>(), server: { current: null }, setSpec: { current: () => {} }, setLabels: { current: () => {} } };
    const screen = await render(<Harness setup={setup} fetchRows={gate.fetchRows} handles={handles} />);
    await vi.waitFor(() => expect(sampleGrid().busy || sampleGrid().rows === "").toBe(false));
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    grid.scrollTop = 6000;
    grid.dispatchEvent(new Event("scroll"));
    await vi.waitFor(() => expect(sampleGrid().busy || sampleGrid().placeholders > 0).toBe(false));
    handles.api.current!.actions.setSearch("A c1");
    await vi.waitFor(() => expect(!sampleGrid().busy && sampleGrid().rows.split("\n").every((row) => row.startsWith("Ac1"))).toBe(true));
    await frames(3);
    const before = sampleGrid();
    gate.hold();
    let released = false;
    const samples = await recordAcross(
      () => {
        handles.api.current!.actions.setSearch("");
        void frames(4).then(() => {
          released = true;
          gate.release();
        });
      },
      () => released && gate.idle() && !sampleGrid().busy && sampleGrid().placeholders === 0,
      { released: () => released },
    );
    const after = sampleGrid();
    expect(after.rows).not.toBe("");
    expect(after.placeholders).toBe(0);
    expect(flashesIn(samples, before, after).slice(0, 3)).toEqual([]);
    const canvas = document.querySelector<HTMLElement>("[data-grid-rows-canvas]")!;
    expect(ranges.at(-1)).toEqual({ start: Number(canvas.dataset["gridWindowStart"]), end: Number(canvas.dataset["gridWindowEnd"]) });
    const shown = [...canvas.querySelectorAll<HTMLElement>("[role=row][data-grid-row-index]")].map((row) => Number(row.dataset["gridRowIndex"]));
    expect(Math.min(...shown)).toBe(ranges.at(-1)!.start);
    expect(Math.max(...shown) + 1).toBe(ranges.at(-1)!.end);
    await screen.unmount();
  });
});
