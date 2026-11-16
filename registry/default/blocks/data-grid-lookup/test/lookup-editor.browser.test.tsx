import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, type ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { lookupCellType } from "../lookup-cell-type";
import type { LookupFetchRequest, LookupOption, LookupOptions, LookupValue } from "../lookup-model";
import "@/app/global.css";

type Row = { id: string; customer: LookupValue };
const acme: LookupOption = { value: "c1", label: "Acme" };
const globex: LookupOption = { value: "c2", label: "Globex" };

function makeOptions(overrides: Partial<LookupOptions> = {}): LookupOptions {
  return { fetchOptions: async () => [acme, globex], debounceMs: 0, ...overrides };
}

async function setup(options: LookupOptions, data: Row[] = [{ id: "r1", customer: acme }], readOnly = false) {
  const onDataChange = vi.fn();
  const columns: readonly ColumnDef<Row, unknown>[] = [
    { id: "id", header: "Id", accessorKey: "id", width: 60 },
    { id: "customer", header: "Customer", accessorKey: "customer", type: "lookup", options, width: 200 },
  ];
  await render(
    <div style={{ width: 400, height: 240 }}>
      <DataGrid data={data} columns={columns} getRowId={(r) => r.id} cellTypes={{ lookup: lookupCellType }} onDataChange={onDataChange} readOnly={readOnly} />
    </div>,
  );
  return { onDataChange };
}

function firstCustomer(spy: { mock: { calls: unknown[][] } }): LookupValue | undefined {
  const next = spy.mock.calls[0]?.[0] as Row[] | undefined;
  return next?.[0]?.customer;
}

async function openEditor() {
  const cell = page.getByRole("gridcell").filter({ hasText: /Acme|c9/ }).first();
  await userEvent.dblClick(cell);
}

describe("lookup editor", () => {
  it("keeps the labels the editor listed when an inline fetchOptions changes identity", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onDataChange = vi.fn();
    const data: Row[] = [{ id: "r1", customer: acme }];
    const tree = () => (
      <div style={{ width: 400, height: 240 }}>
        <DataGrid
          data={data}
          columns={[{ id: "customer", header: "Customer", accessorKey: "customer", type: "lookup", options: { fetchOptions: async () => [acme, globex], debounceMs: 0 }, width: 200 }] as readonly ColumnDef<Row, unknown>[]}
          getRowId={(r) => r.id}
          cellTypes={{ lookup: lookupCellType }}
          onDataChange={onDataChange}
        />
      </div>
    );
    const view = await render(tree());
    await openEditor();
    await expect.element(page.getByRole("option", { name: "Globex" })).toBeVisible();
    await view.rerender(tree());
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("option", { name: "Globex" })).not.toBeInTheDocument();
    await view.rerender(tree());
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/plain", "Globex");
    document.querySelector('[role="grid"]')!.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dataTransfer }));
    await vi.waitFor(() => expect(onDataChange).toHaveBeenCalled());
    const identityWarnings = warn.mock.calls.filter((call) => String(call[0]).includes("[data-grid-lookup]"));
    warn.mockRestore();
    expect(firstCustomer(onDataChange)).toEqual(globex);
    expect(identityWarnings).toHaveLength(0);
  });

  it("shows an id-only value as unresolved", async () => {
    await setup(makeOptions(), [{ id: "r2", customer: "c9" as never }]);
    await expect.element(page.getByText("c9")).toBeVisible();
    expect(document.querySelector("[data-unresolved]")?.textContent).toBe("c9");
  });

  it("loads the default list on open and picks with a click", async () => {
    const { onDataChange } = await setup(makeOptions());
    await openEditor();
    await page.getByRole("option", { name: "Globex" }).click();
    await vi.waitFor(() => expect(onDataChange).toHaveBeenCalled());
    expect(firstCustomer(onDataChange)).toEqual(globex);
  });

  it("picks with ArrowDown and Enter", async () => {
    const { onDataChange } = await setup(makeOptions());
    await openEditor();
    await expect.element(page.getByRole("option", { name: "Globex" })).toBeVisible();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await vi.waitFor(() => expect(onDataChange).toHaveBeenCalled());
    expect(firstCustomer(onDataChange)).toEqual(globex);
  });

  it("searches as the user types and aborts the superseded request", async () => {
    const requests: LookupFetchRequest[] = [];
    const fetchOptions = (req: LookupFetchRequest) => {
      requests.push(req);
      return Promise.resolve([{ value: req.query, label: `hit ${req.query}` }]);
    };
    await setup(makeOptions({ fetchOptions }));
    await openEditor();
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0));
    await userEvent.keyboard("ab");
    await expect.element(page.getByRole("option", { name: "hit ab" })).toBeVisible();
    expect(requests[0]?.signal.aborted).toBe(true);
  });

  it("sends the edited row, its id, and the column id with each request", async () => {
    const requests: LookupFetchRequest[] = [];
    const row: Row = { id: "r1", customer: acme };
    const fetchOptions = (req: LookupFetchRequest) => {
      requests.push(req);
      return Promise.resolve([acme]);
    };
    await setup(makeOptions({ fetchOptions }), [row]);
    await openEditor();
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0));
    expect(requests[0]).toMatchObject({ row, rowId: "r1", columnId: "customer" });
  });

  it("ignores a late answer of a superseded query", async () => {
    const pending: { query: string; resolve: (o: LookupOption[]) => void }[] = [];
    const fetchOptions = (req: LookupFetchRequest) => new Promise<LookupOption[]>((resolve) => pending.push({ query: req.query, resolve }));
    await setup(makeOptions({ fetchOptions }));
    await openEditor();
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    await userEvent.keyboard("b");
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1]?.resolve([{ value: "b1", label: "Fresh" }]);
    await expect.element(page.getByRole("option", { name: "Fresh" })).toBeVisible();
    pending[0]?.resolve([{ value: "a1", label: "Stale" }]);
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.textContent).not.toContain("Stale");
  });

  it("shows an error with Retry", async () => {
    let calls = 0;
    const fetchOptions = async () => {
      calls++;
      if (calls === 1) throw new Error("down");
      return [globex];
    };
    await setup(makeOptions({ fetchOptions }));
    await openEditor();
    await page.getByRole("button", { name: "Retry" }).click();
    await expect.element(page.getByRole("option", { name: "Globex" })).toBeVisible();
  });

  it("renders a hostile label as text", async () => {
    await setup(makeOptions({ fetchOptions: async () => [{ value: "x", label: "<img src=x onerror=alert(1)>" }] }));
    await openEditor();
    await expect.element(page.getByRole("option")).toBeVisible();
    expect(document.querySelector("[role=option] img")).toBeNull();
    expect(document.querySelector("[role=option]")?.textContent).toContain("<img");
  });

  it("waits for minQueryLength", async () => {
    const fetchOptions = vi.fn(async () => [acme]);
    await setup(makeOptions({ fetchOptions, minQueryLength: 2 }));
    await openEditor();
    await expect.element(page.getByText("Type 2 more characters")).toBeVisible();
    expect(fetchOptions).not.toHaveBeenCalled();
  });

  it("aborts the request and keeps the value on Escape", async () => {
    const requests: LookupFetchRequest[] = [];
    const fetchOptions = (req: LookupFetchRequest) => {
      requests.push(req);
      return new Promise<LookupOption[]>(() => {});
    };
    const { onDataChange } = await setup(makeOptions({ fetchOptions }));
    await openEditor();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(requests[0]?.signal.aborted).toBe(true));
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("opens no editor on a readOnly grid", async () => {
    await setup(makeOptions(), undefined, true);
    await openEditor();
    expect(document.querySelector("[role=combobox]")).toBeNull();
  });

  it("bounds the typed query and ties aria-expanded to the list", async () => {
    await setup(makeOptions({ fetchOptions: async () => [] }));
    await openEditor();
    const input = document.querySelector<HTMLInputElement>("[role=combobox]");
    await vi.waitFor(() => expect(input?.getAttribute("aria-expanded")).toBe("false"));
    expect(input?.maxLength).toBe(256);
  });
});
