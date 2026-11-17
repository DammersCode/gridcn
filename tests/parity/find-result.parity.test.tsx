import Database from "better-sqlite3";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { useDataGridFindReplace } from "@/registry/default/blocks/data-grid-find-replace/use-data-grid-find-replace";
import { useDataGridServerRows } from "@/registry/default/blocks/data-grid-server/use-data-grid-server-rows";
import { columnsFromDrizzleTable, createDrizzleGridQuery } from "@/registry/default/blocks/data-grid-server-query-drizzle/data-grid-server-query-drizzle";
import { DataGridRoot } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { rowIdAtViewRow } from "@/registry/default/blocks/data-grid/store/compute";
import { columns, type Row } from "./modes";

const items = sqliteTable("items", { id: text("id").primaryKey(), name: text("name"), n: integer("n").notNull() });
const database = new Database(":memory:");
const query = createDrizzleGridQuery<Row>({
  db: drizzle(database),
  table: items,
  columns: columnsFromDrizzleTable(items, { pick: ["id", "name", "n"], overrides: { name: { searchable: true } } }),
});
const oracle = Array.from({ length: 95 }, (_, i) => `r${i}`).filter((id) => `Name ${id.slice(1)}`.includes("Name 7"));

beforeAll(() => {
  database.exec("create table items (id text primary key, name text, n integer not null)");
  const insert = database.prepare("insert into items values (?, ?, ?)");
  for (let i = 0; i < 95; i += 1) insert.run(`r${i}`, `Name ${i}`, i);
});
afterAll(() => database.close());
afterEach(cleanup);

async function mountFind(mode: "pages" | "scroll", findScope: "loaded" | "result") {
  let server!: ReturnType<typeof useDataGridServerRows<Row>>;
  let api!: StoreApi<DataGridStoreState>;
  let findReplace!: ReturnType<typeof useDataGridFindReplace>;
  function Capture() {
    api = useDataGridStoreApi();
    return null;
  }
  function Tree() {
    const fetchRows = ({ signal, ...request }: Parameters<typeof query.fetchRows>[0] & { signal: AbortSignal }) => query.fetchRows(request, { signal });
    const options = mode === "scroll" ? { mode: "scroll", getRowId: (row: Row) => row.id, fetchRows, blockSize: 10, overscan: 0 } : { getRowId: (row: Row) => row.id, fetchRows, defaultPageSize: 10 };
    server = useDataGridServerRows<Row>(options as never) as never;
    findReplace = useDataGridFindReplace({ findScope });
    const { plugins, ...rest } = server.providerProps;
    return (
      <DataGridProvider columns={columns} {...rest} plugins={[...(plugins ?? []), findReplace.plugin]}>
        <DataGridRoot {...server.rootProps}>
          <Capture />
        </DataGridRoot>
      </DataGridProvider>
    );
  }
  render(<Tree />);
  await waitFor(() => expect(server.status).toBe("ready"));
  api.setState({ scrollToCellImpl: ({ row }: { row: number }) => (server.providerProps as unknown as { onRenderedRowsChange?: (range: { start: number; end: number }) => void }).onRenderedRowsChange?.({ start: row, end: row + 1 }) } as never);
  act(() => findReplace.open("find"));
  const input = await screen.findByLabelText("Find");
  fireEvent.change(input, { target: { value: "Name 7" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(api.getState().totalRowCount).toBe(11));
  const activeId = () => {
    const s = api.getState();
    return s.activeCell ? rowIdAtViewRow(s, s.activeCell.row) : undefined;
  };
  const next = async (previous: string | undefined) => {
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(activeId()).not.toBe(previous));
    return activeId();
  };
  return { api: () => api, input, activeId, next };
}

describe.each(["scroll", "pages"] as const)("find over the server result in %s mode", (mode) => {
  it("visits the rows the oracle matches, in order, across the loaded edge", async () => {
    const grid = await mountFind(mode, "result");
    await waitFor(() => expect(grid.activeId()).toBe(oracle[0]));
    const visited = [grid.activeId()!];
    while (visited.length < oracle.length) visited.push((await grid.next(visited.at(-1)))!);
    expect(visited).toEqual(oracle);
    expect(screen.getByRole("status").textContent).toBe("11 rows match");
  });

  it("findScope loaded stops at the loaded rows", async () => {
    const grid = await mountFind(mode, "loaded");
    await waitFor(() => expect(grid.activeId()).toBe(oracle[0]));
    expect(screen.getByRole("status").textContent).not.toBe("11 rows match");
    expect(screen.getByText("Searches loaded rows only")).toBeTruthy();
  });
});
