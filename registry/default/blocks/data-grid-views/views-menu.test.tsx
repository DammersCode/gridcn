import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useEffect } from "react";
import { DataGridProvider, defineColumns, useDataGridActions } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridViews } from "./views-menu";
import { createMemoryViewsStorage } from "./view-storage";
import { emptyViewState, type DataGridViewsDocument } from "./view-state";

afterEach(cleanup);

const list = () => within(screen.getByRole("list", { name: "Views" }));

type Row = { id: string; name: string };
const rows: Row[] = [{ id: "r0", name: "Alice" }];
const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 100 }] as const);

const doc = (): DataGridViewsDocument => ({
  version: 1,
  defaultViewId: null,
  views: [
    { id: "a", name: "Alpha", state: { ...emptyViewState(), searchText: "al" } },
    { id: "b", name: "Beta", state: emptyViewState() },
  ],
});

async function open(storage = createMemoryViewsStorage(doc())) {
  render(
    <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
      <DataGridViews storage={storage} />
    </DataGridProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /views/i }));
  await screen.findByRole("button", { name: "Alpha" });
  return storage;
}

function OverLimitSearch() {
  const actions = useDataGridActions();
  useEffect(() => actions.setSearch("s".repeat(501)), [actions]);
  return null;
}

describe("DataGridViews", () => {
  it("disables Save and Update and says why while the grid is over a view limit", async () => {
    render(
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
        <OverLimitSearch />
        <DataGridViews storage={createMemoryViewsStorage(doc())} />
      </DataGridProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /views/i }));
    await screen.findByRole("button", { name: "Alpha" });
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), { target: { value: "Mine" } });
    expect(screen.getByRole("button", { name: "Save as new view" })).toBeDisabled();
    expect(screen.getByText(/over the view limits/)).toBeInTheDocument();
  });

  it("lists the views and marks the picked one", async () => {
    await open();
    fireEvent.click(list().getByRole("button", { name: "Alpha" }));
    expect(list().getByRole("button", { name: "Alpha" })).toHaveAttribute("aria-current", "true");
    expect(list().getByRole("button", { name: "Beta" })).not.toHaveAttribute("aria-current");
  });

  it("saves the grid as a new view with Enter", async () => {
    const storage = await open();
    const input = screen.getByRole("textbox", { name: "View name" });
    fireEvent.change(input, { target: { value: "Mine" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(list().getByRole("button", { name: "Mine" })).toBeInTheDocument());
    await waitFor(async () => expect(((await storage.load({ signal: new AbortController().signal })) as DataGridViewsDocument).views).toHaveLength(3));
  });

  it("ignores Enter during IME composition", async () => {
    await open();
    const input = screen.getByRole("textbox", { name: "View name" });
    fireEvent.change(input, { target: { value: "Mine" } });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(screen.queryByRole("button", { name: "Mine" })).toBeNull();
  });

  it("renames a view and cancels with Escape", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Rename Alpha" }));
    let input = screen.getByRole("textbox", { name: "Rename Alpha" });
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByRole("button", { name: "Renamed" });
    fireEvent.click(screen.getByRole("button", { name: "Rename Renamed" }));
    input = screen.getByRole("textbox", { name: "Rename Renamed" });
    fireEvent.change(input, { target: { value: "Nope" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Renamed" })).toBeInTheDocument();
  });

  it("asks twice before deleting", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Delete Beta" }));
    expect(screen.getByRole("button", { name: "Beta" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete Beta" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Beta" })).toBeNull());
  });

  it("toggles the default view as a pressed button", async () => {
    await open();
    const star = screen.getByRole("button", { name: "Use Alpha as the default view" });
    expect(star).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(star);
    expect(await screen.findByRole("button", { name: "Stop using Alpha as the default view" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows Modified and offers an update after a change", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    expect(screen.queryByRole("button", { name: "Update Alpha" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Beta" }));
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    expect(screen.queryByText("Modified")).toBeNull();
  });

  it("exports the active view and imports it again", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Export active view" }));
    const text = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "View as JSON" });
    expect(JSON.parse(text.value)).toMatchObject({ format: "gridcn-view", name: "Alpha" });
    fireEvent.click(screen.getByRole("button", { name: "Import view" }));
    await waitFor(() => expect(list().getAllByRole("button", { name: "Alpha" })).toHaveLength(2));
  });

  it("announces a failed import", async () => {
    await open();
    fireEvent.change(screen.getByRole("textbox", { name: "View as JSON" }), { target: { value: "{nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Import view" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("The text is not a valid view."));
  });

  it("shows the empty state", async () => {
    render(
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
        <DataGridViews storage={createMemoryViewsStorage()} />
      </DataGridProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /views/i }));
    expect(await screen.findByText("No saved views yet.")).toBeInTheDocument();
  });
});
