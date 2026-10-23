import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DataGridProvider,
  DataGridRoot,
  type ColumnDef,
  type DataChange,
  type GridValidationErrorEvent,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridHistory } from "@/registry/default/blocks/data-grid-history/use-data-grid-history";
import { useDataGridFindReplace } from "./use-data-grid-find-replace";

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

function setup(props: { readOnly?: boolean; onValidationError?: (event: GridValidationErrorEvent) => void } = {}) {
  let data: readonly Row[] = rows;
  const changes: DataChange<Row>[] = [];
  let history!: ReturnType<typeof useDataGridHistory<Row>>;
  let findReplace!: ReturnType<typeof useDataGridFindReplace>;
  function Harness() {
    history = useDataGridHistory<Row>();
    findReplace = useDataGridFindReplace();
    return (
      <DataGridProvider
        data={data}
        columns={columns}
        getRowId={(row: Row) => row.id}
        plugins={[history.plugin, findReplace.plugin]}
        readOnly={props.readOnly}
        onValidationError={props.onValidationError}
        onDataChange={(next, change) => {
          data = next;
          changes.push(change);
        }}
      >
        <DataGridRoot />
      </DataGridProvider>
    );
  }
  render(<Harness />);
  return { data: () => data, changes, history: () => history, findReplace: () => findReplace };
}

async function search(find: string, replacement: string) {
  fireEvent.change(screen.getByLabelText("Find"), { target: { value: find } });
  fireEvent.change(screen.getByLabelText("Replace with"), { target: { value: replacement } });
  await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/ of |No matches/));
}

describe("useDataGridFindReplace", () => {
  it("opens the panel and shows the match position", async () => {
    const harness = setup();
    act(() => harness.findReplace().open());
    expect(screen.getByRole("dialog", { name: "Find and replace" })).toBeTruthy();
    await search("foo", "x");
    expect(screen.getByRole("status").textContent).toBe("1 of 2");
  });

  it("Replace all writes one change with source replace and one undo entry", async () => {
    const harness = setup();
    act(() => harness.findReplace().open());
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
    act(() => harness.findReplace().open());
    await search("foo", "x");
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(harness.data().map((r) => r.name)).toEqual(["x one", "two", "Foo three"]);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("1 replaced"));
  });

  it("disables Replace in a read-only grid and writes nothing", async () => {
    const harness = setup({ readOnly: true });
    act(() => harness.findReplace().open());
    await search("foo", "x");
    expect((screen.getByRole("button", { name: "Replace all" }) as HTMLButtonElement).disabled).toBe(true);
    expect(harness.changes).toHaveLength(0);
  });

  it("reports validator rejections through onValidationError with source replace", async () => {
    const onValidationError = vi.fn();
    const harness = setup({ onValidationError });
    act(() => harness.findReplace().open());
    await search("foo", "bad");
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));
    expect(harness.changes).toHaveLength(0);
    expect(onValidationError).toHaveBeenCalledTimes(1);
    expect(onValidationError.mock.calls[0]![0].source).toBe("replace");
    expect(screen.getByRole("status").textContent).toBe("0 replaced, 2 skipped");
  });

  it("Escape closes the panel", () => {
    const harness = setup();
    act(() => harness.findReplace().open());
    fireEvent.keyDown(screen.getByLabelText("Find"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
