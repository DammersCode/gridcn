import { trackRenders } from "@/registry/default/blocks/data-grid/test/render-counter.test-helper";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns, useDataGridActions, type DataGridActions, type ServerSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { fakeServer, rowsOf, type Row } from "./group-fake-server.test-helper";
import { useDataGridServerRows, type UseDataGridServerRowsScrollResult } from "./use-data-grid-server-rows";
import "@/app/global.css";

const columns = defineColumns<Row>()([
  { id: "region", header: "Region", accessorKey: "region", type: "text", width: 160 },
  { id: "city", header: "City", accessorKey: "city", type: "text", width: 120 },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", width: 100, aggregate: "sum" },
] as const);

const SUM = { columnId: "qty", reducer: "sum" } as const;
const treegrid = () => document.querySelector<HTMLElement>('[role="treegrid"]')!;

function Grid({ server, spec, onServer }: { server: ReturnType<typeof fakeServer<Row>>; spec: Partial<ServerSpec>; onServer: (result: UseDataGridServerRowsScrollResult<Row>) => void }) {
  const result = useDataGridServerRows<Row>({ mode: "scroll", fetchRows: server.fetchRows as never, blockSize: 20, loadDelayMs: 0, defaultSpec: spec });
  useEffect(() => {
    onServer(result);
  });
  return (
    <div style={{ height: 360, width: 600 }}>
      <DataGridProvider {...result.providerProps} columns={columns}>
        <DataGridRoot className="h-90 w-150" {...result.rootProps}>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}

async function rendersOverFiveLandings(spec: Partial<ServerSpec>) {
  const tracker = trackRenders();
  const server = fakeServer(rowsOf({ A: 4, B: 3, C: 2 }));
  let latest!: UseDataGridServerRowsScrollResult<Row>;
  const screen = await render(<Grid server={server} spec={spec} onServer={(result) => (latest = result)} />);
  await vi.waitFor(() => expect(treegrid().querySelectorAll("[data-grid-group-row]")).toHaveLength(3));
  await new Promise((resolve) => setTimeout(resolve, 100));
  const mount = { header: tracker.count("DataGridHeader"), body: tracker.count("DataGridBody") };
  for (let landing = 2; landing <= 5; landing++) {
    latest.refresh();
    await vi.waitFor(() => expect(server.calls).toHaveLength(landing));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const landed = { header: tracker.count("DataGridHeader") - mount.header, body: tracker.count("DataGridBody") - mount.body };
  const generatedHeader = treegrid().querySelector('[role="columnheader"][aria-label^="A-c0"]') !== null;
  await screen.unmount();
  return { mount, landed, server, generatedHeader };
}

const PLAIN: Partial<ServerSpec> = { groupBy: ["region"], aggregates: [SUM] };

// The React compiler changes the absolute counts, so each bound holds in both builds.
describe("a grouped server grid's render counts", () => {
  it("renders the header at most once and the body at most twice per landing without pivot", async () => {
    const { mount, landed } = await rendersOverFiveLandings(PLAIN);
    expect([mount.header > 0, mount.body > 0, landed.body > 0]).toEqual([true, true, true]);
    expect(landed.header).toBeLessThanOrEqual(4);
    expect(landed.body).toBeLessThanOrEqual(8);
  });

  it("renders the header and the body no more often under pivot than without it, once the held set stands", async () => {
    const plain = await rendersOverFiveLandings(PLAIN);
    const pivot = await rendersOverFiveLandings({ ...PLAIN, pivot: { columnIds: ["city"] } });
    expect([pivot.mount.header > 0, pivot.mount.body > 0, pivot.landed.body > 0]).toEqual([true, true, true]);
    expect(pivot.generatedHeader).toBe(true);
    expect(pivot.server.calls.every((call) => call.childKind === "groups")).toBe(true);
    expect(pivot.landed.header).toBeLessThanOrEqual(plain.landed.header);
    expect(pivot.landed.body).toBeLessThanOrEqual(plain.landed.body);
  });
});

type Frame = { header: string[]; rows: string[]; empty: boolean };
const snapshot = (): Frame => ({
  header: [...treegrid().querySelectorAll('[role="columnheader"]')].map((cell) => cell.textContent ?? ""),
  rows: [...treegrid().querySelectorAll('[role="row"][data-grid-row-index]')].map((row) => row.textContent ?? ""),
  empty: document.querySelector("[data-grid-empty-state]") !== null,
});

async function timeline(run: () => void, frames: number): Promise<Frame[]> {
  const samples: Frame[] = [];
  await new Promise<void>((resolve) => {
    let left = frames;
    const tick = () => {
      samples.push(snapshot());
      if (--left === 0) resolve();
      else requestAnimationFrame(tick);
    };
    run();
    requestAnimationFrame(tick);
  });
  return samples;
}

function ActionsProbe({ onActions }: { onActions: (actions: DataGridActions) => void }) {
  onActions(useDataGridActions());
  return null;
}

function PivotSwitch({ fetchRows, onActions }: { fetchRows: unknown; onActions: (actions: DataGridActions) => void }) {
  const result = useDataGridServerRows<Row>({ mode: "scroll", fetchRows: fetchRows as never, blockSize: 20, loadDelayMs: 0, defaultSpec: PLAIN });
  return (
    <div style={{ height: 360, width: 600 }}>
      <DataGridProvider {...result.providerProps} columns={columns}>
        <ActionsProbe onActions={onActions} />
        <DataGridRoot className="h-90 w-150" {...result.rootProps}>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}

describe("a grouped server grid that the grid's setPivot switches", () => {
  it("keeps the old rows and columns on screen until the answer lands, both ways", async () => {
    const server = fakeServer(rowsOf({ A: 4, B: 3, C: 2 }));
    // Holds each answer for several frames, so the timeline sees the pending state.
    const slow = (request: never) => new Promise((resolve) => setTimeout(() => resolve(server.fetchRows(request)), 150));
    let actions!: DataGridActions;
    const screen = await render(<PivotSwitch fetchRows={slow} onActions={(next) => (actions = next)} />);
    await vi.waitFor(() => expect(treegrid().querySelectorAll("[data-grid-group-row]")).toHaveLength(3));
    const plain = snapshot();
    const toPivot = await timeline(() => actions.setPivot({ columnIds: ["city"] }), 30);
    await vi.waitFor(() => expect(treegrid().querySelector('[role="columnheader"][aria-label^="A-c0"]')).not.toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 50));
    const pivot = snapshot();
    expect(server.calls.at(-1)!.spec.pivot).toEqual({ columnIds: ["city"] });
    expect(pivot).not.toEqual(plain);
    expect(toPivot[3]).toEqual(plain);
    for (const [i, frame] of toPivot.entries()) expect([plain, pivot], `frame ${i}`).toContainEqual(frame);

    const toPlain = await timeline(() => actions.setPivot({ columnIds: [] }), 30);
    await vi.waitFor(() => expect(snapshot()).toEqual(plain));
    expect(server.calls.at(-1)!.spec.pivot).toBeUndefined();
    expect(toPlain[3]).toEqual(pivot);
    for (const [i, frame] of toPlain.entries()) expect([pivot, plain], `frame ${i}`).toContainEqual(frame);
    await screen.unmount();
  });

  it("keeps a scrolled grid's rows until the answer lands, then shows the new rows from the top", async () => {
    const server = fakeServer(rowsOf(Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`R${String(i).padStart(3, "0")}`, 1]))));
    const slow = (request: never) => new Promise((resolve) => setTimeout(() => resolve(server.fetchRows(request)), 150));
    let actions!: DataGridActions;
    const screen = await render(<PivotSwitch fetchRows={slow} onActions={(next) => (actions = next)} />);
    await vi.waitFor(() => expect(treegrid().querySelectorAll("[data-grid-group-row]").length).toBeGreaterThan(3));
    treegrid().scrollTop = 3000;
    treegrid().dispatchEvent(new Event("scroll"));
    await vi.waitFor(() => expect(snapshot().rows.every((row) => row.startsWith("Region: R"))).toBe(true));
    const scrolled = snapshot();
    const frames = await timeline(() => actions.setPivot({ columnIds: ["city"] }), 40);
    await vi.waitFor(() => expect(treegrid().querySelector('[role="columnheader"][aria-label^="R000-c0"]')).not.toBeNull());
    expect(treegrid().scrollTop).toBe(0);
    expect(frames[3]).toEqual(scrolled);
    for (const [i, frame] of frames.entries()) expect(frame.rows.some((row) => row.startsWith("Region: R")), `frame ${i}`).toBe(true);
    await vi.waitFor(() => expect(snapshot().rows[0]).toContain("R000"));
    await screen.unmount();
  });
});
