import { page } from "vitest/browser";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid } from "../data-grid";
import "@/app/global.css";

type Row = { id: string; name: string };

const makeRows = (count: number): Row[] => Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, name: `Person ${i}` }));
const columns = [{ id: "name", header: "Name", accessorKey: "name" as const, type: "text" as const, width: 180 }];

describe("error state", () => {
  it("shows a message and a Retry button over zero rows, and the empty state stays hidden", async () => {
    const onRetry = vi.fn();
    await render(
      <div style={{ height: 300, width: 500 }}>
        <DataGrid data={[]} columns={columns} getRowId={(r: Row) => r.id} className="h-72" error={new Error("down")} onRetry={onRetry} />
      </div>,
    );
    await expect.element(page.getByText("Could not load rows.")).toBeInTheDocument();
    expect(document.querySelector("[data-grid-empty-state]")).toBeNull();
    await page.getByRole("button", { name: "Retry" }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps the rows visible and shows the bar when rows are present", async () => {
    await render(
      <div style={{ height: 300, width: 500 }}>
        <DataGrid data={makeRows(5)} columns={columns} getRowId={(r: Row) => r.id} className="h-72" error="boom" />
      </div>,
    );
    await expect.element(page.getByText("Person 0")).toBeInTheDocument();
    await expect.element(page.getByRole("alert")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("boom");
    expect(page.getByRole("button", { name: "Retry" }).elements()).toHaveLength(0);
  });

  it("errorState replaces the built-in, as a node or a function with the retry", async () => {
    const onRetry = vi.fn();
    await render(
      <div style={{ height: 300, width: 500 }}>
        <DataGrid
          data={[]}
          columns={columns}
          getRowId={(r: Row) => r.id}
          className="h-72"
          error={new Error("x")}
          onRetry={onRetry}
          errorState={({ retry }) => (
            <button type="button" onClick={retry}>
              Try again
            </button>
          )}
        />
      </div>,
    );
    await page.getByRole("button", { name: "Try again" }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("an undefined or null error means no error state", async () => {
    await render(
      <div style={{ height: 300, width: 500 }}>
        <DataGrid data={makeRows(2)} columns={columns} getRowId={(r: Row) => r.id} className="h-72" error={null} />
      </div>,
    );
    expect(document.querySelector("[data-grid-error-state]")).toBeNull();
  });

  it("a server filter with no result shows the filtered reason, not no-data", async () => {
    await render(
      <div style={{ height: 300, width: 500 }}>
        <DataGrid
          data={[]}
          columns={columns}
          getRowId={(r: Row) => r.id}
          className="h-72"
          filterMode="server"
          defaultFilterState={[{ filterId: "f", columnId: "name", operator: "equals", value: "zzz" }]}
          emptyState={({ reason }) => <span>{reason}</span>}
        />
      </div>,
    );
    await expect.element(page.getByText("filtered")).toBeInTheDocument();
  });

  describe("focus after Retry", () => {
    function RetryHarness() {
      const [error, setError] = useState<unknown>(new Error("down"));
      return (
        <div style={{ height: 300, width: 500 }}>
          <input aria-label="elsewhere" />
          <DataGrid data={makeRows(5)} columns={columns} getRowId={(r: Row) => r.id} className="h-72" error={error} onRetry={() => setTimeout(() => setError(null), 50)} />
        </div>
      );
    }

    it("moves focus to the grid when the focused Retry button unmounts", async () => {
      await render(<RetryHarness />);
      await page.getByRole("button", { name: "Retry" }).click();
      await vi.waitFor(() => expect(document.querySelector("[data-grid-error-state]")).toBeNull());
      const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
      expect(grid.contains(document.activeElement)).toBe(true);
    });

    it("leaves focus where it is when the user moved it before the bar went away", async () => {
      await render(<RetryHarness />);
      await page.getByRole("button", { name: "Retry" }).click();
      await page.getByLabelText("elsewhere").click();
      await vi.waitFor(() => expect(document.querySelector("[data-grid-error-state]")).toBeNull());
      expect(document.activeElement).toBe(page.getByLabelText("elsewhere").element());
    });
  });
});
