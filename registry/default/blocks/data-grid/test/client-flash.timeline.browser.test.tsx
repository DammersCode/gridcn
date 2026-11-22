import { createRef, useState, type ComponentProps, type ReactElement, type Ref } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, defineColumns, type DataGridApi } from "../data-grid";
import { useDataGridComments, type UseDataGridCommentsResult } from "@/registry/default/blocks/data-grid-comments/data-grid-comments";
import { useDataGridPinnedRows } from "@/registry/default/blocks/data-grid-pinned-rows/data-grid-pinned-rows";
import { gridAttrSelector } from "../data-grid-sdk";
import { flashesIn, recordAcross, sampleGrid, type FrameSample } from "./frame-timeline.test-helper";
import "@/app/global.css";

type Row = { id: string; name: string; city: string; qty: number };

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 120 },
  { id: "city", header: "City", accessorKey: "city", type: "text", width: 120 },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", width: 100 },
] as const);

const data: Row[] = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, name: `Name ${i}`, city: i % 2 ? "Oslo" : "Rome", qty: i }));

type Handles = { api: ReturnType<typeof createRef<DataGridApi<Row>>>; setDir: { current: (dir: "ltr" | "rtl") => void } };

function Harness({ handles, paged }: { handles: Handles; paged: boolean }) {
  const [dir, setDir] = useState<"ltr" | "rtl">("ltr");
  handles.setDir.current = setDir;
  return (
    <div dir={dir} style={{ height: 400, width: 600 }}>
      <DataGrid ref={handles.api} columns={columns} data={data} getRowId={(row) => row.id} {...(paged ? { defaultPageSize: 5 } : null)} className="h-100 w-150" aria-label="Client" />
    </div>
  );
}

const ACTIONS: { name: string; run: (api: DataGridApi<Row>, handles: Handles) => void }[] = [
  { name: "page change", run: (api) => api.actions.setPage(2) },
  { name: "sort", run: (api) => api.actions.setSorts([{ columnId: "qty", direction: "desc" }]) },
  { name: "filter", run: (api) => api.actions.setFilters([{ columnId: "city", operator: "equals", value: "Oslo" }]) },
  { name: "search", run: (api) => api.actions.setSearch("Name 1") },
  { name: "column pin", run: (api) => api.actions.setColumnPin("city", "start") },
  { name: "column reorder", run: (api) => void api.actions.setColumnOrder("qty", "name", "before") },
  { name: "column hide", run: (api) => api.actions.setColumnHidden("city", true) },
  { name: "direction switch", run: (_, handles) => handles.setDir.current("rtl") },
];

describe("a client grid paints no frame that differs from both the old and the new state", () => {
  for (const [paged, action] of [true, false].flatMap((grid) => ACTIONS.map((one) => [grid, one] as const))) {
    if (!paged && action.name === "page change") continue;
    it(`across a ${action.name} (${paged ? "client pages" : "a plain local grid"})`, async () => {
      const handles: Handles = { api: createRef<DataGridApi<Row>>(), setDir: { current: () => {} } };
      const screen = await render(<Harness handles={handles} paged={paged} />);
      await vi.waitFor(() => expect(sampleGrid().rows).not.toBe(""));
      const before = sampleGrid();
      let frames = 0;
      const samples = await recordAcross(() => action.run(handles.api.current!, handles), () => ++frames > 3);
      const after = sampleGrid();
      // A direction switch moves no text and a search only highlights, so only the other changes can show that they landed.
      if (action.name !== "direction switch" && action.name !== "search") expect(after, "the change landed").not.toEqual(before);
      expect(flashesIn(samples, before, after).slice(0, 3)).toEqual([]);
      await screen.unmount();
    });
  }
});

const frames = (count: number) => new Promise<void>((resolve) => { let left = count; const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick)); requestAnimationFrame(tick); });

/** Renders `ui`, runs `prepare`, records `act`, and asserts that the change landed and that no frame mixes the old and the new state. */
async function expectNoFlash(ui: ReactElement, act: () => void, prepare?: () => Promise<void>, landed?: (after: FrameSample) => void) {
  const screen = await render(ui);
  await vi.waitFor(() => expect(sampleGrid().rows).not.toBe(""));
  const initial = sampleGrid();
  await prepare?.();
  const before = sampleGrid();
  let ticks = 0;
  const samples = await recordAcross(act, () => ++ticks > 3);
  const after = sampleGrid();
  expect(after, "the change landed").not.toEqual(initial);
  landed?.(after);
  expect(flashesIn(samples, before, after).slice(0, 3)).toEqual([]);
  await screen.unmount();
}

const box = (grid: ReactElement) => <div style={{ height: 400, width: 600 }}>{grid}</div>;
type PlainProps = Pick<ComponentProps<typeof DataGrid<Row>>, "plugins" | "rowMarkers" | "labels" | "onActiveCellChange"> & { ref?: Ref<DataGridApi<Row>> };
const plain = (props: PlainProps = {}) => (
  <DataGrid columns={columns} data={data} getRowId={(row) => row.id} className="h-100 w-150" aria-label="Client" {...props} />
);

describe("a client grid paints no mixed frame across a change beyond the core view", () => {
  it("across pinned rows appearing in both bands", async () => {
    const set = { current: (_on: boolean) => {} };
    function Pinned() {
      const [on, setOn] = useState(false);
      set.current = setOn;
      const pinned = useDataGridPinnedRows({ topRows: on ? [{ id: "top", name: "Top total", city: "", qty: 1 }] : [], bottomRows: on ? [{ id: "bottom", name: "Bottom total", city: "", qty: 2 }] : [] });
      return box(plain({ plugins: [pinned.plugin] }));
    }
    await expectNoFlash(<Pinned />, () => set.current(true), undefined, (after) => expect(after.pinned).toContain("Bottom total"));
  });

  it("across the detail panel opening on a changed active cell", async () => {
    const api = createRef<DataGridApi<Row>>();
    const panel = { current: () => "" };
    function Detail() {
      const [rowId, setRowId] = useState<string | null>(null);
      panel.current = () => rowId ?? "";
      return (
        <div className="relative" style={{ height: 400, width: 600 }}>
          {plain({ ref: api, onActiveCellChange: (next) => setRowId(next?.rowId ?? null) })}
          <aside role="complementary" aria-label="Row details" data-open={rowId !== null} className="absolute inset-y-0 end-0 w-64 bg-background">{rowId}</aside>
        </div>
      );
    }
    const screen = await render(<Detail />);
    await vi.waitFor(() => expect(sampleGrid().rows).not.toBe(""));
    const before = sampleGrid();
    const samples = await recordAcross(() => api.current!.actions.setActiveCell({ rowId: "r3", columnId: "name" }), () => panel.current() === "r3");
    expect(panel.current(), "the panel opened").toBe("r3");
    expect(flashesIn(samples, before, sampleGrid()).slice(0, 3)).toEqual([]);
    await screen.unmount();
  });

  it("across a comment landing in a cell", async () => {
    const handle: { current: UseDataGridCommentsResult | null } = { current: null };
    function Comments() {
      const comments = useDataGridComments({ currentUser: { id: "bob", name: "Bob" } });
      handle.current = comments;
      return box(plain({ plugins: [comments.plugin] }));
    }
    const comment = { id: "c1", rowId: "r1", columnId: "name", text: "Check", author: { id: "bob", name: "Bob" }, createdAt: 1, updatedAt: 1, version: 1, resolved: false };
    await expectNoFlash(<Comments />, () => void handle.current!.applyRemote([{ kind: "upsert", comment }]), undefined, (after) => expect(after.commentMarkers).toBe(1));
  });

  it("across a row reorder drop", async () => {
    const marker = (index: number) => document.querySelector<HTMLElement>(`[data-grid-row-index="${index}"] ${gridAttrSelector("markerCell")}`)!;
    const press = (type: string, init: PointerEventInit) => document.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, ...init }));
    await expectNoFlash(
      box(plain({ rowMarkers: "reorder" })),
      () => press("pointerup", { button: 0 }),
      async () => {
        const handle = marker(0).querySelector<HTMLElement>(gridAttrSelector("reorderHandle")) ?? marker(0);
        const from = handle.getBoundingClientRect();
        handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: from.left + 2, clientY: from.top + from.height / 2 }));
        const target = marker(3).getBoundingClientRect();
        for (let step = 0; step < 3; step++) {
          press("pointermove", { clientX: from.left + 2, clientY: target.bottom - 5 });
          await frames(1);
        }
      },
      (after) => expect(after.rows.split("\n")[0]).not.toContain("Name 0"),
    );
  });

  it("across a column resize drop", async () => {
    const handle = () => document.querySelector<HTMLElement>(`[role="columnheader"] ${gridAttrSelector("resizeHandle")}`)!;
    const press = (type: string, init: PointerEventInit) => document.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, ...init }));
    await expectNoFlash(
      box(plain()),
      () => press("pointerup", { button: 0 }),
      async () => {
        const rect = handle().getBoundingClientRect();
        handle().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: rect.left, clientY: rect.top }));
        press("pointermove", { clientX: rect.left + 60, clientY: rect.top });
        await frames(2);
      },
      (after) => expect(Number(after.columnWidths.split("|")[0])).toBeGreaterThan(150),
    );
  });

  it("across a filter that leaves fewer rows than the scroll position", async () => {
    const many: Row[] = Array.from({ length: 400 }, (_, i) => ({ id: `m${i}`, name: `Name ${i}`, city: i < 3 ? "Bern" : "Rome", qty: i }));
    const api = createRef<DataGridApi<Row>>();
    await expectNoFlash(
      box(<DataGrid ref={api} columns={columns} data={many} getRowId={(row) => row.id} className="h-100 w-150" aria-label="Client" />),
      () => api.current!.actions.setFilters([{ columnId: "city", operator: "equals", value: "Bern" }]),
      async () => {
        const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
        grid.scrollTop = grid.scrollHeight;
        grid.dispatchEvent(new Event("scroll"));
        await frames(3);
      },
      (after) => expect(after.rows.split("\n")).toHaveLength(3),
    );
  });

  it("across a labels switch", async () => {
    const set = { current: (_labels: object) => {} };
    function Labelled() {
      const [labels, setLabels] = useState<object>({});
      set.current = setLabels;
      return box(plain({ rowMarkers: "checkbox", labels }));
    }
    await expectNoFlash(<Labelled />, () => set.current({ markers: { selectAll: "Alle Zeilen", selectRow: (rowNumber: number) => `Zeile ${rowNumber} waehlen` } }), undefined, (after) => expect(after.ariaLabels).toContain("Alle Zeilen"));
  });
});
