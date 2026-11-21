import { describe, expect, it, vi } from "vitest";
import { createRemoteServer } from "./fake-remote-server";
import { generateSales } from "./sales-data";

async function ids(server: ReturnType<typeof createRemoteServer>, count: number) {
  const { rows } = await server.fetchPage({ page: 1, pageSize: count });
  return rows.map((row) => row.id);
}

describe("createRemoteServer set filters", () => {
  it("splits the rows between isAnyOf and isNoneOf, ignoring case", async () => {
    const server = createRemoteServer();
    const { rows } = await server.fetchPage({ page: 1, pageSize: 1 });
    const role = rows[0]!.role.toUpperCase();
    const any = await server.fetchPage({ page: 1, pageSize: 1, filters: [{ columnId: "role", operator: "isAnyOf", value: [role] }] });
    const none = await server.fetchPage({ page: 1, pageSize: 1, filters: [{ columnId: "role", operator: "isNoneOf", value: [role] }] });

    expect(any.total).toBeGreaterThan(0);
    expect(none.total).toBeGreaterThan(0);
    expect(any.total + none.total).toBe(server.total);
  });

  it("matches every row for an empty isNoneOf list", async () => {
    const server = createRemoteServer();
    const { total } = await server.fetchPage({ page: 1, pageSize: 1, filters: [{ columnId: "role", operator: "isNoneOf", value: [] }] });

    expect(total).toBe(server.total);
  });
});

describe("createRemoteServer applyOps", () => {
  it("applies a two-move batch with snapshot positions", async () => {
    const server = createRemoteServer();
    const { rows } = await server.fetchPage({ page: 1, pageSize: 6 });
    const [r0, r1] = rows;
    server.applyOps([
      { type: "move", rowId: r0!.id, row: r0!, from: 0, to: 3 },
      { type: "move", rowId: r1!.id, row: r1!, from: 1, to: 4 },
    ]);

    expect(await ids(server, 6)).toEqual(["row-2", "row-3", "row-4", "row-0", "row-1", "row-5"]);
  });
});

describe("createRemoteServer filter groups", () => {
  it("evaluates a tree like the client: (role A or role B) and age > 30", async () => {
    const server = createRemoteServer();
    const all = await server.fetchPage({ page: 1, pageSize: 1000 });
    const [a, b] = [all.rows[0]!.role, all.rows.find((r) => r.role !== all.rows[0]!.role)!.role];
    const expected = all.rows.filter((r) => (r.role === a || r.role === b) && r.age > 30).length;
    const result = await server.fetchPage({
      page: 1,
      pageSize: 1,
      filters: [
        { columnId: "age", operator: "gt", value: "30" },
        { join: "or", filters: [{ columnId: "role", operator: "equals", value: a }, { columnId: "role", operator: "equals", value: b }] },
      ],
    });
    expect(result.total).toBe(expected);
  });

  it("a negated group keeps the rows its children fail, like the client", async () => {
    const server = createRemoteServer();
    const all = await server.fetchPage({ page: 1, pageSize: 1000 });
    const role = all.rows[0]!.role;
    const group = (not: boolean) => ({ join: "and" as const, not, filters: [{ columnId: "role", operator: "equals", value: role }] });
    const plain = await server.fetchPage({ page: 1, pageSize: 1, filters: [group(false)] });
    const negated = await server.fetchPage({ page: 1, pageSize: 1, filters: [group(true)] });
    expect(negated.total).toBe(server.total - plain.total);
    const empty = await server.fetchPage({ page: 1, pageSize: 1, filters: [{ join: "or", not: true, filters: [] }] });
    expect(empty.total).toBe(server.total);
  });

  it("an empty group matches every row, like the client", async () => {
    const server = createRemoteServer();
    const { total } = await server.fetchPage({ page: 1, pageSize: 1, filters: [{ join: "or", filters: [] }] });
    expect(total).toBe(server.total);
  });

  it("rejects a tree that is too deep, has an unknown join, or names an unknown column", async () => {
    const server = createRemoteServer();
    const leaf = { columnId: "role", operator: "equals", value: "x" };
    const deep = { join: "or" as const, filters: [{ join: "and" as const, filters: [{ join: "or" as const, filters: [leaf] }] }] };
    await expect(server.fetchPage({ page: 1, pageSize: 1, filters: [deep] })).rejects.toThrow();
    await expect(server.fetchPage({ page: 1, pageSize: 1, filters: [{ join: "xor", filters: [leaf] } as never] })).rejects.toThrow();
    await expect(server.fetchPage({ page: 1, pageSize: 1, filters: [{ ...leaf, columnId: "secret" }] })).rejects.toThrow();
  });

  it("rejects 100k empty groups before it walks them", async () => {
    const server = createRemoteServer();
    const groups = Array.from({ length: 100_000 }, () => ({ join: "or" as const, filters: [] }));
    await expect(server.fetchPage({ page: 1, pageSize: 1, filters: groups })).rejects.toThrow("invalid filter group");
  });

  it("accepts 16 groups and rejects the 17th", async () => {
    const server = createRemoteServer();
    const groups = (n: number) => Array.from({ length: n }, () => ({ join: "or" as const, filters: [] }));
    await expect(server.fetchPage({ page: 1, pageSize: 1, filters: groups(16) })).resolves.toBeDefined();
    await expect(server.fetchPage({ page: 1, pageSize: 1, filters: groups(17) })).rejects.toThrow("invalid filter group");
  });
});

describe("createRemoteServer ranges and values", () => {
  it("orders sorts and values with a fixed en-US collator, not the runtime locale", async () => {
    const server = createRemoteServer();
    const spy = vi.spyOn(String.prototype, "localeCompare");
    await server.fetchPage({ page: 1, pageSize: 5, sorts: [{ columnId: "name", direction: "asc" }] });
    await server.fetchValues({ columnId: "role", search: "" });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns a window of the filtered list with the filtered total", async () => {
    const server = createRemoteServer();
    const filters = [{ columnId: "role", operator: "isAnyOf", value: ["admin"] }];
    const all = await server.fetchRange({ start: 0, end: 1000, filters });
    const window = await server.fetchRange({ start: 2, end: 5, filters });

    expect(window.total).toBe(all.total);
    expect(window.rows.map((row) => row.id)).toEqual(all.rows.slice(2, 5).map((row) => row.id));
    expect(all.rows.every((row) => row.role === "Admin")).toBe(true);
  });

  it("counts the distinct values of a column, narrowed by search and by the other filters", async () => {
    const server = createRemoteServer();
    const everyone = await server.fetchValues({ columnId: "role", search: "" });
    const searched = await server.fetchValues({ columnId: "role", search: "ADM" });
    const narrowed = await server.fetchValues({ columnId: "role", search: "", filters: [{ columnId: "role", operator: "isAnyOf", value: ["Admin"] }] });

    expect(everyone.values.reduce((sum, value) => sum + value.count, 0)).toBe(server.total);
    expect(searched.values.map((value) => value.value)).toEqual(["Admin"]);
    expect(narrowed.values.map((value) => value.value)).toEqual(["Admin"]);
  });

  it("rejects a column outside the allowed set", async () => {
    await expect(createRemoteServer().fetchValues({ columnId: "secret", search: "" })).rejects.toThrow();
  });
});

describe("createRemoteServer with its own rows", () => {
  it("serves the given rows and filters on their columns", async () => {
    const server = createRemoteServer({ rows: generateSales(50) });
    const financed = await server.fetchPage({ page: 1, pageSize: 50, filters: [{ columnId: "financed", operator: "equals", value: "true" }] });

    expect(server.total).toBe(50);
    expect(financed.total).toBeGreaterThan(0);
    expect(financed.total).toBeLessThan(50);
    expect(financed.rows.every((row) => row.financed)).toBe(true);
  });

  it("rejects a column the given rows do not have", async () => {
    const server = createRemoteServer({ rows: generateSales(5) });

    await expect(server.fetchPage({ page: 1, pageSize: 5, filters: [{ columnId: "role", operator: "equals", value: "Admin" }] })).rejects.toThrow();
  });

  it("bumps a number column and keeps the new value for the next fetch", async () => {
    const server = createRemoteServer({ rows: generateSales(5) });
    const [first] = (await server.fetchPage({ page: 1, pageSize: 1 })).rows;
    const pushes = server.bumpNumbers([first!.id, "missing"], "price", (price) => price + 100);

    expect(pushes).toEqual([{ rowId: first!.id, changes: { price: first!.price + 100 } }]);
    expect((await server.fetchPage({ page: 1, pageSize: 1 })).rows[0]!.price).toBe(first!.price + 100);
  });
});
