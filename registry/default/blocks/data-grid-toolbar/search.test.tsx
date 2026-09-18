import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridSearch } from "./search";

afterEach(cleanup);

type Row = { id: string; name: string };

const rows: Row[] = [
  { id: "r0", name: "Alice" },
  { id: "r1", name: "Bob" },
];

const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 100 }] as const);

function renderSearch() {
  return render(
    <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
      <DataGridSearch />
      <DataGridRoot>
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>,
  );
}

describe("DataGridSearch debounce", () => {
  it("does not filter rows immediately on keystroke", () => {
    vi.useFakeTimers();
    renderSearch();
    const input = screen.getByRole("textbox", { name: "Search grid" });
    fireEvent.change(input, { target: { value: "alice" } });
    // before the 200ms debounce elapses, no match badge should exist yet
    expect(screen.queryByText(/^\d+\/\d+$/)).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("commits the search after the debounce window elapses", () => {
    vi.useFakeTimers();
    renderSearch();
    const input = screen.getByRole("textbox", { name: "Search grid" });
    fireEvent.change(input, { target: { value: "alice" } });
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(screen.queryByText(/^\d+\/\d+$/)).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText("1/1")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("restarts the debounce on each keystroke instead of firing per-keystroke", () => {
    vi.useFakeTimers();
    renderSearch();
    const input = screen.getByRole("textbox", { name: "Search grid" });
    fireEvent.change(input, { target: { value: "a" } });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    fireEvent.change(input, { target: { value: "al" } });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    // 300ms of wall-clock elapsed since the first keystroke, but only 150ms since the latest —
    // a naive per-keystroke debounce would have already committed "a" by now.
    expect(screen.queryByText(/^\d+\/\d+$/)).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.getByText("1/1")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("Escape clears immediately, bypassing the debounce", () => {
    vi.useFakeTimers();
    renderSearch();
    const input = screen.getByRole("textbox", { name: "Search grid" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "alice" } });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText("1/1")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
    expect(screen.queryByText(/^\d+\/\d+$/)).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  // a11y: the match-count badge is the only non-visual signal a screen-reader user gets for search
  // results — without aria-live, "1/1" -> "2/2" as more matches stream in is silent to them.
  it("exposes the match-count badge as an aria-live region (role=status)", () => {
    vi.useFakeTimers();
    renderSearch();
    const input = screen.getByRole("textbox", { name: "Search grid" });
    fireEvent.change(input, { target: { value: "alice" } });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("1/1");
    expect(status).toHaveAttribute("aria-live", "polite");
    vi.useRealTimers();
  });
});
