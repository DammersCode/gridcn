import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DataGridProvider,
  DataGridRoot,
  useDataGridActions,
  type ColumnDef,
  type DataChange,
  type GridValidationErrorEvent,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { useDataGridHistory } from "@/registry/default/blocks/data-grid-history/use-data-grid-history";
import { useDataGridFindReplace, type UseDataGridFindReplaceOptions } from "./use-data-grid-find-replace";

type Row = { id: string; name: string };

const rows: Row[] = [
  { id: "a", name: "foo one" },
  { id: "b", name: "two" },
  { id: "c", name: "Foo three" },
];

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name", validate: (value) => (String(value).includes("bad") ? "no bad words" : null) },
];

afterEach(cleanup);

function setup(props: { readOnly?: boolean; serverHeld?: boolean; onValidationError?: (event: GridValidationErrorEvent) => void; columns?: readonly ColumnDef<Row, unknown>[]; replaceAllLimit?: number; processReplace?: UseDataGridFindReplaceOptions["processReplace"]; rows?: readonly Row[]; gateTimeoutMs?: number; onGateAborted?: (ctx: { gate: string; reason: string }) => void } = {}) {
  let data: readonly Row[] = props.rows ?? rows;
  let actions!: ReturnType<typeof useDataGridActions>;
  const changes: DataChange<Row>[] = [];
  let history!: ReturnType<typeof useDataGridHistory<Row>>;
  let findReplace!: ReturnType<typeof useDataGridFindReplace>;
  let storeApi!: ReturnType<typeof useDataGridStoreApi>;
  let setHeld!: (held: boolean) => void;
  function Probe() {
    storeApi = useDataGridStoreApi();
    actions = useDataGridActions();
    return null;
  }
  function Harness() {
    history = useDataGridHistory<Row>();
    const [held, setHeldState] = useState(props.serverHeld ?? false);
    setHeld = setHeldState;
    findReplace = useDataGridFindReplace({ replaceAllLimit: props.replaceAllLimit, processReplace: props.processReplace });
    return (
      <DataGridProvider
        data={data}
        columns={props.columns ?? columns}
        getRowId={(row: Row) => row.id}
        plugins={[history.plugin, findReplace.plugin]}
        readOnly={props.readOnly}
        {...({ serverHeld: held } as object)}
        gateTimeoutMs={props.gateTimeoutMs}
        onGateAborted={props.onGateAborted as never}
        onValidationError={props.onValidationError}
        onDataChange={(next, change) => {
          data = next;
          changes.push(change);
        }}
      >
        <Probe />
        <DataGridRoot />
      </DataGridProvider>
    );
  }
  render(<Harness />);
  return { data: () => data, changes, history: () => history, findReplace: () => findReplace, searchText: () => storeApi.getState().searchText, actions: () => actions, activeCell: () => storeApi.getState().activeCell, setHeld: (held: boolean) => act(() => setHeld(held)) };
}

async function search(find: string, replacement: string) {
  fireEvent.change(screen.getByLabelText("Find"), { target: { value: find } });
  fireEvent.change(screen.getByLabelText("Replace with"), { target: { value: replacement } });
  await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/ of |No results/));
}

describe("useDataGridFindReplace", () => {
  it("opens the panel and shows the match position", async () => {
    const harness = setup();
    act(() => harness.findReplace().open("replace"));
    expect(screen.getByRole("dialog", { name: "Find and replace" })).toBeTruthy();
    await search("foo", "x");
    expect(screen.getByRole("status").textContent).toBe("1 of 2 cells");
  });

  it("Ctrl+F inside the panel cancels the browser find bar and selects the Find field", () => {
    const harness = setup();
    act(() => harness.findReplace().open("replace"));
    const find = screen.getByLabelText("Find") as HTMLInputElement;
    const replace = screen.getByLabelText("Replace with");
    replace.focus();
    const notCancelled = fireEvent.keyDown(replace, { key: "f", ctrlKey: true });
    expect(notCancelled).toBe(false);
    expect(document.activeElement).toBe(find);
  });

  it("a hanging processReplace is a tracked gate: gateTimeoutMs aborts it and onGateAborted reports it", async () => {
    const onGateAborted = vi.fn();
    const harness = setup({ processReplace: () => new Promise<never>(() => {}), gateTimeoutMs: 30, onGateAborted });
    act(() => harness.findReplace().open("replace"));
    await search("foo", "x");
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));
    await waitFor(() => expect(onGateAborted).toHaveBeenCalledWith({ gate: "processReplace", reason: "timeout" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Replace cancelled"));
    expect(harness.data()).toBe(rows);
  });

  it("Replace all writes one change with source replace and one undo entry", async () => {
    const harness = setup();
    act(() => harness.findReplace().open("replace"));
    await search("foo", "x");
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));
    expect(harness.data().map((r) => r.name)).toEqual(["x one", "two", "x three"]);
    expect(harness.changes).toHaveLength(1);
    expect(harness.changes[0]!.source).toBe("replace");
    expect(harness.history().historySize).toBe(1);
    expect(screen.getByRole("status").textContent).toBe("2 replaced");
    act(() => harness.history().undo());
    expect(harness.data().map((r) => r.name)).toEqual(["foo one", "two", "Foo three"]);
  });

  it("Replace changes the current match only", async () => {
    const harness = setup();
    act(() => harness.findReplace().open("replace"));
    await search("foo", "x");
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(harness.data().map((r) => r.name)).toEqual(["x one", "two", "Foo three"]);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("1 replaced"));
  });

  it("Replace on a clicked match moves the active cell to the next match", async () => {
    const harness = setup({ rows: ["a", "b", "c", "d"].map((id) => ({ id, name: `foo ${id}` })) });
    act(() => harness.findReplace().open("replace"));
    await search("foo", "x");
    act(() => harness.actions().setActiveCellAt({ col: 0, row: 2 }));
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(harness.data().map((r) => r.name)).toEqual(["foo a", "foo b", "x c", "foo d"]);
    await waitFor(() => expect(harness.activeCell()).toEqual({ col: 0, row: 3 }));
  });

  it("Replace on the last match wraps the active cell to the first match", async () => {
    const harness = setup({ rows: ["a", "b", "c", "d"].map((id) => ({ id, name: `foo ${id}` })) });
    act(() => harness.findReplace().open("replace"));
    await search("foo", "x");
    act(() => harness.actions().setActiveCellAt({ col: 0, row: 3 }));
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(harness.data().map((r) => r.name)).toEqual(["foo a", "foo b", "foo c", "x d"]);
    await waitFor(() => expect(harness.activeCell()).toEqual({ col: 0, row: 0 }));
  });

  it("Replace with text that still matches moves past the replaced cell", async () => {
    const harness = setup({ rows: ["a", "b", "c", "d"].map((id) => ({ id, name: `foo ${id}` })) });
    act(() => harness.findReplace().open("replace"));
    await search("foo", "FOO");
    act(() => harness.actions().setActiveCellAt({ col: 0, row: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(harness.data().map((r) => r.name)).toEqual(["foo a", "FOO b", "foo c", "foo d"]);
    await waitFor(() => expect(harness.activeCell()).toEqual({ col: 0, row: 2 }));
    act(() => harness.actions().setActiveCellAt({ col: 0, row: 3 }));
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(harness.activeCell()).toEqual({ col: 0, row: 0 }));
  });

  it("Replace moves to the next match after the replaced cell when processReplace also patches an earlier match", async () => {
    const harness = setup({
      rows: ["a", "b", "c", "d", "e"].map((id) => ({ id, name: `foo ${id}` })),
      processReplace: ({ plan }) => ({ ...plan, patches: [...plan.patches, { rowId: "a", columnId: "name", value: "x a" }] }),
    });
    act(() => harness.findReplace().open("replace"));
    await search("foo", "x");
    act(() => harness.actions().setActiveCellAt({ col: 0, row: 2 }));
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(harness.data().map((r) => r.name)).toEqual(["x a", "foo b", "x c", "foo d", "foo e"]));
    await waitFor(() => expect(harness.activeCell()).toEqual({ col: 0, row: 3 }));
  });

  it("Replace moves past the replaced row by id when a sort reorders the view during an async processReplace", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const harness = setup({
      rows: ["a", "b", "c"].map((id, i) => ({ id, name: `foo ${3 - i}` })),
      processReplace: async ({ plan }) => {
        await gate;
        return plan;
      },
    });
    act(() => harness.findReplace().open("replace"));
    await search("foo", "x");
    act(() => harness.actions().setActiveCellAt({ col: 0, row: 0 }));
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    act(() => harness.actions().toggleSort("name"));
    release();
    await waitFor(() => expect(harness.data().map((r) => r.name)).toEqual(["x 3", "foo 2", "foo 1"]));
    await waitFor(() => expect(harness.activeCell()).toEqual({ col: 0, row: 0 }));
  });

  it("disables Replace in a read-only grid and writes nothing", async () => {
    const harness = setup({ readOnly: true });
    act(() => harness.findReplace().open("replace"));
    await search("foo", "x");
    expect((screen.getByRole("button", { name: "Replace all" }) as HTMLButtonElement).disabled).toBe(true);
    expect(harness.changes).toHaveLength(0);
  });

  it("disables Replace while the server hook holds the rows, and enables it when the hold ends", async () => {
    const harness = setup({ serverHeld: true });
    act(() => harness.findReplace().open("replace"));
    await search("foo", "x");
    const replaceAll = () => screen.getByRole("button", { name: "Replace all" }) as HTMLButtonElement;
    expect(replaceAll().disabled).toBe(true);
    expect((screen.getByLabelText("Replace with") as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(replaceAll());
    expect(harness.changes).toHaveLength(0);
    harness.setHeld(false);
    expect(replaceAll().disabled).toBe(false);
    fireEvent.click(replaceAll());
    await waitFor(() => expect(harness.changes).toHaveLength(1));
  });

  it("cancels a processReplace that settles after the hold starts", async () => {
    let finish: ((plan: unknown) => void) | undefined;
    const harness = setup({ processReplace: ({ plan }) => new Promise((resolve) => void (finish = () => resolve(plan))) });
    act(() => harness.findReplace().open("replace"));
    await search("foo", "x");
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));
    await waitFor(() => expect(finish).toBeDefined());
    harness.setHeld(true);
    await act(async () => finish!(undefined));
    expect(harness.changes).toHaveLength(0);
    expect(harness.data().map((r) => r.name)).toEqual(rows.map((r) => r.name));
  });

  it("reports validator rejections through onValidationError with source replace", async () => {
    const onValidationError = vi.fn();
    const harness = setup({ onValidationError });
    act(() => harness.findReplace().open("replace"));
    await search("foo", "bad");
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));
    expect(harness.changes).toHaveLength(0);
    expect(onValidationError).toHaveBeenCalledTimes(1);
    expect(onValidationError.mock.calls[0]![0].source).toBe("replace");
    expect(screen.getByRole("status").textContent).toBe("0 replaced, 2 skipped");
  });

  it("Escape closes the panel", () => {
    const harness = setup();
    act(() => harness.findReplace().open("replace"));
    fireEvent.keyDown(screen.getByLabelText("Find"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("Escape drops find text that is still waiting, and closing another way searches it", () => {
    vi.useFakeTimers();
    const first = setup();
    act(() => first.findReplace().open());
    fireEvent.change(screen.getByLabelText("Find"), { target: { value: "ali" } });
    fireEvent.keyDown(screen.getByLabelText("Find"), { key: "Escape" });
    act(() => void vi.advanceTimersByTime(1000));
    expect(first.searchText()).toBe("");
    cleanup();
    const second = setup();
    act(() => second.findReplace().open());
    fireEvent.change(screen.getByLabelText("Find"), { target: { value: "ali" } });
    act(() => second.findReplace().close());
    expect(second.searchText()).toBe("ali");
    vi.useRealTimers();
  });

  it("clears Validating when the Replace field changes while processReplace is pending", async () => {
    const harness = setup({ processReplace: () => new Promise(() => {}) });
    act(() => harness.findReplace().open("replace"));
    await search("foo", "x");
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Validating…"));
    fireEvent.change(screen.getByLabelText("Replace with"), { target: { value: "xy" } });
    expect(screen.getByRole("status").textContent).not.toBe("Validating…");
  });

  it("settles the status when an async validator rejects every cell", async () => {
    const rejectAll = {
      "~standard": { version: 1, vendor: "test", validate: async () => ({ issues: [{ message: "no" }] }) },
    };
    const asyncColumns = [{ id: "name", header: "Name", accessorKey: "name", validate: rejectAll }] as unknown as readonly ColumnDef<Row, unknown>[];
    const harness = setup({ columns: asyncColumns });
    act(() => harness.findReplace().open("replace"));
    await search("foo", "x");
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).not.toBe("Validating…"));
    expect(harness.changes).toHaveLength(0);
  });

  it("leaves Validating and stays usable when the async validator throws, without an unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const throwing = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: async () => {
          throw new Error("validator exploded");
        },
      },
    };
    const asyncColumns = [{ id: "name", header: "Name", accessorKey: "name", validate: throwing }] as unknown as readonly ColumnDef<Row, unknown>[];
    const harness = setup({ columns: asyncColumns });
    act(() => harness.findReplace().open("replace"));
    await search("foo", "x");
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).not.toBe("Validating…"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(harness.changes).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Find"), { target: { value: "two" } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("1 of 1 cell"));
  });

  it("continues Replace all past the limit when the replacement contains the find text", async () => {
    const harness = setup({ replaceAllLimit: 1 });
    act(() => harness.findReplace().open("replace"));
    await search("foo", "foobar");
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));
    expect(harness.data().map((r) => r.name)).toEqual(["foobar one", "two", "Foo three"]);
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));
    expect(harness.data().map((r) => r.name)).toEqual(["foobar one", "two", "foobar three"]);
  });

  it("binds shift+alt+Enter to openFindReplace and mod+f to openFind", () => {
    const harness = setup();
    const { plugin } = harness.findReplace();
    expect(plugin.keymap).toEqual({ openFindReplace: ["shift+alt+Enter"], openFind: ["mod+f"] });
    expect(Object.keys(plugin.commands ?? {}).sort()).toEqual(["openFind", "openFindReplace"]);
  });

  it("open('find') hides the Replace field and the toggle switches it on and off", () => {
    const harness = setup();
    act(() => harness.findReplace().open("find"));
    expect(screen.queryByLabelText("Replace with")).toBeNull();
    const toggle = screen.getByRole("button", { name: "Toggle replace" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByLabelText("Replace with")).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByLabelText("Replace with")).toBeNull();
  });

  it("keeps the Find text when the toggle expands the panel", () => {
    const harness = setup();
    act(() => harness.findReplace().open("find"));
    fireEvent.change(screen.getByLabelText("Find"), { target: { value: "foo" } });
    fireEvent.click(screen.getByRole("button", { name: "Toggle replace" }));
    expect((screen.getByLabelText("Find") as HTMLInputElement).value).toBe("foo");
  });

  it("re-opening sets the mode of the opener", () => {
    const harness = setup();
    act(() => harness.findReplace().open("find"));
    fireEvent.click(screen.getByRole("button", { name: "Toggle replace" }));
    act(() => harness.findReplace().open("find"));
    expect(screen.queryByLabelText("Replace with")).toBeNull();
  });

  it("shows no toggle in a read-only grid", () => {
    const harness = setup({ readOnly: true });
    act(() => harness.findReplace().open("find"));
    expect(screen.queryByRole("button", { name: "Toggle replace" })).toBeNull();
    expect(screen.queryByLabelText("Replace with")).toBeNull();
  });
});
