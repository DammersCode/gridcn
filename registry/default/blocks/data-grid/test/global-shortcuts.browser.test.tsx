import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { type ReactNode, useState } from "react";
import { DataGrid, DataGridBody, DataGridGlobalShortcuts, DataGridHeader, type ColumnDef } from "../data-grid";
import { useDataGridState } from "@/registry/default/blocks/data-grid-history/data-grid-history";
// real stylesheet so Tailwind's ring/tint utilities actually apply
import "@/app/global.css";

type Row = { id: string; name: string; age: number };

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, name: `Person ${i}`, age: 20 + i }));
}

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "id", header: "ID", accessorKey: "id", type: "text", width: 100 },
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 160 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 100 },
];

function gridCells(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')];
}

/** One history-backed grid; the toolbar element (outside the grid) is the focus target the global layer must serve. */
function HistoryGrid({ withShortcuts, toolbarId }: { withShortcuts: boolean; toolbarId: string }) {
  const grid = useDataGridState(makeRows(5), { getRowId: (r) => r.id });
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <div style={{ width: 40 }}>
        <button id={toolbarId}>toolbar</button>
      </div>
      <div style={{ height: 300 }}>
        <DataGrid
          {...grid}
          columns={columns}
          className="h-[300px]"
        >
          {withShortcuts ? (
            <>
              <DataGridGlobalShortcuts />
              <DataGridHeader />
              <DataGridBody />
            </>
          ) : undefined}
        </DataGrid>
      </div>
    </div>
  );
}

describe("global keyboard shortcuts (focus outside the grid)", () => {
  it("Ctrl+Z on a toolbar button outside the grid undoes the grid's last edit, Ctrl+Y re-applies it", async () => {
    await render(<HistoryGrid withShortcuts toolbarId="toolbar" />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const cell = gridCells()[1]!; // "name" column, row 0
    const originalText = cell.textContent;

    await userEvent.click(cell);
    await userEvent.keyboard("Edited"); // type-to-replace opens the editor seeded with it
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("Edited")).toBeInTheDocument();

    // focus leaves the grid entirely — the toolbar button owns DOM focus now
    await userEvent.click(document.getElementById("toolbar")!);
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(gridCells()[1]!.textContent).toBe(originalText);

    await userEvent.keyboard("{Control>}y{/Control}");
    expect(gridCells()[1]!.textContent).toBe("Edited");
  });

  it("a stationary Ctrl+Z inside the toolbar input does not touch the grid (editable-target guard)", async () => {
    await render(
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <input id="toolbar-input" />
        <div style={{ height: 300 }}>
          <HistoryGrid withShortcuts toolbarId="toolbar" />
        </div>
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const cell = gridCells()[1]!;

    await userEvent.click(cell);
    await userEvent.keyboard("Edited");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("Edited")).toBeInTheDocument();

    // the field's native undo/redo must win — the grid stays untouched
    const input = document.getElementById("toolbar-input") as HTMLInputElement;
    await userEvent.click(input);
    await userEvent.type(input, "abc");
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(gridCells()[1]!.textContent).toBe("Edited");
  });

  it("without the opt-in layer, Ctrl+Z outside the grid does nothing to the grid", async () => {
    await render(<HistoryGrid withShortcuts={false} toolbarId="toolbar" />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const cell = gridCells()[1]!;

    await userEvent.click(cell);
    await userEvent.keyboard("Edited");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("Edited")).toBeInTheDocument();

    await userEvent.click(document.getElementById("toolbar")!);
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(gridCells()[1]!.textContent).toBe("Edited"); // no global layer → nothing fires
  });

  it("with two opted-in grids, the last focused one owns the shortcut", async () => {
    await render(
      <div style={{ display: "flex", gap: 16 }}>
        <HistoryGrid withShortcuts toolbarId="toolbar-a" />
        <HistoryGrid withShortcuts toolbarId="toolbar-b" />
      </div>,
    );
    // page-scoped getByRole is strict (one element), so probe the DOM directly for the two grids
    await vi.waitFor(() => expect(document.querySelectorAll('[role="grid"]').length).toBe(2));
    const stride = columns.length;

    // grid A (first 5 rows): edit row 0's name
    const cellA = gridCells()[1]!;
    const originalA = cellA.textContent;
    await userEvent.click(cellA);
    await userEvent.keyboard("EditedA");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("EditedA")).toBeInTheDocument();

    // focus lands in grid B (B claims), then on a toolbar button; Ctrl+Z must NOT undo A
    const cellB = gridCells()[1 + 5 * stride]!; // grid B, row 0, name column
    await userEvent.click(cellB);
    await userEvent.click(document.getElementById("toolbar-b")!);
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(gridCells()[1]!.textContent).toBe("EditedA"); // A untouched — B owns focus and has nothing to undo

    // focus returns to grid A (A re-claims); now Ctrl+Z undoes A
    await userEvent.click(gridCells()[1]!);
    await userEvent.click(document.getElementById("toolbar-a")!);
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(gridCells()[1]!.textContent).toBe(originalA);
  });

  it("a keymap override applies to the global gate too (remap undo to mod+u)", async () => {
    function RemappedHistoryGrid(): ReactNode {
      const grid = useDataGridState(makeRows(5), { getRowId: (r) => r.id });
      return (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <button id="toolbar">toolbar</button>
          <div style={{ height: 300 }}>
            <DataGrid {...grid} columns={columns} keymap={{ undo: ["mod+u"] }} className="h-[300px]">
              <>
                <DataGridGlobalShortcuts />
                <DataGridHeader />
                <DataGridBody />
              </>
            </DataGrid>
          </div>
        </div>
      );
    }
    await render(<RemappedHistoryGrid />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const cell = gridCells()[1]!;
    const originalText = cell.textContent;

    await userEvent.click(cell);
    await userEvent.keyboard("Edited");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("Edited")).toBeInTheDocument();

    // inside the grid the remap applies too: mod+u undoes, mod+z no longer does
    await userEvent.keyboard("{Control>}u{/Control}");
    expect(gridCells()[1]!.textContent).toBe(originalText);

    // and outside the grid the SAME remapped binding fires
    await userEvent.click(document.getElementById("toolbar")!);
    await userEvent.keyboard("{Control>}y{/Control}"); // redo brings "Edited" back first
    expect(gridCells()[1]!.textContent).toBe("Edited");
    await userEvent.keyboard("{Control>}u{/Control}");
    expect(gridCells()[1]!.textContent).toBe(originalText);
  });

  it("a consumer-added action (selectAll) fires outside the grid, exactly like its in-grid binding", async () => {
    function SelectAllGrid(): ReactNode {
      const grid = useDataGridState(makeRows(5), { getRowId: (r) => r.id });
      return (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <button id="toolbar">toolbar</button>
          <div style={{ height: 300 }}>
            <DataGrid {...grid} columns={columns} className="h-[300px]">
              <>
                <DataGridGlobalShortcuts actions={["selectAll"]} />
                <DataGridHeader />
                <DataGridBody />
              </>
            </DataGrid>
          </div>
        </div>
      );
    }
    await render(<SelectAllGrid />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const cells = gridCells();
    expect(cells.some((c) => c.getAttribute("aria-selected") === "true")).toBe(false);

    // focus lands in the grid (the ownership claim), then leaves it
    await userEvent.click(cells[1]!);
    await userEvent.click(document.getElementById("toolbar")!);
    await userEvent.keyboard("{Control>}a{/Control}");

    // the window layer dispatched the grid's own selectAll: every cell selected
    expect(cells.every((c) => c.getAttribute("aria-selected") === "true")).toBe(true);
  });

  it("flipping the undo/redo flags while focus is inside the grid keeps multi-grid ownership", async () => {
    // regression: the effect used to re-run on an enabled-set change, take a fresh gridId, and
    // null lastFocusedGrid in cleanup — with focus already inside the grid, ownsFocus stayed false
    // until a new focusin and the global binding died silently until re-focus.
    function FlipGrid() {
      const [narrow, setNarrow] = useState(false);
      const grid = useDataGridState(makeRows(5), { getRowId: (r) => r.id });
      return (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <button id="flip" onClick={() => setNarrow(true)}>flip</button>
          <button id="toolbar">toolbar</button>
          <div style={{ height: 300 }}>
            <DataGrid {...grid} columns={columns} className="h-[300px]">
              {narrow ? (
                <>
                  <DataGridGlobalShortcuts undo />
                  <DataGridHeader />
                  <DataGridBody />
                </>
              ) : (
                <>
                  <DataGridGlobalShortcuts />
                  <DataGridHeader />
                  <DataGridBody />
                </>
              )}
            </DataGrid>
          </div>
        </div>
      );
    }
    await render(<FlipGrid />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const cell = gridCells()[1]!;
    const originalText = cell.textContent;

    await userEvent.click(cell);
    await userEvent.keyboard("Edited");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("Edited")).toBeInTheDocument();

    // flip the layer's config after the grid claimed ownership; the re-render must not drop it
    await userEvent.click(document.getElementById("flip")!);

    // focus leaves the grid; the layer must still own the shortcut the grid claimed
    await userEvent.click(document.getElementById("toolbar")!);
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(gridCells()[1]!.textContent).toBe(originalText);
  });
});
