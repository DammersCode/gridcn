import { useEffect } from "react";
import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridServerRows, type ServerRowsAnswer, type ServerRowsRequest, type UseDataGridServerRowsResult, type UseDataGridServerRowsScrollResult } from "@/registry/default/blocks/data-grid-server/use-data-grid-server-rows";
import { DataGridImportButton } from "./data-grid-io";
import "@/app/global.css";

type Row = { id: string; name: string };

const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 160 }] as const);

function makeServer(initial: number) {
  const stored: Row[] = Array.from({ length: initial }, (_, i) => ({ id: `s${i}`, name: `Stored ${i}` }));
  const fetchRows = vi.fn(({ start, end }: ServerRowsRequest): Promise<ServerRowsAnswer<Row>> => Promise.resolve({ rows: stored.slice(start, end), totalRowCount: stored.length }));
  return { stored, fetchRows };
}

async function pickCsv(content: string): Promise<void> {
  await userEvent.click(page.getByRole("button", { name: "Import" }));
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  await userEvent.upload(input, new File([content], "people.csv", { type: "text/csv" }));
  await expect.element(page.getByText("Showing 2 of 2 rows")).toBeInTheDocument();
}

type Harness = { onImport: (rows: Row[], ctx: { signal: AbortSignal }) => Promise<void> };

function ScrollHarness({ fetchRows, onReady, onImport }: { fetchRows: (req: ServerRowsRequest) => Promise<ServerRowsAnswer<Row>>; onReady: (s: UseDataGridServerRowsScrollResult<Row>) => void } & Harness) {
  const server = useDataGridServerRows<Row>({ mode: "scroll", getRowId: (row) => row.id, fetchRows, blockSize: 20, overscan: 5 });
  useEffect(() => {
    onReady(server);
  });
  return (
    <DataGridProvider {...server.providerProps} columns={columns}>
      <DataGridImportButton createRow={(index): Row => ({ id: `new-${index}`, name: "" })} onImport={(rows, ctx) => onImport(rows, ctx).then(() => server.refresh())} />
      <DataGridRoot className="h-[240px]" {...server.rootProps}>
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>
  );
}

describe("import into a scroll-mode grid", () => {
  it("writes nothing into the grid; the server stores the rows and refresh reads the new count", async () => {
    const { stored, fetchRows } = makeServer(50);
    let server!: UseDataGridServerRowsScrollResult<Row>;
    const onImport = vi.fn(async (rows: Row[]) => {
      expect(server.totalRowCount).toBe(50);
      stored.push(...rows);
    });
    await render(<ScrollHarness fetchRows={fetchRows} onReady={(s) => (server = s)} onImport={onImport} />);
    await vi.waitFor(() => expect(server.totalRowCount).toBe(50));
    const callsBefore = fetchRows.mock.calls.length;

    await pickCsv("Name\nAlice\nBob");
    expect(fetchRows.mock.calls.length).toBe(callsBefore);
    await userEvent.click(page.getByRole("button", { name: "Import", exact: true }));

    await vi.waitFor(() => expect(server.totalRowCount).toBe(52));
    expect(server.gridProps.data).toHaveLength(52);
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport.mock.calls[0]![0].map((r) => r.name)).toEqual(["Alice", "Bob"]);
  });

  it("keeps the dialog open and the count unchanged when the server rejects", async () => {
    const { fetchRows } = makeServer(50);
    let server!: UseDataGridServerRowsScrollResult<Row>;
    await render(<ScrollHarness fetchRows={fetchRows} onReady={(s) => (server = s)} onImport={() => Promise.reject(new Error("409"))} />);
    await vi.waitFor(() => expect(server.totalRowCount).toBe(50));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await pickCsv("Name\nAlice\nBob");
    await userEvent.click(page.getByRole("button", { name: "Import", exact: true }));

    await expect.element(page.getByText("Showing 2 of 2 rows")).toBeInTheDocument();
    expect(server.totalRowCount).toBe(50);
  });

  it("aborts the signal on Cancel and ignores a late answer", async () => {
    const { fetchRows } = makeServer(50);
    let server!: UseDataGridServerRowsScrollResult<Row>;
    let release!: () => void;
    let signal!: AbortSignal;
    const onImport = vi.fn((_rows: Row[], ctx: { signal: AbortSignal }) => {
      signal = ctx.signal;
      return new Promise<void>((resolve) => (release = resolve));
    });
    await render(<ScrollHarness fetchRows={fetchRows} onReady={(s) => (server = s)} onImport={onImport} />);
    await vi.waitFor(() => expect(server.totalRowCount).toBe(50));

    await pickCsv("Name\nAlice\nBob");
    await userEvent.click(page.getByRole("button", { name: "Import", exact: true }));
    await vi.waitFor(() => expect(onImport).toHaveBeenCalled());
    await userEvent.click(page.getByRole("button", { name: "Cancel" }));
    expect(signal.aborted).toBe(true);
    await expect.element(page.getByText("Import file")).not.toBeInTheDocument();

    await userEvent.click(page.getByRole("button", { name: "Import" }));
    await expect.element(page.getByText("Import file")).toBeInTheDocument();
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect.element(page.getByText("Import file")).toBeInTheDocument();
  });
});

describe("import into a server-pages (pagination) grid", () => {
  it("leaves the page and totalRowCount to the server until refresh", async () => {
    const { stored, fetchRows } = makeServer(30);
    let server!: UseDataGridServerRowsResult<Row>;
    function Pages() {
      const result = useDataGridServerRows<Row>({ getRowId: (row) => row.id, fetchRows, defaultPageSize: 10 });
      useEffect(() => {
        server = result;
      });
      return (
        <DataGridProvider {...result.providerProps} columns={columns}>
          <DataGridImportButton
            createRow={(index): Row => ({ id: `new-${index}`, name: "" })}
            onImport={async (rows) => {
              stored.push(...rows);
              result.refresh();
            }}
          />
          <DataGridRoot className="h-[240px]" {...result.rootProps}>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      );
    }
    await render(<Pages />);
    await vi.waitFor(() => expect(server.totalRowCount).toBe(30));

    await pickCsv("Name\nAlice\nBob");
    expect(server.gridProps.data).toHaveLength(10);
    await userEvent.click(page.getByRole("button", { name: "Import", exact: true }));

    await vi.waitFor(() => expect(server.totalRowCount).toBe(32));
    expect(server.gridProps.data).toHaveLength(10);
  });
});
