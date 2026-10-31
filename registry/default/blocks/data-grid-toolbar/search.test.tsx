import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
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

  it("honours a custom debounceMs instead of the 200ms default", () => {
    vi.useFakeTimers();
    render(
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
        <DataGridSearch debounceMs={500} />
        <DataGridRoot>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
    const input = screen.getByRole("textbox", { name: "Search grid" });
    fireEvent.change(input, { target: { value: "alice" } });
    // the 200ms default has long passed, but the 500ms window has not — nothing committed yet.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText(/^\d+\/\d+$/)).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(300);
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
    // text-scoped: the grid body carries its own (empty) row-reorder live region, and
    // role=status gets no accessible name from content, so match on textContent instead
    const status = screen.getAllByRole("status").find((el) => el.textContent === "1/1")!;
    expect(status).toHaveTextContent("1/1");
    expect(status).toHaveAttribute("aria-live", "polite");
    vi.useRealTimers();
  });
});

describe("DataGridSearch input rules", () => {
  function renderWith(providerProps: { inputDebounceMs?: number } = {}, searchProps: { debounceMs?: number } = {}) {
    let latest = "";
    const view = render(
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} {...providerProps}>
        <DataGridSearch {...searchProps} />
        <DataGridRoot>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
    return { view, input: screen.getByRole("textbox", { name: "Search grid" }) as HTMLInputElement, latest: () => latest };
  }

  it("the provider's inputDebounceMs sets the wait, and the component's debounceMs wins", () => {
    vi.useFakeTimers();
    const { input } = renderWith({ inputDebounceMs: 500 });
    fireEvent.change(input, { target: { value: "alice" } });
    act(() => void vi.advanceTimersByTime(499));
    expect(screen.queryByText(/^\d+\/\d+$/)).not.toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.getByText("1/1")).toBeInTheDocument();
    cleanup();
    const second = renderWith({ inputDebounceMs: 500 }, { debounceMs: 50 });
    fireEvent.change(second.input, { target: { value: "alice" } });
    act(() => void vi.advanceTimersByTime(50));
    expect(screen.getByText("1/1")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("inputDebounceMs 0 commits each keystroke", () => {
    const { input } = renderWith({ inputDebounceMs: 0 });
    fireEvent.change(input, { target: { value: "bob" } });
    expect(screen.getByText("1/1")).toBeInTheDocument();
  });

  it("Enter with text pending commits it and does not step through the old matches", () => {
    vi.useFakeTimers();
    const { input } = renderWith();
    fireEvent.change(input, { target: { value: "alice" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("1/1")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("blur commits the pending text", () => {
    vi.useFakeTimers();
    const { input } = renderWith();
    fireEvent.change(input, { target: { value: "alice" } });
    fireEvent.blur(input);
    expect(screen.getByText("1/1")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("Enter during an IME composition does nothing, and the composed text commits after compositionend", () => {
    vi.useFakeTimers();
    const { input } = renderWith();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "ali" } });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.queryByText(/^\d+\/\d+$/)).not.toBeInTheDocument();
    fireEvent.compositionEnd(input);
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.getByText("1/1")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("unmounting inside the wait still commits the last keystrokes to the store", () => {
    vi.useFakeTimers();
    let api: { getState: () => { searchText: string } } | null = null;
    function Probe() {
      api = useDataGridStoreApi();
      return null;
    }
    const view = render(
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
        <Probe />
        <DataGridSearch />
      </DataGridProvider>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Search grid" }), { target: { value: "bo" } });
    const store = api!;
    view.rerender(
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
        <Probe />
      </DataGridProvider>,
    );
    expect(store.getState().searchText).toBe("bo");
    vi.useRealTimers();
  });
});
