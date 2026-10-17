import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi, type MockInstance } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridPrintButton } from "./data-grid-io";
// real stylesheet so Tailwind's `grid`/`overflow-auto` actually apply
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
      <DataGridPrintButton />
      <DataGridRoot className="h-[200px]">
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>,
  );
}

// The iframe's window only exists after insertion, so the spy hooks the append entry points and
// patches `print` on each appended iframe's contentWindow (same helper as print-grid.test.ts).
function stubIframePrint(): { spy: ReturnType<typeof vi.fn>; restore: () => void } {
  const spy = vi.fn();
  const patched = new WeakSet<object>();
  const spies: MockInstance[] = [];
  for (const proto of [Element.prototype, Document.prototype]) {
    const target = proto as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const method of ["append", "appendChild"] as const) {
      const original = target[method];
      if (typeof original !== "function") continue;
      spies.push(
        vi.spyOn(target, method).mockImplementation(function (this: unknown, ...nodes: unknown[]) {
          const result = original.call(this, ...nodes);
          for (const node of nodes) {
            if (node instanceof HTMLIFrameElement) {
              const win = node.contentWindow;
              if (win && !patched.has(win)) {
                patched.add(win);
                win.print = () => spy();
              }
            }
          }
          return result;
        }),
      );
    }
  }
  return { spy, restore: () => spies.forEach((s) => s.mockRestore()) };
}

describe("DataGridPrintButton (browser)", () => {
  it("opens the print dialog with the grid's rows as a paged table", async () => {
    const { spy, restore } = stubIframePrint();
    try {
      await renderGrid();
      await expect.element(page.getByRole("button", { name: "Print" })).toBeInTheDocument();
      await userEvent.click(page.getByRole("button", { name: "Print" }));

      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
      const iframe = document.querySelector("iframe");
      expect(iframe).not.toBeNull();
      expect(iframe!.getAttribute("sandbox")).toBe("allow-same-origin allow-modals");
      expect(iframe!.getAttribute("sandbox")!.split(" ")).not.toContain("allow-scripts");

      const doc = iframe!.contentDocument!;
      const table = doc.querySelector("table")!;
      expect([...table.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(["Name", "Note"]);
      expect(table.querySelectorAll("tbody tr")).toHaveLength(2);
      expect([...table.querySelectorAll("tbody td")].map((td) => td.textContent)).toEqual(["Alice", "hello, world", "Bob", "plain"]);
      expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')).not.toBeNull();
    } finally {
      restore();
    }
  });
});
