import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, defineColumns, GRID_LAYER } from "../data-grid";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
// real stylesheet so z-50 on the dialog and the grid's own layers actually apply
import "@/app/global.css";

type Row = { id: string; name: string; email: string };

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `row-${i}`,
    name: `Person ${i}`,
    email: `person${i}@example.com`,
  }));
}

const columns = defineColumns<Row>()([
  { id: "id", header: "ID", accessorKey: "id", type: "text", width: 120, pin: "left" },
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 200 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 260 },
] as const);

describe("stacking contract with shadcn overlays", () => {
  // The rule the scale encodes for every consumer, not just this app: a shadcn dialog (z-50)
  // must ALWAYS paint over the grid. Guarded twice — the numbers stay below 50, and the root
  // isolates its stacking context so internal values cannot leak out even if someone raises one.
  it("every GRID_LAYER value stays below shadcn's portal tier (50)", () => {
    for (const [name, value] of Object.entries(GRID_LAYER)) {
      expect(value, `GRID_LAYER.${name}`).toBeLessThan(50);
    }
  });

  it("the grid root isolates its stacking context", async () => {
    render(
      <div style={{ width: 420, height: 300 }}>
        <DataGrid data={makeRows(8)} columns={columns} getRowId={(r) => r.id} rowMarkers="number" className="h-[260px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    expect(getComputedStyle(grid).isolation).toBe("isolate");
  });

  it("an open dialog hit-tests above the grid's highest chrome (markers, pinned column, skeleton)", async () => {
    render(
      <div style={{ width: 420, height: 300 }}>
        <DataGrid
          data={makeRows(8)}
          columns={columns}
          getRowId={(r) => r.id}
          rowMarkers="number"
          loading
          className="h-[260px]"
        />
        <Dialog open>
          <DialogContent data-testid="over-grid">
            <DialogTitle>Over the grid</DialogTitle>
          </DialogContent>
        </Dialog>
      </div>,
    );
    // the modal dialog marks everything outside itself inert, so role locators cannot see the
    // grid — query the DOM directly; being inert-but-painted is exactly the state under test.
    await vi.waitFor(() => expect(document.querySelector('[role="grid"]')).not.toBeNull());
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());

    // sample the grid's own area: whatever paints at the marker header, the pinned band, and the
    // grid centre must belong to the dialog (content or its overlay scrim), never to the grid.
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const rect = grid.getBoundingClientRect();
    const samples: Array<[number, number, string]> = [
      [rect.left + 20, rect.top + 12, "marker header"],
      [rect.left + 60, rect.top + rect.height / 2, "pinned band"],
      [rect.left + rect.width / 2, rect.top + rect.height / 2, "grid centre"],
    ];
    for (const [x, y, label] of samples) {
      const painted = document.elementFromPoint(x, y);
      expect(painted?.closest('[role="grid"]'), `${label}: grid painted above the dialog`).toBeNull();
    }
  });
});
