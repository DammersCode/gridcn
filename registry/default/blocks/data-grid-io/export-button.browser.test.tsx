import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridExportButton } from "./data-grid-io";
// real stylesheet so Tailwind's `grid`/dropdown utilities actually apply
import "@/app/global.css";

type Row = { id: string; name: string; note: string };

function makeRows(): Row[] {
  return [
    { id: "r0", name: "Alice", note: "hello, world" },
    { id: "r1", name: "Bob", note: "plain" },
  ];
}

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140 },
  { id: "note", header: "Note", accessorKey: "note", type: "text", width: 200 },
] as const);

function renderGrid() {
  return render(
    <DataGridProvider data={makeRows()} columns={columns} getRowId={(r) => r.id}>
      <DataGridExportButton />
      <DataGridRoot className="h-[200px]">
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>,
  );
}

describe("DataGridExportButton (browser)", () => {
  it("csv export click triggers a DOM-attached download anchor with the right filename and RFC4180 content, revoke deferred", async () => {
    let capturedBlob: Blob | null = null;
    const createObjectURL = vi.fn((blob: Blob) => {
      capturedBlob = blob;
      return "blob:mock-url";
    });
    const revokeObjectURL = vi.fn();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    let capturedAnchor: HTMLAnchorElement | null = null;
    let wasConnectedDuringClick = false;
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tagName: string, options?: ElementCreationOptions) => {
        const el = originalCreateElement(tagName, options);
        if (tagName === "a") {
          capturedAnchor = el as HTMLAnchorElement;
          el.click = vi.fn(() => {
            wasConnectedDuringClick = el.isConnected;
          });
        }
        return el;
      });

    renderGrid();
    await expect.element(page.getByRole("button", { name: "Export" })).toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: "Export" }));
    await expect.element(page.getByText("Export as CSV")).toBeInTheDocument();
    await userEvent.click(page.getByText("Export as CSV"));

    expect(createObjectURL).toHaveBeenCalled();
    expect(capturedAnchor).not.toBeNull();
    expect(capturedAnchor!.download).toBe("export.csv");
    // appended to the DOM before click() (the other half of the Firefox download-triggering fix), then removed.
    expect(wasConnectedDuringClick).toBe(true);
    expect(capturedAnchor!.isConnected).toBe(false);
    // revoke is deferred past the click tick — not asserted synchronously here (see export-grid.test.ts
    // for the fake-timers version); a real 10s timer isn't worth holding this browser test open for.
    expect(revokeObjectURL).not.toHaveBeenCalled();

    const text = await capturedBlob!.text();
    expect(text).toBe('Name,Note\r\nAlice,"hello, world"\r\nBob,plain');

    createElementSpy.mockRestore();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });
});
