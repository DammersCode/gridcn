import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns, type ServerSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { pivotColumnId } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { flashesIn, recordAcross, sampleGrid, type FrameSample } from "@/registry/default/blocks/data-grid/test/frame-timeline.test-helper";
import { useDataGridServerRows } from "@/registry/default/blocks/data-grid-server/data-grid-server";
import { fakeServer } from "@/registry/default/blocks/data-grid-server/group-fake-server.test-helper";
import type { ServerRowsRequest } from "@/registry/default/blocks/data-grid-server/read-answer";
import { useDataGridViews, type UseDataGridViewsResult } from "./use-data-grid-views";
import { createMemoryViewsStorage } from "./view-storage";
import { emptyViewState, type DataGridViewState, type DataGridViewsDocument } from "./view-state";
import "@/app/global.css";

type Row = { id: string; region: string; tier: string; qty: number };

const ROWS: Row[] = ["A", "B", "C"].flatMap((region, r) => Array.from({ length: 3 }, (_, i) => ({ id: `${region}${i}`, region, tier: i % 2 ? "hi" : "lo", qty: r * 3 + i + 1 })));

const columns = defineColumns<Row>()([
  { id: "region", header: "Region", accessorKey: "region", type: "text", width: 120 },
  { id: "tier", header: "Tier", accessorKey: "tier", type: "text", width: 100 },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", width: 100, aggregate: "sum" },
] as const);

const SUM = { columnId: "qty", reducer: "sum" } as const;
const HI = pivotColumnId("tier", "hi", SUM);
const LO = pivotColumnId("tier", "lo", SUM);
const PIVOTED: DataGridViewState = { ...emptyViewState(), groupBy: ["region"], sorts: [{ columnId: "region", direction: "desc" }], pivotColumnId: "tier", pivotWidths: { [HI]: 230, [LO]: 170 } };
const FLAT: DataGridViewState = { ...emptyViewState(), sorts: [{ columnId: "qty", direction: "desc" }] };
const BY_REGION: DataGridViewState = { ...emptyViewState(), groupBy: ["tier"], pivotColumnId: "region" };
const DEEP: DataGridViewState = { ...PIVOTED, groupBy: ["region", "qty"] };
const doc = (): DataGridViewsDocument => ({
  version: 1,
  defaultViewId: null,
  views: [
    { id: "pivot", name: "Pivot", state: PIVOTED },
    { id: "flat", name: "Flat", state: FLAT },
    { id: "region", name: "Pivot by region", state: BY_REGION },
    { id: "deep", name: "Two levels", state: DEEP },
  ],
});

type Handle = { current: UseDataGridViewsResult | null };

function Views({ handle, storage }: { handle: Handle; storage: ReturnType<typeof createMemoryViewsStorage> }) {
  handle.current = useDataGridViews({ storage, enableDefaultView: false });
  return null;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: 400, width: 900 }}>
      <DataGridRoot aria-label="Views" className="h-100 w-225">
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
      {children}
    </div>
  );
}

function ClientGrid({ handle }: { handle: Handle }) {
  const [storage] = useState(() => createMemoryViewsStorage(doc()));
  return (
    <DataGridProvider data={ROWS} columns={columns} getRowId={(row) => row.id} defaultGroupBy={[]}>
      <Shell>
        <Views handle={handle} storage={storage} />
      </Shell>
    </DataGridProvider>
  );
}

/** Answers like a server; `hold()` parks every answer until `release()`. */
function gatedServer() {
  const fake = fakeServer([...ROWS]);
  let open = true;
  let parked: (() => void)[] = [];
  return {
    fetchRows: (request: ServerRowsRequest<never>) => (open ? fake.fetchRows(request) : new Promise((resolve) => parked.push(() => void fake.fetchRows(request).then(resolve)))),
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

/** One spec state: the hook carries the pivot of the grid into its spec. */
function ServerGrid({ handle, fetchRows }: { handle: Handle; fetchRows: (request: ServerRowsRequest<never>) => Promise<unknown> }) {
  const [storage] = useState(() => createMemoryViewsStorage(doc()));
  const [spec, setSpec] = useState<ServerSpec>({ sorts: [], filters: [], searchText: "", groupBy: [], aggregates: [SUM] });
  const server = useDataGridServerRows<Row>({ mode: "scroll", getRowId: (row) => row.id, fetchRows: fetchRows as never, spec, onSpecChange: setSpec, blockSize: 50, overscan: 0, loadDelayMs: 0 });
  return (
    <DataGridProvider {...server.providerProps} columns={columns}>
      <DataGridRoot aria-label="Views" className="h-100 w-225" {...server.rootProps}>
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
      <Views handle={handle} storage={storage} />
    </DataGridProvider>
  );
}

const headerWidth = (id: string) => document.querySelector<HTMLElement>(`[role="columnheader"][data-column-id="${CSS.escape(id)}"]`)?.getBoundingClientRect().width;

/** Every frame that paints a generated header paints it at its saved width. */
function widthWatch() {
  const wrong: string[] = [];
  const check = () => {
    for (const [id, width] of Object.entries(PIVOTED.pivotWidths!)) {
      const painted = headerWidth(id);
      if (painted !== undefined && Math.abs(painted - width) > 1) wrong.push(`${id.slice(0, 20)} at ${painted}`);
    }
  };
  return { check, wrong };
}

/** The pivot warnings of the grid; a built-in restore is no misuse, so it raises none. */
function warnSpy() {
  const warn = vi.spyOn(console, "warn");
  const error = vi.spyOn(console, "error");
  return () => {
    const found = [...warn.mock.calls, ...error.mock.calls].map(String).filter((call) => call.includes("pivot"));
    warn.mockRestore();
    error.mockRestore();
    return found;
  };
}

// Under a second groupBy level the top-level pivot rows paint as before, so that change lands without a visible difference.
const landed = (before: FrameSample, after: FrameSample, to: string) => to === "deep" || after.header !== before.header;

describe("restoring a saved view paints no frame that differs from both the old and the new state", () => {
  for (const [from, to] of [["flat", "pivot"], ["pivot", "flat"], ["pivot", "region"], ["pivot", "deep"]] as const) {
    it(`on a client grid, from the ${from} view to the ${to} view`, async () => {
      const warnings = warnSpy();
      const handle: Handle = { current: null };
      const screen = await render(<ClientGrid handle={handle} />);
      await vi.waitFor(() => expect(handle.current?.loading).toBe(false));
      handle.current!.selectView(from);
      await vi.waitFor(() => expect(sampleGrid().rows).not.toBe(""));
      const before = sampleGrid();
      const widths = widthWatch();
      let frames = 0;
      const samples = await recordAcross(() => handle.current!.selectView(to), () => {
        widths.check();
        return ++frames > 3;
      });
      const after = sampleGrid();
      expect(landed(before, after, to), "the view landed").toBe(true);
      expect(handle.current!.modified).toBe(false);
      expect(flashesIn(samples, before, after).slice(0, 3)).toEqual([]);
      expect(widths.wrong.slice(0, 3)).toEqual([]);
      if (to === "pivot") expect(headerWidth(HI)).toBeCloseTo(230, 0);
      expect(warnings()).toEqual([]);
      await screen.unmount();
    });

    it(`on a server grid, from the ${from} view to the ${to} view`, async () => {
      const warnings = warnSpy();
      const gate = gatedServer();
      const handle: Handle = { current: null };
      const screen = await render(<ServerGrid handle={handle} fetchRows={gate.fetchRows} />);
      await vi.waitFor(() => expect(handle.current?.loading).toBe(false));
      handle.current!.selectView(from);
      await vi.waitFor(() => expect(sampleGrid().busy || sampleGrid().rows === "").toBe(false));
      if (from === "pivot") await vi.waitFor(() => expect(headerWidth(HI)).toBeDefined());
      const before = sampleGrid();
      gate.hold();
      let released = false;
      const widths = widthWatch();
      let frames = 0;
      const samples = await recordAcross(
        () => {
          handle.current!.selectView(to);
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => {
            released = true;
            gate.release();
          })));
        },
        () => {
          widths.check();
          return released && gate.idle() && !sampleGrid().busy && ++frames > 3;
        },
        { released: () => released },
      );
      const after = sampleGrid();
      expect(landed(before, after, to), "the view landed").toBe(true);
      expect(handle.current!.modified).toBe(false);
      expect(flashesIn(samples, before, after).slice(0, 3)).toEqual([]);
      expect(widths.wrong.slice(0, 3)).toEqual([]);
      if (to === "pivot") expect(headerWidth(HI)).toBeCloseTo(230, 0);
      expect(warnings()).toEqual([]);
      await screen.unmount();
    });
  }
});
