import { createRef, useState, type RefObject } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, defineColumns, type DataGridApi, type ServerSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { groupIdOf } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { flashesIn, recordAcross, sampleGrid } from "@/registry/default/blocks/data-grid/test/frame-timeline.test-helper";
import { fakeServer } from "./group-fake-server.test-helper";
import type { ServerRowsRequest } from "./read-answer";
import { useDataGridServerRows, type UseDataGridServerRowsResult } from "./use-data-grid-server-rows";
import type { UseDataGridServerRowsScrollResult } from "./scroll-types";
import "@/app/global.css";

type Row = { id: string; region: string; city: string; tier: string; qty: number };

const ROWS: Row[] = ["A", "B", "C"].flatMap((region, r) => Array.from({ length: 3 }, (_, i) => ({ id: `${region}${i}`, region, city: `${region}-c${i % 2}`, tier: i % 2 ? "hi" : "lo", qty: r * 3 + i + 1 })));

const columns = defineColumns<Row>()([
  { id: "region", header: "Region", accessorKey: "region", type: "text", width: 120 },
  { id: "city", header: "City", accessorKey: "city", type: "text", width: 120 },
  { id: "tier", header: "Tier", accessorKey: "tier", type: "text", width: 100 },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", width: 100, aggregate: "sum" },
] as const);

const SUM = { columnId: "qty", reducer: "sum" } as const;

/** Sorts, searches, and pages `ROWS` like a real server; `hold()` parks every answer until `release()`. */
function gatedServer(cursor: boolean) {
  const work: Row[] = [];
  const fake = fakeServer(work);
  let open = true;
  let parked: (() => void)[] = [];
  const shape = (spec: ServerSpec) => {
    const text = spec.searchText.toLowerCase();
    const hits = ROWS.filter((row) => text === "" || `${row.region} ${row.city}`.toLowerCase().includes(text));
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
      return new Promise((resolve, reject) => parked.push(() => void result.then(resolve, reject)));
    },
    hold: () => void (open = false),
    release: () => {
      open = true;
      const run = parked;
      parked = [];
      for (const go of run) go();
    },
    idle: () => open && parked.length === 0,
  };
}

type Setup = { name: string; mode: "scroll" | "pages"; spec: Partial<ServerSpec>; cursor?: boolean; open?: boolean };
type Server = UseDataGridServerRowsResult<Row> | UseDataGridServerRowsScrollResult<Row>;
type Handles = { api: RefObject<DataGridApi<Row> | null>; server: { current: Server | null }; setSpec: { current: (next: ServerSpec) => void }; setLabels: { current: (next: object) => void } };

function Harness({ setup, fetchRows, handles }: { setup: Setup; fetchRows: (request: ServerRowsRequest<never>) => Promise<unknown>; handles: Handles }) {
  const [spec, setSpec] = useState<ServerSpec>({ sorts: [], filters: [], searchText: "", groupBy: [], ...setup.spec });
  const [labels, setLabels] = useState<object>({});
  handles.setSpec.current = setSpec;
  handles.setLabels.current = setLabels;
  const options = { mode: setup.mode, fetchRows: fetchRows as never, spec, onSpecChange: setSpec, blockSize: 50, loadDelayMs: 0, pageSizeOptions: setup.spec.groupBy ? [2, 4] : [4, 8], defaultPageSize: setup.spec.groupBy ? 2 : 4, ...(setup.open ? { defaultExpanded: { mode: "collapsed", ids: [groupIdOf([{ columnId: "region", key: "A" }])] } } : null) };
  const server = useDataGridServerRows<Row>(options as never) as Server;
  handles.server.current = server;
  return (
    <div style={{ height: 400, width: 700 }}>
      <DataGrid ref={handles.api} {...server.gridProps} columns={columns} labels={labels} className="h-100 w-175" aria-label="Flash" />
    </div>
  );
}

const GRIDS: Setup[] = [
  { name: "flat scroll", mode: "scroll", spec: {} },
  { name: "sequential scroll", mode: "scroll", spec: {}, cursor: true },
  { name: "grouped scroll", mode: "scroll", spec: { groupBy: ["region"], aggregates: [SUM] } },
  { name: "pivot scroll", mode: "scroll", spec: { groupBy: ["region"], aggregates: [SUM], pivot: { columnIds: ["tier"] } } },
  { name: "grouped scroll with an open group", mode: "scroll", spec: { groupBy: ["region"], aggregates: [SUM] }, open: true },
  { name: "grouped pages", mode: "pages", spec: { groupBy: ["region"], aggregates: [SUM] } },
  { name: "flat pages", mode: "pages", spec: {} },
  { name: "cursor pages", mode: "pages", spec: {}, cursor: true },
];

type Ctx = { api: DataGridApi<Row>; server: Server; spec: ServerSpec; setSpec: (next: ServerSpec) => void; setLabels: (next: object) => void; grouped: boolean };
type Action = { name: string; run: (ctx: Ctx) => void; applies?: (setup: Setup) => boolean; fetches?: boolean | ((setup: Setup) => boolean) };

const ACTIONS: Action[] = [
  { name: "sort", fetches: true, run: ({ api, grouped }) => api.actions.setSorts([{ columnId: grouped ? "region" : "qty", direction: "desc" }]) },
  { name: "filter", fetches: true, run: ({ spec, setSpec }) => setSpec({ ...spec, filters: [{ columnId: "qty", operator: "gt", value: "0" }] }) },
  { name: "search", fetches: true, run: ({ api }) => api.actions.setSearch("a") },
  { name: "search with no hit", fetches: true, run: ({ api }) => api.actions.setSearch("zzz") },
  { name: "groupBy", fetches: (setup) => setup.mode === "scroll" || setup.spec.groupBy !== undefined, run: ({ api, grouped }) => api.actions.setGroupBy(grouped ? ["city"] : ["region"]) },
  { name: "ungroup", fetches: true, run: ({ api }) => api.actions.setGroupBy([]), applies: (setup) => setup.spec.groupBy !== undefined },
  { name: "pivot column", fetches: true, run: ({ spec, setSpec }) => setSpec({ ...spec, pivot: { columnIds: ["city"] } }), applies: (setup) => setup.spec.pivot !== undefined },
  { name: "refresh", fetches: true, run: ({ server }) => server.refresh() },
  { name: "page", fetches: true, run: ({ server }) => (server as UseDataGridServerRowsResult<Row>).pager.onPageChange(2), applies: (setup) => setup.mode === "pages" },
  { name: "column reorder", run: ({ api }) => void api.actions.setColumnOrder("qty", "city", "before") },
  { name: "column resize", run: ({ api }) => api.actions.setColumnWidth("city", 200) },
  { name: "column hide", run: ({ api }) => api.actions.setColumnHidden("city", true) },
  { name: "labels", run: ({ setLabels }) => setLabels({ grid: { noResults: "Nothing found" } }) },
];

const frames = (count: number) => new Promise<void>((resolve) => {
  const step = (left: number) => (left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
  step(count);
});

async function flashOf(setup: Setup, action: Action) {
  const gate = gatedServer(setup.cursor === true);
  const handles: Handles = { api: createRef<DataGridApi<Row>>(), server: { current: null }, setSpec: { current: () => {} }, setLabels: { current: () => {} } };
  const screen = await render(<Harness setup={setup} fetchRows={gate.fetchRows} handles={handles} />);
  await vi.waitFor(() => expect(sampleGrid().busy || sampleGrid().rows === "").toBe(false));
  await frames(3);
  const before = sampleGrid();
  gate.hold();
  let released = false;
  const samples = await recordAcross(
    () => {
      action.run({ api: handles.api.current!, server: handles.server.current!, spec: handles.server.current!.spec, setSpec: handles.setSpec.current, setLabels: handles.setLabels.current, grouped: (setup.spec.groupBy?.length ?? 0) > 0 });
      void frames(4).then(() => {
        released = true;
        gate.release();
      });
    },
    () => released && gate.idle() && !sampleGrid().busy,
  );
  const after = sampleGrid();
  await screen.unmount();
  return { flashes: flashesIn(samples, before, after), busy: samples.some((sample) => sample.busy), before, after };
}

describe("a server grid paints no frame that differs from both the old and the new state", () => {
  for (const setup of GRIDS) {
    describe(setup.name, () => {
      for (const action of ACTIONS) {
        if (action.applies && !action.applies(setup)) continue;
        it(`across a ${action.name} change`, async () => {
          const { flashes, busy } = await flashOf(setup, action);
          expect(flashes.slice(0, 3)).toEqual([]);
          if (typeof action.fetches === "function" ? action.fetches(setup) : action.fetches) expect(busy).toBe(true);
        });
      }
    });
  }
});
