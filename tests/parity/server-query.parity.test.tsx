import Database from "better-sqlite3";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { useDataGridServerRows, type ServerRowsPageRequest } from "@/registry/default/blocks/data-grid-server/use-data-grid-server-rows";
import { columnsFromDrizzleTable, createDrizzleGridQuery } from "@/registry/default/blocks/data-grid-server-query-drizzle/data-grid-server-query-drizzle";
import { DataGridRoot } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { columns, type Row } from "./modes";

const items = sqliteTable("items", { id: text("id").primaryKey(), name: text("name"), n: integer("n").notNull() });
const database = new Database(":memory:");
const query = createDrizzleGridQuery<Row>({
  db: drizzle(database),
  table: items,
  columns: columnsFromDrizzleTable(items, { pick: ["id", "name", "n"], overrides: { name: { searchable: true } } }),
});

beforeAll(() => {
  database.exec("create table items (id text primary key, name text, n integer not null)");
  const insert = database.prepare("insert into items values (?, ?, ?)");
  for (let i = 0; i < 95; i += 1) insert.run(`r${i}`, `Name ${i}`, i);
});
afterAll(() => database.close());
afterEach(cleanup);

type Fetch = (request: ServerRowsPageRequest) => ReturnType<typeof query.fetchRows>;

function fetchFromLayer() {
  return vi.fn<Fetch>(({ signal, ...request }) => query.fetchRows(request, { signal }));
}

async function mountLayer(fetchRows: Fetch, mode: "pages" | "scroll") {
  let server!: ReturnType<typeof useDataGridServerRows<Row>>;
  let api: StoreApi<DataGridStoreState> | null = null;
  function Capture() {
    api = useDataGridStoreApi();
    return null;
  }
  function Tree() {
    const options = mode === "scroll" ? { mode: "scroll", getRowId: (row: Row) => row.id, fetchRows, blockSize: 10, overscan: 0 } : { getRowId: (row: Row) => row.id, fetchRows, defaultPageSize: 10 };
    server = useDataGridServerRows<Row>(options as never) as never;
    return (
      <DataGridProvider columns={columns} {...server.providerProps}>
        <DataGridRoot {...server.rootProps}>
          <Capture />
        </DataGridRoot>
      </DataGridProvider>
    );
  }
  render(<Tree />);
  await waitFor(() => expect(server.status).toBe("ready"));
  return { server: () => server, state: () => api!.getState(), ready: () => waitFor(() => expect(server.status).toBe("ready")) };
}

const ids = (grid: Awaited<ReturnType<typeof mountLayer>>) => (grid.state().data as Row[]).map((row) => row.id);

describe("the query layer in mode PS (server pagination)", () => {
  it("serves a page and the row count from the database", async () => {
    const grid = await mountLayer(fetchFromLayer(), "pages");
    expect(ids(grid)).toHaveLength(10);
    expect(grid.server().pager.totalRowCount).toBe(95);
    act(() => grid.server().pager.onPageChange(10));
    await grid.ready();
    expect(ids(grid)).toHaveLength(5);
  });
});

describe("the query layer in mode SS (sortMode server)", () => {
  it("a sort reaches the database and the grid shows its order", async () => {
    const grid = await mountLayer(fetchFromLayer(), "pages");
    act(() => grid.state().actions.setSorts([{ columnId: "n", direction: "desc" }]));
    await waitFor(() => expect(ids(grid)[0]).toBe("r94"));
    expect(ids(grid).slice(0, 3)).toEqual(["r94", "r93", "r92"]);
  });
});

describe("the query layer in mode FS (filterMode server)", () => {
  it("a filter tree reaches the database and narrows the count", async () => {
    const grid = await mountLayer(fetchFromLayer(), "pages");
    act(() => grid.state().actions.setFilters([{ filterId: "f", columnId: "n", operator: "gte", value: "90" }] as never));
    await waitFor(() => expect(grid.server().pager.totalRowCount).toBe(5));
    expect(ids(grid)).toEqual(["r90", "r91", "r92", "r93", "r94"].sort());
  });
});

describe("the query layer with a root or join", () => {
  const low = { filterId: "a", columnId: "n", operator: "lt", value: "2" };
  const high = { filterId: "b", columnId: "n", operator: "gte", value: "93" };
  it.each(["pages", "scroll"] as const)("joins the top-level filters with or in the database, %s mode", async (mode) => {
    const fetchRows = fetchFromLayer();
    const grid = await mountLayer(fetchRows, mode);
    act(() => grid.state().actions.setFilters([low, high] as never));
    await waitFor(() => expect(grid.state().totalRowCount ?? grid.server().pager?.totalRowCount).toBe(0));
    act(() => grid.state().actions.setFilterJoin("or"));
    await waitFor(() => expect(fetchRows.mock.calls.at(-1)![0]).toMatchObject({ spec: { filterJoin: "or" } }));
    await grid.ready();
    expect(ids(grid).sort()).toEqual(["r0", "r1", "r93", "r94"]);
  });
});

describe("the query layer in mode C (controlled state)", () => {
  it("quick search narrows the result, and a half-built filter row keeps the client meaning", async () => {
    const grid = await mountLayer(fetchFromLayer(), "pages");
    act(() => grid.state().actions.setSearch("Name 7"));
    await waitFor(() => expect(grid.server().pager.totalRowCount).toBe(11));
    act(() => grid.state().actions.setSearch(""));
    act(() => grid.state().actions.setFilters([{ filterId: "f", columnId: "n", operator: "gt", value: "" }] as never));
    await waitFor(() => expect(grid.server().pager.totalRowCount).toBe(0));
  });
});

describe("the query layer in mode Z (scroll mode)", () => {
  it("counts the first block and fetches later blocks without recounting", async () => {
    const fetchRows = fetchFromLayer();
    const grid = await mountLayer(fetchRows, "scroll");
    expect(grid.state().totalRowCount).toBe(95);
    act(() => grid.state().actions.setSorts([{ columnId: "n", direction: "desc" }]));
    await waitFor(() => expect(fetchRows.mock.calls.at(-1)![0]).toMatchObject({ spec: { sorts: [{ columnId: "n", direction: "desc" }] }, start: 0 }));
    await grid.ready();
    expect(ids(grid)[0]).toBe("r94");
  });
});
